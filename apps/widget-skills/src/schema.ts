/**
 * Schema emitters. Both are JSON Schema Draft 2020-12.
 *
 * - `emitFullSchema`: the document as authored (a recursive tree), with one `$defs` entry per widget type and per
 *   named config type. JSDoc constraint tags become keywords, and the reserved `meta` is allowed on every node.
 * - `emitLlmSchema`: the conservative LLM profile. The tree is a flat node list, records are arrays of
 *   `{ key, value }`, every object closes with `additionalProperties: false`, and every constraint is prose in
 *   `description`. Only `type`, `properties`, `required`, `items`, `enum`, `const`, `anyOf`, `$defs`/`$ref`,
 *   `additionalProperties` and `description` appear. An optional property is simply left out of `required`: there
 *   is no `null` union for optionality, which keeps the count of union-typed parameters low. The profile is meant
 *   for non-strict structured output.
 *
 * The schema only gets the structure roughly right: compiling the Blueprint and reading its diagnostics decides.
 */

import type { ConstraintTag, Doc, PluginIr, Shape, SlotIr, SystemIr } from './ir'
import { createValueEncoding, recursiveTypeNames } from './encoding'

export { recursiveTypeNames }

export interface JsonSchema { [key: string]: unknown }

const DIALECT = 'https://json-schema.org/draft/2020-12/schema'

/** The LLM profile closes every object, so the other keys an index signature admits cannot be written there. */
const INDEX_SIGNATURE_NOTE = 'The type also allows keys not listed here, which this form cannot express: leave them out.'

/** The tags about a string value. */
const STRING_TAGS = ['format', 'pattern', 'minLength', 'maxLength'] as const
/** The tags about a number value. */
const NUMBER_TAGS = ['minimum', 'maximum', 'exclusiveMinimum', 'exclusiveMaximum', 'multipleOf', 'integer'] as const
/** The tags about an array. */
const ARRAY_TAGS = ['minItems', 'maxItems', 'uniqueItems'] as const
/** The tags about a dictionary (or any object). */
const DICTIONARY_TAGS = ['minProperties', 'maxProperties', 'propertyNames'] as const
/** The tags whose value is a number. */
const NUMERIC_TAGS = ['minimum', 'maximum', 'exclusiveMinimum', 'exclusiveMaximum', 'multipleOf', 'minLength', 'maxLength', 'minItems', 'maxItems', 'minProperties', 'maxProperties'] as const

function parseJson(text: string): unknown {
	try {
		return JSON.parse(text)
	}
	catch {
		return text
	}
}

/**
 * `$defs` keys for the widget types (`prefix_Type`) and named types (`type_Name`). A key is restricted to
 * `[A-Za-z0-9_.-]`, which providers require and which needs no JSON Pointer escaping; two names that sanitize to
 * the same key get a numeric suffix.
 */
function createDefKeys(): (prefix: string, name: string) => string {
	const byName = new Map<string, string>()
	const used = new Set<string>()
	return (prefix, name) => {
		const id = `${prefix}\0${name}`
		const existing = byName.get(id)
		if (existing !== undefined)
			return existing
		const base = `${prefix}_${name.replace(/[^\w.-]/g, '_')}`
		let key = base
		for (let suffix = 2; used.has(key); suffix++)
			key = `${base}_${suffix}`
		used.add(key)
		byName.set(id, key)
		return key
	}
}

/**
 * The constraint tags of `doc`, with a `@defaultValue` that is valid JSON standing in for a missing `@default` (TSDoc's
 * standard spelling of the same thing).
 */
export function constraintTagsOf(doc: Doc): Doc['tags'] {
	if (doc.tags.default !== undefined || doc.defaultValue === undefined)
		return doc.tags
	try {
		JSON.parse(doc.defaultValue)
	}
	catch {
		return doc.tags
	}
	return { ...doc.tags, default: doc.defaultValue }
}

/** Where a constraint tag lands on a value: the value itself, each item of an array, or each value of a dictionary. */
export type ConstraintSlot = 'self' | 'items' | 'values'

/** Where each constraint tag of a member lands (`null`: it constrains nothing there, see `misplacedConstraintTags`). */
export type ConstraintSlots = Partial<Record<ConstraintTag, ConstraintSlot | null>>

