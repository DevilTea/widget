/**
 * Schema emitters. Both are JSON Schema Draft 2020-12.
 *
 * - `emitFullSchema`: the document as authored (a recursive tree), with one `$defs` entry per widget type and per
 *   named config type. JSDoc constraint tags become keywords.
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

/** The names of the named types that reach themselves, which the LLM profile cannot express with `$ref`. */
export function recursiveTypeNames(ir: SystemIr): Set<string> {
	const recursive = new Set<string>()
	const reaches = (shape: Shape, target: string, seen: Set<string>): boolean => {
		switch (shape.kind) {
			case 'ref':
				if (shape.name === target)
					return true
				if (seen.has(shape.name) || ir.types[shape.name] === undefined)
					return false
				seen.add(shape.name)
				return reaches(ir.types[shape.name]!.shape, target, seen)
			case 'array':
				return reaches(shape.items, target, seen)
			case 'record':
				return reaches(shape.value, target, seen)
			case 'union':
				return shape.members.some(member => reaches(member, target, seen))
			case 'object':
				return shape.properties.some(property => reaches(property.shape, target, seen))
			default:
				return false
		}
	}
	for (const [name, type] of Object.entries(ir.types)) {
		if (reaches(type.shape, name, new Set()))
			recursive.add(name)
	}
	return recursive
}

/** The summary, remarks and constraints of `doc` as one description. `withConstraints` writes the tags out as prose. */
export function describeDoc(doc: Doc, withConstraints: boolean): string {
	const parts = [doc.summary, doc.remarks].filter(part => part !== '')
	if (withConstraints) {
		const constraints = Object.entries(doc.tags)
			.map(([tag, value]) => tag === 'widgetRef'
				? `Must be the id of a widget of type ${value} in the same document.`
				: `${tag}: ${value}.`)
		if (constraints.length > 0)
			parts.push(`Constraints: ${constraints.join(' ')}`)
	}
	else if (doc.tags.widgetRef !== undefined) {
		parts.push(`Must be the id of a widget of type ${doc.tags.widgetRef} in the same document.`)
	}
	return parts.join(' ')
}

function withDescription(schema: JsonSchema, description: string): JsonSchema {
	return description === '' ? schema : { ...schema, description }
}

function constraintKeywords(doc: Doc): JsonSchema {
	const keywords: JsonSchema = {}
	for (const tag of NUMERIC_TAGS) {
		const value = doc.tags[tag]
		if (value !== undefined && Number.isFinite(Number(value)))
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

// -------------------------------------------------------------------------------------------------
// Full schema
// -------------------------------------------------------------------------------------------------

function fullShape(shape: Shape): JsonSchema {
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
			return { $ref: `#/$defs/type_${shape.name}` }
		case 'union': {
			const values = literalEnum(shape.members)
			return values !== null ? { enum: values } : { anyOf: shape.members.map(fullShape) }
		}
		case 'object':
			return {
				type: 'object',
				properties: Object.fromEntries(shape.properties.map(property => [property.name, withDescription({ ...fullShape(property.shape), ...constraintKeywords(property.doc) }, describeDoc(property.doc, false))])),
				required: shape.properties.filter(property => !property.optional)
					.map(property => property.name),
				additionalProperties: false,
			}
	}
}

function childrenSchema(ir: SystemIr, expected: readonly string[] | null, prefix: string, any: string): JsonSchema {
	const known = expected?.filter(type => ir.plugins.some(plugin => plugin.type === type)) ?? []
	return known.length === 0 ? { $ref: any } : known.length === 1 ? { $ref: `${prefix}${known[0]}` } : { anyOf: known.map(type => ({ $ref: `${prefix}${type}` })) }
}

function pluginDescription(plugin: PluginIr): string {
	return describeDoc(plugin.doc, false) || plugin.runtimeDescription || ''
}

export function emitFullSchema(ir: SystemIr): JsonSchema {
	const defs: Record<string, JsonSchema> = {
		widget: { anyOf: ir.plugins.map(plugin => ({ $ref: `#/$defs/widget_${plugin.type}` })) },
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
			properties.config = withDescription(plugin.config.omittable ? { anyOf: [config, { type: 'null' }] } : config, plugin.config.runtimeDescription ?? '')
			if (!plugin.config.omittable)
				required.push('config')
		}
		if (plugin.slots.length > 0) {
			properties.slots = {
				type: 'object',
				properties: Object.fromEntries(plugin.slots.map(slot => [slot.name, withDescription({ type: 'array', items: childrenSchema(ir, slot.expected, '#/$defs/widget_', '#/$defs/widget') }, describeDoc(slot.doc, false) || slot.runtimeDescription || '')])),
				additionalProperties: false,
			}
		}
		defs[`widget_${plugin.type}`] = withDescription({ type: 'object', properties, required, additionalProperties: false }, pluginDescription(plugin))
	}
	for (const [name, type] of Object.entries(ir.types))
		defs[`type_${name}`] = withDescription(fullShape(type.shape), describeDoc(type.doc, false))
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

function llmShape(shape: Shape, recursive: ReadonlySet<string>): JsonSchema {
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
			return { type: 'array', items: llmShape(shape.items, recursive) }
		case 'record':
			return {
				type: 'array',
				description: 'A dictionary, written as a list of entries. Keys must be unique.',
				items: {
					type: 'object',
					properties: { key: { type: 'string' }, value: llmShape(shape.value, recursive) },
					required: ['key', 'value'],
					additionalProperties: false,
				},
			}
		case 'ref':
			return recursive.has(shape.name)
				? { type: 'string', description: `A ${shape.name} value, written as JSON text (the type is recursive).` }
				: { $ref: `#/$defs/type_${shape.name}` }
		case 'union': {
			const values = literalEnum(shape.members)
			if (values !== null && new Set(values.map(jsonTypeOf)).size === 1)
				return { type: jsonTypeOf(values[0]!), enum: values }
			return { anyOf: shape.members.map(member => llmShape(member, recursive)) }
		}
		case 'object':
			return {
				type: 'object',
				properties: Object.fromEntries(shape.properties.map((property) => {
					const schema = llmShape(property.shape, recursive)
					const own = describeDoc(property.doc, true)
					const description = [own, property.optional ? 'Optional: leave the key out when unused.' : '', typeof schema.description === 'string' ? schema.description : ''].filter(part => part !== '')
						.join(' ')
					return [property.name, withDescription({ ...schema }, description)]
				})),
				required: shape.properties.filter(property => !property.optional)
					.map(property => property.name),
				additionalProperties: false,
			}
	}
}

