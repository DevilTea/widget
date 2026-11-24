import type { Doc, JsonSchema, PluginIr, Shape, SystemIr } from './index'
import { describe, expect, it } from 'vitest'
import { createFlatConverter, createValueEncoding, emitFullSchema, emitLlmSchema, FlatConversionError, validateSchema } from './index'

const doc = (summary = ''): Doc => ({ summary, remarks: '' })
const property = (name: string, shape: Shape, optional = false, documentation = doc()) => ({ name, optional, shape, doc: documentation })
const text: Shape = { kind: 'string' }
const dictionary: Shape = { kind: 'record', value: text }

function plugin(type: string, rawShape: Shape | null, slots: string[] = []): PluginIr {
	return {
		type,
		interfacesName: null,
		doc: doc(`The ${type} widget.`),
		capabilities: { config: rawShape !== null, slots: slots.length > 0, state: false, properties: false, methods: false, events: false },
		config: rawShape === null ? null : { doc: doc('The config.'), rawText: 'Config', resolvedText: 'Config', rawShape, resolvedShape: rawShape, omittable: false },
		slots: slots.map(name => ({ name, doc: doc(), expected: null, contract: null, expectationText: 'WidgetChild' })),
		state: [],
		properties: [],
		methods: [],
		events: [],
		reasons: null,
		typeNames: [],
	}
}

function system(plugins: PluginIr[], types: SystemIr['types'] = {}): SystemIr {
	return { irVersion: 3, system: 'testSystem', module: 'test.ts', plugins, types, mismatches: [], prose: true, docsIssues: [], docsCount: { descriptions: 0, documented: 0 } }
}

/** `{ kind: 'text', labels: Record } | { kind: 'image', labels: string[], alt?: Record }`: both members are objects. */
const textBlock: Shape = { kind: 'object', properties: [property('kind', { kind: 'literal', value: 'text' }), property('labels', dictionary)] }
const imageBlock: Shape = { kind: 'object', properties: [property('kind', { kind: 'literal', value: 'image' }), property('labels', { kind: 'array', items: text }), property('alt', dictionary, true)] }
const blocks = system([plugin('Blocks', { kind: 'object', properties: [property('block', { kind: 'union', members: [textBlock, imageBlock] })] })])

describe('union members are chosen by discriminant and required keys', () => {
	it('encodes and decodes the member the literal discriminant names, not the first object member', () => {
		const { encode, decode } = createValueEncoding(blocks)
		const shape = blocks.plugins[0]!.config!.rawShape
		const image = { block: { kind: 'image', labels: ['a', 'b'], alt: { en: 'A picture' } } }
		const encodedImage = encode(image, shape)
		// With first-object-member matching, `labels` would have been treated as the text member's dictionary.
		expect(encodedImage)
			.toEqual({ block: { kind: 'image', labels: ['a', 'b'], alt: [{ key: 'en', value: 'A picture' }] } })
		expect(decode(encodedImage, shape))
			.toStrictEqual(image)

		const textValue = { block: { kind: 'text', labels: { en: 'Hello' } } }
		expect(encode(textValue, shape))
			.toEqual({ block: { kind: 'text', labels: [{ key: 'en', value: 'Hello' }] } })
		expect(decode(encode(textValue, shape), shape))
			.toStrictEqual(textValue)
	})

	it('chooses by required keys when no property is a discriminant', () => {
		const byName: Shape = { kind: 'object', properties: [property('name', text), property('labels', dictionary)] }
		const byId: Shape = { kind: 'object', properties: [property('id', text), property('labels', { kind: 'array', items: text })] }
		const ir = system([plugin('Pick', { kind: 'union', members: [byName, byId] })])
		const { encode } = createValueEncoding(ir)
		expect(encode({ id: 'x', labels: ['a'] }, ir.plugins[0]!.config!.rawShape))
			.toEqual({ id: 'x', labels: ['a'] })
		expect(encode({ name: 'x', labels: { en: 'a' } }, ir.plugins[0]!.config!.rawShape))
			.toEqual({ name: 'x', labels: [{ key: 'en', value: 'a' }] })
	})

	it('leaves a value that fits no member unchanged', () => {
		const { encode, decode } = createValueEncoding(blocks)
		const shape = blocks.plugins[0]!.config!.rawShape
		const wrong = { block: { kind: 'video', labels: { en: 'x' } } }
		expect(encode(wrong, shape))
			.toStrictEqual(wrong)
		expect(decode(wrong, shape))
			.toStrictEqual(wrong)
	})

	it('round-trips a document through the flat form', () => {
		const { treeToFlat, flatToTree } = createFlatConverter(blocks)
		const tree = { id: 'a', type: 'Blocks', config: { block: { kind: 'image', labels: ['x'], alt: { en: 'y' } } } }
		expect(flatToTree(JSON.parse(JSON.stringify(treeToFlat(structuredClone(tree))))))
			.toStrictEqual(tree)
	})
})