/**
 * The summary and remarks of `doc`, then its constraint tags as prose (the LLM profile). `formatValue` rewrites
 * `@default`/`@examples` values. `slots` (from `placeConstraints`) says where each tag lands: a tag on each item or value is
 * worded so, the dictionary tags speak of keys and entries (a dictionary is an entry list in the flat form), and a tag
 * that lands nowhere is left out.
 */
export function describeDoc(doc: Doc, withConstraints: boolean, formatValue: (jsonText: string, isList: boolean) => string = text => text, slots: ConstraintSlots = {}, dictionary = false): string {
	const parts = [doc.summary, doc.remarks].filter(part => part !== '')
	if (withConstraints) {
		const constraints = Object.entries(constraintTagsOf(doc))
			.map(([name, value]) => {
				const tag = name as ConstraintTag
				const slot = Object.hasOwn(slots, tag) ? slots[tag] : 'self'
				if (slot === null)
					return ''
				const prefix = slot === 'items' ? 'each item: ' : slot === 'values' ? 'each value: ' : ''
				const entries = dictionary ? 'entries' : 'keys'
				switch (tag) {
					case 'widgetRef': return `Must be the id of a widget of type ${value} in the same document.`
					case 'default':
					case 'examples': return `${tag}: ${formatValue(value, tag === 'examples')}.`
					case 'uniqueItems': return flagIsSet(value) ? 'no two items are equal.' : ''
					case 'integer': return flagIsSet(value) ? `${prefix}integer.` : ''
					case 'minProperties': return `at least ${value} ${entries}.`
					case 'maxProperties': return `at most ${value} ${entries}.`
					case 'propertyNames': return `every key matches ${value}.`
					default: return `${prefix}${tag}: ${value}.`
				}
			})
			.filter(text => text !== '')
		if (constraints.length > 0)
			parts.push(`Constraints: ${constraints.join(' ')}`)
	}
	else if (doc.tags.widgetRef !== undefined) {
		parts.push(`Must be the id of a widget of type ${doc.tags.widgetRef} in the same document.`)
	}
	return parts.join(' ')
}

/** Adds `text` in front of the description `schema` already has (the structural note an emitter wrote), keeping both. */
function describe(schema: JsonSchema, text: string): JsonSchema {
	const parts = [text, typeof schema.description === 'string' ? schema.description : ''].filter(part => part !== '')
	return parts.length === 0 ? schema : { ...schema, description: parts.join(' ') }
}

/** Whether a flag tag (`@uniqueItems`, `@integer`) is set: written bare or as `true`. */
export function flagIsSet(text: string | undefined): boolean {
	return text !== undefined && (text.trim() === '' || text.trim() === 'true')
}

/** A shape with its named types followed and a union with `null` read as its other member. */
interface CoreShape {
	shape: Shape
	/** A `null` member was dropped on the way. */
	nullable: boolean
	/** A named type was followed on the way. */
	viaRef: boolean
}

function coreOf(ir: SystemIr, shape: Shape): CoreShape {
	let current = shape
	let nullable = false
	let viaRef = false
	for (let hops = 0; hops < 16; hops++) {
		if (current.kind === 'ref' && ir.types[current.name] !== undefined) {
			current = ir.types[current.name]!.shape
			viaRef = true
			continue
		}
		if (current.kind === 'union') {
			const rest = current.members.filter(member => member.kind !== 'null')
			if (rest.length < current.members.length)
				nullable = true
			if (rest.length === 1) {
				current = rest[0]!
				continue
			}
			current = rest.length < current.members.length ? { kind: 'union', members: rest } : current
		}
		break
	}
	return { shape: current, nullable, viaRef }
}

type ValueKind = 'string' | 'number' | 'array' | 'record' | 'object' | 'other'

function valueKindOf(shape: Shape): ValueKind {
	const literalKind = (member: Shape): ValueKind => member.kind === 'literal' && typeof member.value !== 'boolean' ? (typeof member.value === 'string' ? 'string' : 'number') : 'other'
	switch (shape.kind) {
		case 'string':
		case 'number':
		case 'array':
		case 'record':
		case 'object':
			return shape.kind
		case 'literal':
			return literalKind(shape)
		case 'union': {
			const kinds = new Set(shape.members.map(literalKind))
			return kinds.size === 1 ? [...kinds][0]! : 'other'
		}
		default:
			return 'other'
	}
}