export function emitLlmSchema(ir: SystemIr): JsonSchema {
	const recursive = recursiveTypeNames(ir)
	const slotNames = [...new Set(ir.plugins.flatMap(plugin => plugin.slots.map(slot => slot.name)))]
	const defs: Record<string, JsonSchema> = {}
	for (const plugin of ir.plugins) {
		const slotLines = ir.plugins.flatMap(parent => parent.slots
			.filter(slot => slot.expected === null || slot.expected.includes(plugin.type))
			.map(slot => `${parent.type}.${slot.name}`))
		const properties: Record<string, JsonSchema> = {
			id: { type: 'string', description: 'Unique within the document. Other nodes name it in "parent".' },
			type: { type: 'string', const: plugin.type },
			parent: { type: 'string', description: 'The id of the parent node. Leave the key out on the one root node.' },
			slot: {
				type: 'string',
				...(slotNames.length === 0 ? {} : { enum: slotNames }),
				description: `The parent's slot this node goes into. Leave the key out on the root node. Children of one slot keep the order they have in "nodes".${slotLines.length > 0 ? ` A ${plugin.type} may go into: ${slotLines.join(', ')}.` : ''}`,
			},
		}
		const required = ['id', 'type']
		if (plugin.config !== null) {
			properties.config = withDescription(llmShape(plugin.config.rawShape, recursive), [plugin.config.runtimeDescription ?? '', plugin.config.omittable ? 'Optional: leave the key out when unused.' : ''].filter(part => part !== '')
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
		defs[`node_${plugin.type}`] = withDescription({
			type: 'object',
			properties,
			required,
			additionalProperties: false,
		}, [pluginDescription(plugin), plugin.slots.length > 0
			? `Slots: ${plugin.slots.map(slot => `${slot.name}${slot.expected === null ? '' : ` (expects ${slot.expected.join(', ')})`}${(slot.doc.summary || slot.runtimeDescription) ? `: ${slot.doc.summary || slot.runtimeDescription}` : ''}`)
				.join('; ')}`
			: 'No slots: it cannot be a parent.'].filter(part => part !== '')
			.join(' '))
	}
	for (const [name, type] of Object.entries(ir.types)) {
		if (!recursive.has(name) && ir.plugins.some(plugin => plugin.config !== null && reachesFromConfig(ir, plugin.config.rawShape, name)))
			defs[`type_${name}`] = withDescription(llmShape(type.shape, recursive), describeDoc(type.doc, true))
	}
	return {
		$schema: DIALECT,
		title: `${ir.system} document (flat node list)`,
		description: 'A widget document as a flat list of nodes. Exactly one node has no parent (the root). Convert it to the tree with flatToTree, compile the Blueprint, and repair from its diagnostics.',
		type: 'object',
		properties: {
			nodes: {
				type: 'array',
				description: 'Every widget of the document, parents before their children.',
				items: { anyOf: ir.plugins.map(plugin => ({ $ref: `#/$defs/node_${plugin.type}` })) },
			},
		},
		required: ['nodes'],
		additionalProperties: false,
		$defs: defs,
	}
}

function reachesFromConfig(ir: SystemIr, shape: Shape, target: string, seen = new Set<string>()): boolean {
	switch (shape.kind) {
		case 'ref':
			if (shape.name === target)
				return true
			if (seen.has(shape.name) || ir.types[shape.name] === undefined)
				return false
			seen.add(shape.name)
			return reachesFromConfig(ir, ir.types[shape.name]!.shape, target, seen)
		case 'array':
			return reachesFromConfig(ir, shape.items, target, seen)
		case 'record':
			return reachesFromConfig(ir, shape.value, target, seen)
		case 'union':
			return shape.members.some(member => reachesFromConfig(ir, member, target, seen))
		case 'object':
			return shape.properties.some(property => reachesFromConfig(ir, property.shape, target, seen))
		default:
			return false
	}
}