describe('untyped and recursive values', () => {
	const recursive = system(
		[plugin('Tree', { kind: 'object', properties: [property('root', { kind: 'ref', name: 'Node' }), property('extra', { kind: 'unknown' }, true)] })],
		{ Node: { name: 'Node', text: 'interface Node { children: Node[] }', file: 'test.ts', doc: doc('A node.'), shape: { kind: 'object', properties: [property('children', { kind: 'array', items: { kind: 'ref', name: 'Node' } })] } } },
	)

	it('are JSON text in the flat form and the same value again in the tree', () => {
		const { encode, decode } = createValueEncoding(recursive)
		const shape = recursive.plugins[0]!.config!.rawShape
		const value = { root: { children: [{ children: [] }] }, extra: [1, 'two'] }
		const encoded = encode(value, shape)
		expect(encoded)
			.toEqual({ root: '{"children":[{"children":[]}]}', extra: '[1,"two"]' })
		expect(decode(encoded, shape))
			.toStrictEqual(value)
	})

	it('never become a recursive $ref in the LLM schema', () => {
		const schema = emitLlmSchema(recursive)
		expect(JSON.stringify(schema)).not.toContain('type_Node')
		expect(validateSchema(schema, { nodes: [{ id: 'a', type: 'Tree', config: { root: '{"children":[]}' } }] }))
			.toEqual([])
	})
})

describe('$defs keys', () => {
	const odd = system(
		[plugin('My Type/1', { kind: 'ref', name: 'Config<A>' }), plugin('My_Type_1', null)],
		{ 'Config<A>': { name: 'Config<A>', text: '', file: 'test.ts', doc: doc(), shape: { kind: 'object', properties: [property('a', text)] } } },
	)

	it('are restricted to [A-Za-z0-9_.-] and stay distinct', () => {
		for (const schema of [emitFullSchema(odd), emitLlmSchema(odd)]) {
			const keys = Object.keys(schema.$defs as object)
			expect(keys.every(key => /^[\w.-]+$/.test(key)), keys.join(', '))
				.toBe(true)
			expect(new Set(keys).size)
				.toBe(keys.length)
		}
		expect(Object.keys(emitFullSchema(odd).$defs as object))
			.toEqual(['widget', 'widget_My_Type_1', 'widget_My_Type_1_2', 'type_Config_A_'])
	})

	it('resolve, with the original type name still the value of "type"', () => {
		const full = emitFullSchema(odd)
		expect(validateSchema(full, { id: 'a', type: 'My Type/1', config: { a: 'x' } }))
			.toEqual([])
		expect(validateSchema(full, { id: 'a', type: 'My_Type_1' }))
			.toEqual([])
		expect(validateSchema(full, { id: 'a', type: 'My Type/1', config: { a: 1 } })).not.toEqual([])
		expect(validateSchema(emitLlmSchema(odd), { nodes: [{ id: 'a', type: 'My Type/1', config: { a: 'x' } }] }))
			.toEqual([])
	})
})