/** Where `tag` lands on a value of `shape`, or `null` when it constrains nothing there. */
function slotOf(ir: SystemIr, tag: ConstraintTag, shape: Shape): ConstraintSlot | null {
	const core = coreOf(ir, shape)
	const kind = valueKindOf(core.shape)
	if ((ARRAY_TAGS as readonly string[]).includes(tag))
		return kind === 'array' ? 'self' : null
	if ((DICTIONARY_TAGS as readonly string[]).includes(tag))
		return kind === 'record' || kind === 'object' ? 'self' : null
	const wanted = (STRING_TAGS as readonly string[]).includes(tag) ? 'string' : (NUMBER_TAGS as readonly string[]).includes(tag) ? 'number' : null
	if (wanted === null)
		return 'self'
	if (kind === wanted)
		return 'self'
	if (core.shape.kind === 'array' && valueKindOf(coreOf(ir, core.shape.items).shape) === wanted)
		return 'items'
	if (core.shape.kind === 'record' && valueKindOf(coreOf(ir, core.shape.value).shape) === wanted)
		return 'values'
	return null
}

/**
 * `schema` (the full-profile schema of `shape`) as an integer, or `null` when that cannot be said of it: the `type` of a
 * number becomes `integer`, a literal enum or a reference to a number type gets `type: "integer"` beside it, and a union
 * with `null` changes its number branches.
 */
function integerSchema(ir: SystemIr, schema: JsonSchema, shape: Shape): JsonSchema | null {
	if (shape.kind === 'number' || shape.kind === 'literal')
		return { ...schema, type: 'integer' }
	if (shape.kind === 'ref')
		return coreOf(ir, shape).nullable ? null : { ...schema, type: 'integer' }
	if (shape.kind === 'union') {
		if (Array.isArray(schema.enum))
			return { ...schema, type: 'integer' }
		const branches = schema.anyOf
		if (!Array.isArray(branches) || branches.length !== shape.members.length)
			return null
		const next: JsonSchema[] = []
		for (const [index, member] of shape.members.entries()) {
			const branch = member.kind === 'null' ? branches[index] as JsonSchema : integerSchema(ir, branches[index] as JsonSchema, member)
			if (branch === null)
				return null
			next.push(branch)
		}
		return { ...schema, anyOf: next }
	}
	return null
}

/**
 * `schema` (the full-profile schema of `shape`) with the constraint tags of `doc` as keywords, and where each tag landed.
 *
 * A tag lands on the value it is about, through a union with `null` and through named types: an array or dictionary tag
 * on the array or dictionary, a string or number tag on the string or number, and a string or number tag written on an
 * array or a dictionary on each of its items or values (`@pattern` on a `string[]`, `@exclusiveMinimum` on a
 * `Record<string, number>`). A keyword about the value itself sits beside an `anyOf` or a `$ref` (it only constrains
 * instances of its own type); one about the items or values is merged into `items` or `additionalProperties` when the
 * array or dictionary is written inline, and placed beside the `anyOf` or `$ref` otherwise. A tag that lands nowhere (a
 * `@pattern` on a list of objects, `@uniqueItems` on a string) emits nothing; `--check` reports it.
 */
