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

import type { Doc, PluginIr, Shape, SystemIr } from './ir'
import { createValueEncoding, recursiveTypeNames } from './encoding'

export { recursiveTypeNames }

export interface JsonSchema { [key: string]: unknown }

const DIALECT = 'https://json-schema.org/draft/2020-12/schema'

const NUMERIC_TAGS = ['minimum', 'maximum', 'exclusiveMinimum', 'exclusiveMaximum', 'multipleOf', 'minLength', 'maxLength', 'minItems', 'maxItems'] as const

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

/** The summary and remarks of `doc`, then its constraint tags as prose. `formatValue` rewrites `@default`/`@examples` values. */
export function describeDoc(doc: Doc, withConstraints: boolean, formatValue: (jsonText: string, isList: boolean) => string = text => text): string {
	const parts = [doc.summary, doc.remarks].filter(part => part !== '')
	if (withConstraints) {
		const constraints = Object.entries(doc.tags)
			.map(([tag, value]) => {
				if (tag === 'widgetRef')
					return `Must be the id of a widget of type ${value} in the same document.`
				if (tag === 'default' || tag === 'examples')
					return `${tag}: ${formatValue(value, tag === 'examples')}.`
				return `${tag}: ${value}.`
			})
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

function constraintKeywords(doc: Doc): JsonSchema {
	const keywords: JsonSchema = {}
	for (const tag of NUMERIC_TAGS) {
		const value = doc.tags[tag]
		if (value !== undefined && value.trim() !== '' && Number.isFinite(Number(value)))
			keywords[tag] = Number(value)
	}
	if (doc.tags.format !== undefined)
		keywords.format = doc.tags.format
	if (doc.tags.pattern !== undefined)
		keywords.pattern = doc.tags.pattern
	if (doc.tags.default !== undefined)
		keywords.default = parseJson(doc.tags.default)
	if (doc.tags.examples !== undefined) {
		const examples = parseJson(doc.tags.examples)
		keywords.examples = Array.isArray(examples) ? examples : [examples]
	}
	return keywords
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
	return describeDoc(plugin.doc, false) || plugin.runtimeDescription || ''
}

// -------------------------------------------------------------------------------------------------
// Full schema
// -------------------------------------------------------------------------------------------------

export function emitFullSchema(ir: SystemIr): JsonSchema {
	const key = createDefKeys()
	const ref = (prefix: string, name: string): JsonSchema => ({ $ref: `#/$defs/${key(prefix, name)}` })
	const anyWidget: JsonSchema = { $ref: '#/$defs/widget' }

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
					properties: Object.fromEntries(shape.properties.map(property => [property.name, describe({ ...fullShape(property.shape), ...constraintKeywords(property.doc) }, describeDoc(property.doc, false))])),
					required: shape.properties.filter(property => !property.optional)
						.map(property => property.name),
					additionalProperties: false,
				}
		}
	}
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
			properties.config = describe(plugin.config.omittable ? { anyOf: [config, { type: 'null' }] } : config, plugin.config.runtimeDescription ?? '')
			if (!plugin.config.omittable)
				required.push('config')
		}
		// A declared but empty slot set (`slots: never`) still accepts `slots: {}`.
		if (plugin.slotForm !== null) {
			properties.slots = {
				type: 'object',
				properties: Object.fromEntries(plugin.slots.map(slot => [slot.name, describe({ type: 'array', items: children(slot.expected) }, describeDoc(slot.doc, false) || slot.runtimeDescription || '')])),
				additionalProperties: plugin.slotsOpen ? { type: 'array', items: anyWidget } : false,
			}
		}
		defs[key('widget', plugin.type)] = describe({ type: 'object', properties, required, additionalProperties: false }, pluginDescription(plugin))
	}
	for (const [name, type] of Object.entries(ir.types))
		defs[key('type', name)] = describe({ ...fullShape(type.shape), ...constraintKeywords(type.doc) }, describeDoc(type.doc, false))
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
				return {
					type: 'object',
					properties: Object.fromEntries(shape.properties.map((property) => {
						const own = [describeDoc(property.doc, true, formatter(property.shape)), property.optional ? 'Optional: leave the key out when unused.' : ''].filter(part => part !== '')
							.join(' ')
						return [property.name, describe(llmShape(property.shape), own)]
					})),
					required: shape.properties.filter(property => !property.optional)
						.map(property => property.name),
					additionalProperties: false,
				}
		}
	}

	const slotNames = [...new Set(ir.plugins.flatMap(plugin => plugin.slots.map(slot => slot.name)))]
	const anyOpen = ir.plugins.some(plugin => plugin.slotsOpen)
	const allSlots = ir.plugins.flatMap(parent => parent.slots.map(slot => `${parent.type}.${slot.name}`))
	const defs: Record<string, JsonSchema> = {}
	for (const plugin of ir.plugins) {
		// Only a slot that names its expected children says where a type may go. The 0.2 string-union form does
		// not, so nothing is claimed per type (the root type, for one, goes into no slot at all).
		const explicit = ir.plugins.flatMap(parent => parent.slots
			.filter(slot => slot.expected?.includes(plugin.type) === true)
			.map(slot => `${parent.type}.${slot.name}`))
		const placement = explicit.length > 0
			? ` A ${plugin.type} may go into: ${explicit.join(', ')}.`
			: allSlots.length > 0 ? ` The slots of this System: ${allSlots.join(', ')}; each slot's description says which types it takes.` : ''
		const properties: Record<string, JsonSchema> = {
			id: { type: 'string', description: 'Unique within the document. Other nodes name it in "parent".' },
			type: { type: 'string', const: plugin.type },
			parent: { type: 'string', description: 'The id of the parent node. Leave the key out on the one root node.' },
			slot: {
				type: 'string',
				...(slotNames.length === 0 || anyOpen ? {} : { enum: slotNames }),
				description: `The parent's slot this node goes into. Leave the key out on the root node. Children of one slot keep the order they have in "nodes".${placement}`,
			},
		}
		const required = ['id', 'type']
		if (plugin.config !== null) {
			properties.config = describe(llmShape(plugin.config.rawShape), [plugin.config.runtimeDescription ?? '', plugin.config.omittable ? 'Optional: leave the key out when unused.' : ''].filter(part => part !== '')
				.join(' '))
			if (!plugin.config.omittable)
				required.push('config')
		}
		if (plugin.slotForm !== null && (plugin.slots.length > 0 || plugin.slotsOpen)) {
			properties.slots = {
				type: 'array',
				items: { type: 'string', ...(plugin.slotsOpen ? {} : { enum: plugin.slots.map(slot => slot.name) }) },
				description: 'Only needed to declare a slot that has no children; otherwise leave the key out. The slot names of this node, in order.',
			}
		}
		// `meta` is deliberately absent: a model never writes it (the converters still carry it), and every optional
		// property counts against the provider's optional-parameter limit.
		const slotText = plugin.slots.length > 0
			? `Slots: ${plugin.slots.map(slot => `${slot.name}${slot.expected === null ? '' : ` (expects ${slot.expected.join(', ')})`}${(slot.doc.summary || slot.runtimeDescription) ? `: ${slot.doc.summary || slot.runtimeDescription}` : ''}`)
				.join('; ')}`
			: plugin.slotsOpen ? 'Slots: any name.' : 'No slots: it cannot be a parent.'
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
		}
	}
	for (const plugin of ir.plugins) {
		if (plugin.config !== null)
			reach(plugin.config.rawShape)
	}
	for (const [name, type] of Object.entries(ir.types)) {
		if (authored.has(name))
			defs[key('type', name)] = describe(llmShape(type.shape), describeDoc(type.doc, true, formatter(type.shape)))
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