describe('widget references in the two schemas', () => {
	const referring = system([plugin('Referring', {
		kind: 'object',
		properties: [
			property('target', { kind: 'string', widgetRef: ['A', 'B'] }, true, doc('The widget to follow.')),
			property('others', { kind: 'array', items: { kind: 'string', widgetRef: ['A'] } }, false, doc('More widgets.')),
			property('count', { kind: 'number' }, true, doc('How many: at least 1.')),
		],
	})])
	const configOf = (schema: JsonSchema, node: string): Record<string, JsonSchema> =>
		((schema.$defs as Record<string, JsonSchema>)[node]!.properties as Record<string, JsonSchema>).config!.properties as Record<string, JsonSchema>

	it('are annotated strings in the full schema (`x-widgetRef`, which the Lab reads), with the sentence for readers; a constraint stays prose', () => {
		const config = configOf(emitFullSchema(referring), 'widget_Referring')
		expect(config.target)
			.toEqual({ 'type': 'string', 'x-widgetRef': ['A', 'B'], 'description': 'The widget to follow. Must be the id of a widget of type A | B in the same document.' })
		expect(config.others)
			.toEqual({ type: 'array', items: { 'type': 'string', 'x-widgetRef': ['A'], 'description': 'Must be the id of a widget of type A in the same document.' }, description: 'More widgets.' })
		expect(config.count)
			.toEqual({ type: 'number', description: 'How many: at least 1.' })
		expect(validateSchema(emitFullSchema(referring), { id: 'r', type: 'Referring', config: { target: 'a', others: [] } }))
			.toEqual([])
	})

	it('are prose in the LLM schema, the sentence before the optional note', () => {
		const config = configOf(emitLlmSchema(referring), 'node_Referring')
		expect(config.target)
			.toEqual({ type: 'string', description: 'The widget to follow. Must be the id of a widget of type A | B in the same document. Optional: leave the key out when unused.' })
		expect(config.others)
			.toEqual({ type: 'array', items: { type: 'string', description: 'Must be the id of a widget of type A in the same document.' }, description: 'More widgets.' })
	})
})

describe('validateSchema', () => {
	it('throws on a keyword it does not implement instead of passing', () => {
		expect(() => validateSchema({ type: 'object', patternProperties: {} }, {}))
			.toThrow('"patternProperties" is not implemented')
		expect(() => validateSchema({ properties: { a: { oneOf: [] } } }, { a: 1 }))
			.toThrow('"oneOf" is not implemented')
		expect(() => validateSchema({ $ref: 'https://example.test/schema' }, 1))
			.toThrow('Unsupported $ref')
	})

	it('checks multipleOf', () => {
		expect(validateSchema({ type: 'number', multipleOf: 0.1 }, 0.3))
			.toEqual([])
		expect(validateSchema({ type: 'number', multipleOf: 5 }, 12))
			.toEqual([': not a multiple of 5'])
	})

	it('compares const and enum as JSON values, whatever the key order', () => {
		expect(validateSchema({ const: { a: 1, b: [1, 2] } }, { b: [1, 2], a: 1 }))
			.toEqual([])
		expect(validateSchema({ enum: [{ a: 1, b: 2 }] }, { b: 2, a: 1 }))
			.toEqual([])
		expect(validateSchema({ const: { a: 1 } }, { a: 1, b: 2 }))
			.toEqual([': expected {"a":1}'])
		expect(validateSchema({ const: [1, 2] }, [2, 1]))
			.toEqual([': expected [1,2]'])
	})

	it('resolves $ref as a JSON Pointer with escapes', () => {
		const schema: JsonSchema = { $ref: '#/$defs/a~1b', $defs: { 'a/b': { type: 'string' } } }
		expect(validateSchema(schema, 'x'))
			.toEqual([])
		expect(validateSchema(schema, 1))
			.toEqual([': expected string, got number'])
		expect(validateSchema({ $ref: '#/$defs/missing', $defs: {} }, 1))
			.toEqual([': unresolved $ref #/$defs/missing'])
	})
})

describe('flatToTree', () => {
	it('refuses a root that names a slot', () => {
		const { flatToTree } = createFlatConverter(blocks)
		expect(() => flatToTree({ nodes: [{ id: 'a', type: 'Blocks', slot: 'steps' }] }))
			.toThrow(FlatConversionError)
		expect(() => flatToTree({ nodes: [{ id: 'a', type: 'Blocks', slot: 'steps' }] }))
			.toThrow('has the slot "steps" but no parent')
	})

	it('keeps slots: {} and an empty slot', () => {
		const ir = system([plugin('Box', null, ['items'])])
		const { treeToFlat, flatToTree } = createFlatConverter(ir)
		for (const tree of [{ id: 'a', type: 'Box', slots: {} }, { id: 'a', type: 'Box', slots: { items: [] } }, { id: 'a', type: 'Box' }]) {
			expect(flatToTree(JSON.parse(JSON.stringify(treeToFlat(structuredClone(tree))))))
				.toStrictEqual(tree)
		}
	})
})