export function placeConstraints(ir: SystemIr, schema: JsonSchema, shape: Shape, doc: Doc): { schema: JsonSchema, slots: ConstraintSlots } {
	const tags = constraintTagsOf(doc)
	const slots: ConstraintSlots = {}
	const buckets: Record<ConstraintSlot, JsonSchema> = { self: {}, items: {}, values: {} }
	const own: JsonSchema = {}
	const place = (tag: ConstraintTag, keyword: string, value: unknown): void => {
		const slot = slotOf(ir, tag, shape)
		slots[tag] = slot
		if (slot !== null)
			buckets[slot][keyword] = value
	}
	for (const tag of NUMERIC_TAGS) {
		const text = tags[tag]
		if (text !== undefined && text.trim() !== '' && Number.isFinite(Number(text)))
			place(tag, tag, Number(text))
	}
	if (tags.format !== undefined)
		place('format', 'format', tags.format)
	if (tags.pattern !== undefined)
		place('pattern', 'pattern', tags.pattern)
	if (flagIsSet(tags.uniqueItems))
		place('uniqueItems', 'uniqueItems', true)
	if (tags.propertyNames !== undefined && tags.propertyNames.trim() !== '')
		place('propertyNames', 'propertyNames', { pattern: tags.propertyNames.trim() })
	if (tags.default !== undefined)
		own.default = parseJson(tags.default)
	if (tags.examples !== undefined) {
		const examples = parseJson(tags.examples)
		own.examples = Array.isArray(examples) ? examples : [examples]
	}

	let result: JsonSchema = { ...schema, ...buckets.self }
	const inner = (slot: 'items' | 'values'): { keyword: string, innerShape: Shape } | null => {
		const core = coreOf(ir, shape).shape
		if (slot === 'items' && core.kind === 'array')
			return { keyword: 'items', innerShape: core.items }
		if (slot === 'values' && core.kind === 'record')
			return { keyword: 'additionalProperties', innerShape: core.value }
		return null
	}
	const integer = flagIsSet(tags.integer) ? slotOf(ir, 'integer', shape) : undefined
	for (const slot of ['items', 'values'] as const) {
		const target = inner(slot)
		if (target === null)
			continue
		// Written inline (`{ type: "array", items }`): merge into it. Behind an `anyOf` or a `$ref`: beside it.
		const inline = (slot === 'items' ? shape.kind === 'array' : shape.kind === 'record') && typeof result[target.keyword] === 'object' && result[target.keyword] !== null
		let innerSchema: JsonSchema | null = inline ? { ...(result[target.keyword] as JsonSchema), ...buckets[slot] } : { ...buckets[slot] }
		if (integer === slot) {
			innerSchema = inline
				? integerSchema(ir, innerSchema, target.innerShape)
				: coreOf(ir, target.innerShape).nullable ? null : { ...innerSchema, type: 'integer' }
			if (innerSchema === null) {
				slots.integer = null
				innerSchema = inline ? { ...(result[target.keyword] as JsonSchema), ...buckets[slot] } : { ...buckets[slot] }
			}
		}
		if (Object.keys(innerSchema).length > 0)
			result = { ...result, [target.keyword]: innerSchema }
	}
	if (integer !== undefined) {
		slots.integer = slots.integer === null ? null : integer
		if (integer === 'self') {
			const next = integerSchema(ir, result, shape)
			if (next === null)
				slots.integer = null
			else
				result = next
		}
	}
	return { schema: { ...result, ...own }, slots }
}

/**
 * The constraint tags of `doc` that constrain nothing on a value of `shape` (`--check` reports them as `misplaced-tag`):
 * a tag about another kind of value, or `@integer` beside a reference to a type that admits `null`.
 */
export function misplacedConstraintTags(ir: SystemIr, shape: Shape, doc: Doc): ConstraintTag[] {
	const { slots } = placeConstraints(ir, createFullShapeEmitter(ir, (_prefix, name) => ({ $ref: `#/$defs/type_${name}` }))(shape), shape, doc)
	return (Object.keys(slots) as ConstraintTag[]).filter(tag => slots[tag] === null)
}

function literalEnum(members: readonly Shape[]): (string | number | boolean)[] | null {
	const values: (string | number | boolean)[] = []
	for (const member of members) {
		if (member.kind !== 'literal')
			return null
		values.push(member.value)
	}
	return values
}

function jsonTypeOf(value: string | number | boolean): string {
	return typeof value === 'string' ? 'string' : typeof value === 'number' ? 'number' : 'boolean'
}

function pluginDescription(plugin: PluginIr): string {
	return describeDoc(plugin.doc, false)
}

/** What a slot expects, in words: the plugin types it names (or any widget) and the members a contract asks for. */
export function describeExpectation(slot: SlotIr): string {
	const types = slot.expected === null ? 'any widget' : slot.expected.join(' or ')
	return slot.contract === null ? `Expects ${types}.` : `Expects ${types} with the members ${slot.contract}.`
}

function slotDescription(slot: SlotIr): string {
	return [describeDoc(slot.doc, false), describeExpectation(slot)].filter(part => part !== '')
		.join(' ')
}

// -------------------------------------------------------------------------------------------------
// Full schema
// -------------------------------------------------------------------------------------------------

/** The full-profile schema of a value shape: constraint tags as keywords, named types as `$ref`s into `#/$defs/type_<Name>`. */
function createFullShapeEmitter(ir: SystemIr, ref: (prefix: string, name: string) => JsonSchema): (shape: Shape) => JsonSchema {
	const fullShape = (shape: Shape): JsonSchema => {
		switch (shape.kind) {
			case 'string':
			case 'number':
			case 'boolean':
			case 'null':
				return { type: shape.kind }
			case 'unknown':
				return {}
			case 'literal':
				return { const: shape.value }
			case 'array':
				return { type: 'array', items: fullShape(shape.items) }
			case 'record':
				return { type: 'object', additionalProperties: fullShape(shape.value) }
			case 'ref':
				return ir.types[shape.name] === undefined ? {} : ref('type', shape.name)
			case 'union': {
				const values = literalEnum(shape.members)
				return values !== null ? { enum: values } : { anyOf: shape.members.map(fullShape) }
			}
			case 'object':
				return {
					type: 'object',
					properties: Object.fromEntries(shape.properties.map(property => [property.name, describe(placeConstraints(ir, fullShape(property.shape), property.shape, property.doc).schema, describeDoc(property.doc, false))])),
					required: shape.properties.filter(property => !property.optional)
						.map(property => property.name),
					// An index signature next to named properties types the other keys.
					additionalProperties: shape.additional === undefined ? false : fullShape(shape.additional),
				}
		}
	}
	return fullShape
}

/** The named types `shape` mentions, transitively, in a stable order. */
export function namedTypesOf(ir: SystemIr, shape: Shape): string[] {
	const seen = new Set<string>()
	const visit = (node: Shape): void => {
		if (node.kind === 'ref') {
			if (seen.has(node.name) || ir.types[node.name] === undefined)
				return
			seen.add(node.name)
			visit(ir.types[node.name]!.shape)
		}
		else if (node.kind === 'array') {
			visit(node.items)
		}
		else if (node.kind === 'record') {
			visit(node.value)
		}
		else if (node.kind === 'union') {
			node.members.forEach(visit)
		}
		else if (node.kind === 'object') {
			node.properties.forEach(property => visit(property.shape))
			if (node.additional !== undefined)
				visit(node.additional)
		}
	}
	visit(shape)
	return [...seen]
}

/**
 * The JSON Schema (Draft 2020-12, full profile) of one plugin's authored config (`config.raw`): field descriptions
 * from JSDoc, constraint tags as keywords, a `null` alternative when the config may be left out, and a `$defs`
 * entry for each named type it reaches. `null` when the plugin has no config.
 */
export function emitConfigSchema(ir: SystemIr, plugin: PluginIr): JsonSchema | null {
	if (plugin.config === null)
		return null
	const key = createDefKeys()
	const fullShape = createFullShapeEmitter(ir, (prefix, name) => ({ $ref: `#/$defs/${key(prefix, name)}` }))
	const value = fullShape(plugin.config.rawShape)
	const defs: Record<string, JsonSchema> = {}
	for (const name of namedTypesOf(ir, plugin.config.rawShape)) {
		const type = ir.types[name]!
		defs[key('type', name)] = describe(placeConstraints(ir, fullShape(type.shape), type.shape, type.doc).schema, describeDoc(type.doc, false))
	}
	const body = plugin.config.omittable ? { anyOf: [value, { type: 'null' }] } : value
	return {
		$schema: DIALECT,
		title: `${plugin.type} config`,
		...describe(body, describeDoc(plugin.config.doc, false)),
		...(Object.keys(defs).length === 0 ? {} : { $defs: defs }),
	}
}

export function emitFullSchema(ir: SystemIr): JsonSchema {
	const key = createDefKeys()
	const ref = (prefix: string, name: string): JsonSchema => ({ $ref: `#/$defs/${key(prefix, name)}` })
	const anyWidget: JsonSchema = { $ref: '#/$defs/widget' }
	const fullShape = createFullShapeEmitter(ir, ref)
	const children = (expected: readonly string[] | null): JsonSchema => {
		const known = expected?.filter(type => ir.plugins.some(plugin => plugin.type === type)) ?? []
		return known.length === 0 ? anyWidget : known.length === 1 ? ref('widget', known[0]!) : { anyOf: known.map(type => ref('widget', type)) }
	}

	const defs: Record<string, JsonSchema> = {
		widget: { anyOf: ir.plugins.map(plugin => ref('widget', plugin.type)) },
	}
	for (const plugin of ir.plugins) {
		const properties: Record<string, JsonSchema> = {
			id: { type: 'string', description: 'Unique within the document.' },
			type: { const: plugin.type },
			meta: { description: 'Reserved for tools: any JSON value, never interpreted by Core.' },
		}
		const required = ['id', 'type']
		if (plugin.config !== null) {
			const config = fullShape(plugin.config.rawShape)
			properties.config = describe(plugin.config.omittable ? { anyOf: [config, { type: 'null' }] } : config, describeDoc(plugin.config.doc, false))
			if (!plugin.config.omittable)
				required.push('config')
		}
		// A declared but empty slot set (`slots: never`) still accepts `slots: {}`.
		if (plugin.capabilities.slots) {
			properties.slots = {
				type: 'object',
				properties: Object.fromEntries(plugin.slots.map(slot => [slot.name, describe({ type: 'array', items: children(slot.expected) }, slotDescription(slot))])),
				additionalProperties: false,
			}
		}
		defs[key('widget', plugin.type)] = describe({ type: 'object', properties, required, additionalProperties: false }, pluginDescription(plugin))
	}
	for (const [name, type] of Object.entries(ir.types))
		defs[key('type', name)] = describe(placeConstraints(ir, fullShape(type.shape), type.shape, type.doc).schema, describeDoc(type.doc, false))
	return {
		$schema: DIALECT,
		title: `${ir.system} document`,
		description: `A widget document of ${ir.system}: one root widget and its slot children. Structure only; compile the Blueprint for the authoritative diagnostics.`,
		$ref: '#/$defs/widget',
		$defs: defs,
	}
}

// -------------------------------------------------------------------------------------------------
// LLM profile
// -------------------------------------------------------------------------------------------------

const ENTRY_LIST_NOTE = 'A dictionary: in this schema it is written as a list of { "key", "value" } entries with unique keys, for example [{ "key": "a", "value": ... }], not as an object. Where the text above shows the object form, write the entry list instead.'

export function emitLlmSchema(ir: SystemIr): JsonSchema {
	const recursive = recursiveTypeNames(ir)
	const { encode } = createValueEncoding(ir)
	const key = createDefKeys()

	/** `@default` and `@examples` are authored in the tree form; the description shows them as this schema wants them. */
	const formatter = (shape: Shape) => (jsonText: string, isList: boolean): string => {
		const value = parseJson(jsonText)
		if (typeof value === 'string' && value === jsonText)
			return jsonText
		return JSON.stringify(isList && Array.isArray(value) ? value.map(item => encode(item, shape)) : encode(value, shape))
	}

	/** The JSDoc text and the constraint tags as prose, worded for where each tag lands on a value of `shape`. */
	const slotSchema = createFullShapeEmitter(ir, (_prefix, name) => ({ $ref: `#/$defs/type_${name}` }))
	const describeConstraints = (doc: Doc, shape: Shape): string => {
		const { slots } = placeConstraints(ir, slotSchema(shape), shape, doc)
		return describeDoc(doc, true, formatter(shape), slots, coreOf(ir, shape).shape.kind === 'record')
	}

	const llmShape = (shape: Shape): JsonSchema => {
		switch (shape.kind) {
			case 'string':
			case 'number':
			case 'boolean':
			case 'null':
				return { type: shape.kind }
			case 'unknown':
				return { type: 'string', description: 'Any JSON value, written as JSON text (for example "{\\"a\\":1}").' }
			case 'literal':
				return { type: jsonTypeOf(shape.value), const: shape.value }
			case 'array':
				return { type: 'array', items: llmShape(shape.items) }
			case 'record':
				return {
					type: 'array',
					description: ENTRY_LIST_NOTE,
					items: {
						type: 'object',
						properties: { key: { type: 'string' }, value: llmShape(shape.value) },
						required: ['key', 'value'],
						additionalProperties: false,
					},
				}
			case 'ref':
				return recursive.has(shape.name) || ir.types[shape.name] === undefined
					? { type: 'string', description: `A ${shape.name} value, written as JSON text.` }
					: { $ref: `#/$defs/${key('type', shape.name)}` }
			case 'union': {
				const values = literalEnum(shape.members)
				if (values !== null && new Set(values.map(jsonTypeOf)).size === 1)
					return { type: jsonTypeOf(values[0]!), enum: values }
				return { anyOf: shape.members.map(llmShape) }
			}
			case 'object':
				return describe({
					type: 'object',
					properties: Object.fromEntries(shape.properties.map((property) => {
						const own = [describeConstraints(property.doc, property.shape), property.optional ? 'Optional: leave the key out when unused.' : ''].filter(part => part !== '')
							.join(' ')
						return [property.name, describe(llmShape(property.shape), own)]
					})),
					required: shape.properties.filter(property => !property.optional)
						.map(property => property.name),
					additionalProperties: false,
				}, shape.additional === undefined ? '' : INDEX_SIGNATURE_NOTE)
		}
	}

	const slotNames = [...new Set(ir.plugins.flatMap(plugin => plugin.slots.map(slot => slot.name)))]
	const defs: Record<string, JsonSchema> = {}
	for (const plugin of ir.plugins) {
		// A slot that names no plugin type (`WidgetChild`, a contract without `Types`) takes any widget.
		const accepting = ir.plugins.flatMap(parent => parent.slots
			.filter(slot => slot.expected === null || slot.expected.includes(plugin.type))
			.map(slot => `${parent.type}.${slot.name}`))
		const placement = accepting.length > 0
			? ` A ${plugin.type} may go into: ${accepting.join(', ')}.`
			: ` No slot takes a ${plugin.type}: it can only be the root.`
		const properties: Record<string, JsonSchema> = {
			id: { type: 'string', description: 'Unique within the document. Other nodes name it in "parent".' },
			type: { type: 'string', const: plugin.type },
			parent: { type: 'string', description: 'The id of the parent node. Leave the key out on the one root node.' },
			slot: {
				type: 'string',
				...(slotNames.length === 0 ? {} : { enum: slotNames }),
				description: `The parent's slot this node goes into. Leave the key out on the root node. Children of one slot keep the order they have in "nodes".${placement}`,
			},
		}
		const required = ['id', 'type']
		if (plugin.config !== null) {
			properties.config = describe(llmShape(plugin.config.rawShape), [describeDoc(plugin.config.doc, false), plugin.config.omittable ? 'Optional: leave the key out when unused.' : ''].filter(part => part !== '')
				.join(' '))
			if (!plugin.config.omittable)
				required.push('config')
		}
		if (plugin.slots.length > 0) {
			properties.slots = {
				type: 'array',
				items: { type: 'string', enum: plugin.slots.map(slot => slot.name) },
				description: 'Only needed to declare a slot that has no children; otherwise leave the key out. The slot names of this node, in order.',
			}
		}
		// `meta` is deliberately absent: a model never writes it (the converters still carry it), and every optional
		// property counts against the provider's optional-parameter limit.
		const slotText = plugin.slots.length > 0
			? `Slots: ${plugin.slots.map(slot => `${slot.name} (${slot.expected === null ? 'any widget' : slot.expected.join(', ')})${slot.doc.summary === '' ? '' : `: ${slot.doc.summary}`}`)
				.join('; ')}`
			: 'No slots: it cannot be a parent.'
		defs[key('node', plugin.type)] = describe({ type: 'object', properties, required, additionalProperties: false }, [pluginDescription(plugin), slotText].filter(part => part !== '')
			.join(' '))
	}

	const authored = new Set<string>()
	const reach = (shape: Shape): void => {
		if (shape.kind === 'ref') {
			if (authored.has(shape.name) || recursive.has(shape.name) || ir.types[shape.name] === undefined)
				return
			authored.add(shape.name)
			reach(ir.types[shape.name]!.shape)
		}
		else if (shape.kind === 'array') {
			reach(shape.items)
		}
		else if (shape.kind === 'record') {
			reach(shape.value)
		}
		else if (shape.kind === 'union') {
			shape.members.forEach(reach)
		}
		else if (shape.kind === 'object') {
			shape.properties.forEach(property => reach(property.shape))
			if (shape.additional !== undefined)
				reach(shape.additional)
		}
	}
	for (const plugin of ir.plugins) {
		if (plugin.config !== null)
			reach(plugin.config.rawShape)
	}
	for (const [name, type] of Object.entries(ir.types)) {
		if (authored.has(name))
			defs[key('type', name)] = describe(llmShape(type.shape), describeConstraints(type.doc, type.shape))
	}
	return {
		$schema: DIALECT,
		title: `${ir.system} document (flat node list)`,
		description: 'A widget document as a flat list of nodes. Exactly one node has no parent (the root). Convert it to the tree, compile the Blueprint, and repair from its diagnostics.',
		type: 'object',
		properties: {
			nodes: {
				type: 'array',
				description: 'Every widget of the document, parents before their children.',
				items: { anyOf: ir.plugins.map(plugin => ({ $ref: `#/$defs/${key('node', plugin.type)}` })) },
			},
		},
		required: ['nodes'],
		additionalProperties: false,
		$defs: defs,
	}
}
