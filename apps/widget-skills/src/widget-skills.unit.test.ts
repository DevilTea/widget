import type { JsonSchema, SystemIr } from './index'
import { readdirSync, readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { inspectPlugin } from '@deviltea/widget-core/inspection'
import { beforeAll, describe, expect, it } from 'vitest'
import { surveySystem } from '../fixtures/survey-system'
import { undocumentedSystem } from './fixtures/undocumented-system'
import { applyRuntimeFacts, checkIr, collectRuntimeFacts, createFlatConverter, emitConfigSchema, emitDocs, emitFullSchema, emitLlmSchema, extractIr, FlatConversionError, generateFiles, validateSchema } from './index'

const here = dirname(fileURLToPath(import.meta.url))
const root = resolve(here, '../../..')
const tsconfigPath = resolve(here, '../tsconfig.json')
const example = JSON.parse(readFileSync(resolve(here, '../fixtures/survey-example.json'), 'utf8')) as Record<string, unknown>

// Building a TypeScript program is the slow part; every test shares the two extractions.
let ir: SystemIr
let fixtureIr: SystemIr

beforeAll(() => {
	// The same options as `pnpm generate:example`, so the committed example can be compared.
	ir = extractIr({
		modulePath: resolve(here, '../fixtures/survey-system.ts'),
		exportName: 'surveySystem',
		tsconfigPath,
		runtime: collectRuntimeFacts(surveySystem, inspectPlugin as never),
		cwd: root,
	})
	fixtureIr = extractIr({
		modulePath: resolve(here, 'fixtures/undocumented-system.ts'),
		exportName: 'undocumentedSystem',
		tsconfigPath,
		runtime: collectRuntimeFacts(undocumentedSystem, inspectPlugin as never),
		cwd: root,
	})
}, 180_000)

/** Invalid variants of the example, each with the reason it is invalid. */
function invalidSources(): [string, unknown][] {
	const slots = example.slots as Record<string, unknown[]>
	return [
		['an unrecognized widget key', { ...example, extra: 1 }],
		['a title that is not per language', { ...example, config: { title: 'not per language' } }],
		['an unregistered type in a slot', { ...example, slots: { ...slots, questions: [{ id: 'x', type: 'Nope' }] } }],
		['an undeclared slot', { ...example, slots: { ...slots, other: [] } }],
		['a Rating in the footer, which expects Note', { ...example, slots: { ...slots, footer: [{ id: 'r', type: 'Rating', config: { question: { en: 'Q' } } }] } }],
		['a Note in the questions, which expect Rating or Choice', { ...example, slots: { ...slots, questions: [{ id: 'n', type: 'Note' }] } }],
	]
}

describe('extractIr on the fixture System', () => {
	it('lists the plugin types in registration order and agrees with the runtime', () => {
		expect(ir.irVersion)
			.toBe(2)
		expect(ir.plugins.map(plugin => plugin.type))
			.toEqual(['Survey', 'Rating', 'Choice', 'Note'])
		expect(ir.plugins.map(plugin => plugin.type))
			.toEqual(surveySystem.catalog.widgets.map(widget => widget.type))
		expect(ir.mismatches)
			.toEqual([])
		expect(ir.plugins.map(plugin => plugin.capabilities))
			.toEqual(surveySystem.catalog.widgets.map(widget => ({ ...widget.capabilities })))
	})

	it('reads the plugin summary and remarks from the JSDoc of the Interfaces type', () => {
		expect(ir.plugins[0]!)
			.toMatchObject({
				interfacesName: 'SurveyInterfaces',
				doc: { summary: 'A survey: a header, the questions in order, and a footer note.', remarks: 'The root of a survey document. It counts the answered questions through the `questions` contract.' },
			})
	})

	it('reads slot records in all three forms, with their JSDoc', () => {
		expect(ir.plugins[0]!.slots)
			.toEqual([
				{ name: 'header', doc: { summary: 'Anything shown above the questions.', remarks: '', tags: {}, unknownTags: [] }, expected: null, contract: null, expectationText: 'WidgetChild' },
				{
					name: 'questions',
					doc: { summary: 'The questions, in order.', remarks: 'Every question exposes whether it was answered.', tags: {}, unknownTags: [] },
					expected: ['Rating', 'Choice'],
					contract: '{ properties: { answered: boolean; }; }',
					expectationText: 'WidgetContract<{ properties: { answered: boolean } }, \'Rating\' | \'Choice\'>',
				},
				{ name: 'footer', doc: { summary: 'Closing notes shown under the questions.', remarks: '', tags: {}, unknownTags: [] }, expected: ['Note'], contract: null, expectationText: '\'Note\'' },
			])
		// A contract without `Types` names no plugin type: any widget with the members.
		expect(fixtureIr.plugins[0]!.slots.map(slot => [slot.name, slot.expected, slot.contract]))
			.toEqual([['items', null, null], ['labelled', null, '{ properties: { label: string; }; }']])
		// No slots capability: no slots, and the capability says so.
		expect(ir.plugins[1]!)
			.toMatchObject({ slots: [], capabilities: { slots: false } })
	})

	it('reads each reason with its payload type and JSDoc; a void reason has no payload', () => {
		const survey = ir.plugins[0]!
		expect(survey.reasons!.map(reason => [reason.name, reason.payload?.typeText ?? null, reason.doc.summary]))
			.toEqual([
				['empty-title', null, 'The title has no language.'],
				['too-many-questions', '{ max: number; count: number; }', 'The `questions` slot holds more questions than `maxQuestions` allows.'],
			])
		expect(survey.reasons![1]!.payload!.shape)
			.toMatchObject({ kind: 'object', properties: [{ name: 'max', doc: { summary: 'The configured maximum.' } }, { name: 'count', doc: { summary: 'How many questions the slot holds.' } }] })
		expect(ir.plugins[3]!.reasons)
			.toBeNull()
	})

	it('reads config JSDoc, omittability, members, signatures and labelled payloads', () => {
		const [survey, rating, choice, note] = ir.plugins
		expect(survey!.config)
			.toMatchObject({ doc: { summary: 'How the survey is titled and where it is sent.' }, rawText: 'SurveyRawConfig', rawShape: { kind: 'ref', name: 'SurveyRawConfig' }, omittable: false })
		expect(note!.config)
			.toMatchObject({ doc: { summary: 'The text of the note.', remarks: 'Leave the config out for an empty note.' }, omittable: true })
		expect(rating!.state.map(member => [member.name, member.typeText, member.authorWritable]))
			.toEqual([['value', 'number | null', true]])
		expect(choice!.state.map(member => [member.name, member.authorWritable]))
			.toEqual([['selected', false]])
		expect(rating!.methods[0]!)
			.toMatchObject({ signature: 'rate(value: number): number', params: [{ name: 'value', doc: 'The value, from 1 to the scale.' }], returnsDoc: 'The chosen value.' })
		expect(survey!.events.map(event => [event.name, event.payload.map(item => [item.label, item.typeText])]))
			.toEqual([['submitted', [['summary', 'SubmitSummary']]]])
		expect(ir.types.SurveyRawConfig!.shape)
			.toMatchObject({ kind: 'object', properties: [{ name: 'title' }, { name: 'maxQuestions', optional: true, doc: { tags: { minimum: '1', maximum: '20', default: '10' } } }, { name: 'submitUrl', doc: { tags: { format: 'uri' } } }] })
		expect(ir.types.I18nText!)
			.toMatchObject({ file: 'apps/widget-skills/fixtures/survey-system.ts', shape: { kind: 'record', value: { kind: 'string' } } })
	})

	it('records every name and capability the types and the runtime disagree on', () => {
		const copy = structuredClone(ir)
		const facts = collectRuntimeFacts(surveySystem, inspectPlugin as never)
		facts.plugins[1]!.state = [{ name: 'value', authorWritable: true }, { name: 'extra', authorWritable: false }]
		facts.plugins[0]!.slots = ['header', 'questions']
		facts.plugins[3]!.capabilities = { ...facts.plugins[3]!.capabilities, methods: true }
		copy.mismatches = []
		applyRuntimeFacts(copy, facts)
		expect(copy.mismatches)
			.toEqual([
				'Survey.slots: declared in the types but not at runtime: footer.',
				'Rating.state: declared at runtime but not in the types: extra.',
				'Note.methods: the types do not declare the capability but the runtime does.',
			])
		expect(checkIr(copy).problems.filter(problem => problem.kind === 'name-mismatch'))
			.toHaveLength(3)
	})
})

describe('emitFullSchema', () => {
	it('accepts the example and rejects each invalid variant, slot expectations included', () => {
		const schema = emitFullSchema(ir)
		expect(schema.$schema)
			.toBe('https://json-schema.org/draft/2020-12/schema')
		expect(validateSchema(schema, example))
			.toEqual([])
		for (const [label, source] of invalidSources())
			expect(validateSchema(schema, source), label).not.toEqual([])
	})

	it('describes each slot with its JSDoc and expectation', () => {
		const defs = emitFullSchema(ir).$defs as Record<string, JsonSchema>
		const slots = (defs.widget_Survey!.properties as Record<string, JsonSchema>).slots!.properties as Record<string, JsonSchema>
		expect(slots.questions)
			.toEqual({
				type: 'array',
				items: { anyOf: [{ $ref: '#/$defs/widget_Rating' }, { $ref: '#/$defs/widget_Choice' }] },
				description: 'The questions, in order. Every question exposes whether it was answered. Expects Rating or Choice with the members { properties: { answered: boolean; }; }.',
			})
		expect(slots.header)
			.toEqual({ type: 'array', items: { $ref: '#/$defs/widget' }, description: 'Anything shown above the questions. Expects any widget.' })
	})
})

describe('emitConfigSchema', () => {
	it('is the full-profile schema of config.raw, with field descriptions and only the named types it reaches', () => {
		const schema = emitConfigSchema(ir, ir.plugins[0]!)!
		expect(schema)
			.toMatchObject({
				$schema: 'https://json-schema.org/draft/2020-12/schema',
				title: 'Survey config',
				description: 'How the survey is titled and where it is sent.',
				$ref: '#/$defs/type_SurveyRawConfig',
			})
		const raw = (schema.$defs as Record<string, JsonSchema>).type_SurveyRawConfig!
		expect((raw.properties as Record<string, JsonSchema>).maxQuestions)
			.toEqual({ type: 'number', minimum: 1, maximum: 20, default: 10, description: 'The most questions the survey may hold.' })
		expect((raw.properties as Record<string, JsonSchema>).submitUrl)
			.toEqual({ type: 'string', format: 'uri', description: 'Where the answers are sent.' })
		expect(Object.keys(schema.$defs as object))
			.toEqual(['type_SurveyRawConfig', 'type_I18nText'])
	})

	it('allows null for an omittable config, writes @widgetRef as prose, and is null without a config', () => {
		expect(emitConfigSchema(ir, ir.plugins[3]!)!.anyOf)
			.toEqual([expect.objectContaining({ type: 'object' }), { type: 'null' }])
		const choice = emitConfigSchema(ir, ir.plugins[2]!)!
		const properties = choice.properties as Record<string, JsonSchema>
		expect(properties.followUp!.description)
			.toBe('A question shown once this one is answered. Must be the id of a widget of type Rating | Choice in the same document.')
		expect(properties.options)
			.toMatchObject({ type: 'array', minItems: 2 })
		expect(emitConfigSchema(ir, { ...ir.plugins[3]!, config: null }))
			.toBeNull()
	})

	it('accepts the configs of the example and rejects a wrong one', () => {
		const configOf = (id: string): unknown => {
			const visit = (node: Record<string, unknown>): unknown => node.id === id
				? node.config ?? null
				: Object.values((node.slots ?? {}) as Record<string, Record<string, unknown>[]>)
						.flat()
						.map(visit)
						.find(found => found !== undefined)
			return visit(example)
		}
		const byType: Record<string, string> = { Survey: 'survey', Rating: 'overall', Choice: 'topics', Note: 'thanks' }
		for (const plugin of ir.plugins) {
			expect(validateSchema(emitConfigSchema(ir, plugin)!, configOf(byType[plugin.type]!)), plugin.type)
				.toEqual([])
		}
		expect(validateSchema(emitConfigSchema(ir, ir.plugins[1]!)!, { question: { en: 'Q' }, scale: 'five' })).not.toEqual([])
	})
})

const ALLOWED_KEYWORDS = new Set(['$schema', 'title', 'description', 'type', 'properties', 'required', 'items', 'enum', 'const', 'anyOf', '$defs', '$ref', 'additionalProperties'])

/** Every violation of the LLM profile in `schema`. */
function profileViolations(schema: JsonSchema): string[] {
	const violations: string[] = []
	const defs = (schema.$defs ?? {}) as Record<string, JsonSchema>
	const visit = (node: unknown, path: string, isPropertiesMap: boolean): void => {
		if (typeof node !== 'object' || node === null)
			return
		if (Array.isArray(node)) {
			node.forEach((item, index) => visit(item, `${path}/${index}`, false))
			return
		}
		const object = node as JsonSchema
		if (isPropertiesMap) {
			for (const [key, value] of Object.entries(object))
				visit(value, `${path}/${key}`, false)
			return
		}
		for (const key of Object.keys(object)) {
			if (!ALLOWED_KEYWORDS.has(key))
				violations.push(`${path}: forbidden keyword ${key}`)
		}
		if ('anyOf' in object && ('type' in object || 'properties' in object))
			violations.push(`${path}: anyOf mixed with type/properties`)
		if (object.type === 'object') {
			if (object.additionalProperties !== false)
				violations.push(`${path}: object without additionalProperties: false`)
			const required = (object.required ?? []) as string[]
			const properties = (object.properties ?? {}) as Record<string, JsonSchema>
			for (const key of required) {
				if (!Object.hasOwn(properties, key))
					violations.push(`${path}: required names the unknown property ${key}`)
			}
			// Optional means "not in required"; a null union on top of that is the strict-mode spelling the profile avoids.
			for (const [key, property] of Object.entries(properties)) {
				if (!required.includes(key) && Array.isArray(property.anyOf) && property.anyOf.some(member => (member as JsonSchema).type === 'null'))
					violations.push(`${path}: optional property ${key} is a null union`)
			}
		}
		if (Array.isArray(object.type))
			violations.push(`${path}: type is a list`)
		if (object.type === 'array' && object.items === undefined)
			violations.push(`${path}: array without items`)
		if (typeof object.$ref === 'string' && defs[object.$ref.replace('#/$defs/', '')] === undefined)
			violations.push(`${path}: unresolved ${object.$ref}`)
		visit(object.properties, `${path}/properties`, true)
		visit(object.$defs, `${path}/$defs`, true)
		visit(object.items, `${path}/items`, false)
		visit(object.anyOf, `${path}/anyOf`, false)
	}
	visit(schema, '#', false)

	// No recursion: following $ref from any definition never comes back to it.
	const refsOf = (node: unknown, into: Set<string>): void => {
		if (typeof node !== 'object' || node === null)
			return
		if (Array.isArray(node)) {
			node.forEach(item => refsOf(item, into))
			return
		}
		for (const [key, value] of Object.entries(node)) {
			if (key === '$ref' && typeof value === 'string')
				into.add(value.replace('#/$defs/', ''))
			else
				refsOf(value, into)
		}
	}
	for (const name of Object.keys(defs)) {
		const seen = new Set<string>()
		const queue = [name]
		while (queue.length > 0) {
			const direct = new Set<string>()
			refsOf(defs[queue.pop()!], direct)
			for (const next of direct) {
				if (next === name) {
					violations.push(`#/$defs/${name}: recursive`)
					queue.length = 0
					break
				}
				if (!seen.has(next)) {
					seen.add(next)
					queue.push(next)
				}
			}
		}
	}
	return violations
}

describe('array and dictionary constraints, named types behind optional properties, unnamed recursion', () => {
	let constraintsIr: SystemIr
	beforeAll(() => {
		constraintsIr = extractIr({ modulePath: resolve(here, 'fixtures/constraints-system.ts'), exportName: 'constraintsSystem', tsconfigPath, cwd: root })
	}, 180_000)

	const formProperties = (): Record<string, JsonSchema> => {
		const schema = emitConfigSchema(constraintsIr, constraintsIr.plugins[0]!)!
		return ((schema.$defs as Record<string, JsonSchema>).type_FormRawConfig!.properties) as Record<string, JsonSchema>
	}

	it('writes the new tags as keywords; a string or number tag on an array or a dictionary constrains each item or value', () => {
		const properties = formProperties()
		expect(properties.fields)
			.toEqual({ type: 'array', items: { type: 'string', pattern: '^[a-z]+$' }, minItems: 1, uniqueItems: true, description: 'The field names, each once.' })
		expect(properties.weights)
			.toEqual({
				type: 'object',
				additionalProperties: { type: 'number', exclusiveMinimum: 0 },
				minProperties: 1,
				maxProperties: 8,
				propertyNames: { pattern: '^[a-z]+$' },
				description: 'Weight per field name.',
			})
		expect(properties.pageSize)
			.toEqual({ type: 'integer', minimum: 1, description: 'How many fields are shown per page.' })
	})

	it('validates the new keywords', () => {
		const schema = emitConfigSchema(constraintsIr, constraintsIr.plugins[0]!)!
		expect(validateSchema(schema, { fields: ['a', 'b'], weights: { a: 1 }, pageSize: 2 }))
			.toEqual([])
		expect(validateSchema(schema, { fields: ['a', 'a'], weights: {}, pageSize: 1.5 }))
			.toEqual(['/fields: items are not unique', '/weights: fewer than 1 properties', '/pageSize: expected integer, got number'])
		expect(validateSchema(schema, { fields: ['a'], weights: { a: 1, b: 1, c: 1, d: 1, e: 1, f: 1, g: 1, h: 1, Hi: 0 } }))
			.toEqual(['/weights: more than 8 properties', '/weights/Hi: not above 0'])
	})

	it('keeps the name of a type behind an optional property and inside a written union', () => {
		const properties = formProperties()
		expect(properties.visibleWhen)
			.toEqual({ $ref: '#/$defs/type_Rule', description: 'Show the form only while this holds.' })
		expect(properties.required)
			.toEqual({ anyOf: [{ type: 'boolean' }, { $ref: '#/$defs/type_Rule' }], description: 'Whether the form must be filled in: always, never, or while a rule holds.' })
	})

	it('leaves an unnamed recursive type untyped instead of expanding it', () => {
		expect(formProperties().extra)
			.toEqual({ description: 'Anything the host stores with the form.' })
	})

	it('states the new tags as prose in the LLM profile', () => {
		const schema = emitLlmSchema(constraintsIr)
		expect(profileViolations(schema))
			.toEqual([])
		const properties = ((schema.$defs as Record<string, JsonSchema>).type_FormRawConfig!.properties) as Record<string, JsonSchema>
		expect(properties.fields!.description)
			.toBe('The field names, each once. Constraints: minItems: 1. uniqueItems. pattern: ^[a-z]+$.')
		expect(properties.pageSize)
			.toEqual({ type: 'number', description: 'How many fields are shown per page. Constraints: integer. minimum: 1. Optional: leave the key out when unused.' })
		expect(properties.weights!.description)
			.toContain('Constraints: propertyNames: ^[a-z]+$. minProperties: 1. maxProperties: 8. exclusiveMinimum: 0.')
	})
})

describe('emitLlmSchema', () => {
	it('obeys the LLM profile', () => {
		const schema = emitLlmSchema(ir)
		expect(schema.type)
			.toBe('object')
		expect(profileViolations(schema))
			.toEqual([])
	})

	it('stays within the optional and union parameter limits the profile is sized for', () => {
		// The limits the owner cited for non-strict structured output: at most 24 optional and 16 union-typed parameters.
		let optional = 0
		let unions = 0
		const count = (node: unknown): void => {
			if (typeof node !== 'object' || node === null)
				return
			if (Array.isArray(node)) {
				node.forEach(count)
				return
			}
			const object = node as JsonSchema
			if (Array.isArray(object.anyOf) && !object.anyOf.every(member => typeof (member as JsonSchema).$ref === 'string' && String((member as JsonSchema).$ref)
				.startsWith('#/$defs/node_'))) {
				unions++
			}
			if (object.type === 'object' && typeof object.properties === 'object' && object.properties !== null) {
				optional += Object.keys(object.properties)
					.filter(key => !((object.required ?? []) as string[]).includes(key)).length
			}
			Object.values(object)
				.forEach(count)
		}
		count(emitLlmSchema(ir))
		expect(optional)
			.toBeLessThanOrEqual(24)
		expect(unions)
			.toBeLessThanOrEqual(16)
		expect(JSON.stringify(emitLlmSchema(ir))).not.toContain('"type":"null"')
	})

	it('the profile walker catches each rule', () => {
		expect(profileViolations({ type: 'object', properties: { a: { anyOf: [{ type: 'string' }, { type: 'null' }] } }, required: [], additionalProperties: false }))
			.toEqual(['#: optional property a is a null union'])
		expect(profileViolations({ type: 'object', properties: {}, required: ['a'], additionalProperties: false }))
			.toEqual(['#: required names the unknown property a'])
		expect(profileViolations({ type: 'object', properties: { a: { type: 'string', minLength: 1 } }, required: ['a'], additionalProperties: false }))
			.toEqual(['#/properties/a: forbidden keyword minLength'])
		expect(profileViolations({ type: 'object', properties: {}, required: [] }))
			.toEqual(['#: object without additionalProperties: false'])
		expect(profileViolations({ type: 'string', anyOf: [{ type: 'null' }] }))
			.toEqual(['#: anyOf mixed with type/properties'])
		expect(profileViolations({ $ref: '#/$defs/a', $defs: { a: { type: 'array', items: { $ref: '#/$defs/a' } } } }))
			.toEqual(['#/$defs/a: recursive'])
	})

	it('validates the flat form of the example, with dictionaries as entry lists', () => {
		const schema = emitLlmSchema(ir)
		const { treeToFlat } = createFlatConverter(ir)
		const flat = treeToFlat(structuredClone(example))
		expect(validateSchema(schema, flat))
			.toEqual([])
		expect(flat.nodes[0])
			.toEqual({
				id: 'survey',
				type: 'Survey',
				config: { title: [{ key: 'en', value: 'How was the workshop?' }, { key: 'zh-TW', value: '工作坊體驗如何？' }], maxQuestions: 5 },
				slots: ['header', 'questions', 'footer'],
			})
		expect(flat.nodes.slice(1)
			.map(node => [node.id, node.parent, node.slot]))
			.toEqual([
				['intro', 'survey', 'header'],
				['overall', 'survey', 'questions'],
				['topics', 'survey', 'questions'],
				['thanks', 'survey', 'footer'],
			])
	})

	it('states where each type may go, from the slot expectations', () => {
		const defs = emitLlmSchema(ir).$defs as Record<string, JsonSchema>
		const placement = (type: string): string => ((defs[`node_${type}`]!.properties as Record<string, JsonSchema>).slot!.description as string)
		expect(placement('Rating'))
			.toContain('A Rating may go into: Survey.header, Survey.questions.')
		expect(placement('Note'))
			.toContain('A Note may go into: Survey.header, Survey.footer.')
		expect(placement('Survey'))
			.toContain('A Survey may go into: Survey.header.')
		expect(defs.node_Survey!.description)
			.toBe('A survey: a header, the questions in order, and a footer note. The root of a survey document. It counts the answered questions through the `questions` contract. Slots: header (any widget): Anything shown above the questions.; questions (Rating, Choice): The questions, in order.; footer (Note): Closing notes shown under the questions.')
	})

	it('puts constraints and the config JSDoc into descriptions, not keywords', () => {
		const defs = emitLlmSchema(ir).$defs as Record<string, JsonSchema>
		const maxQuestions = (defs.type_SurveyRawConfig!.properties as Record<string, JsonSchema>).maxQuestions!
		expect(maxQuestions)
			.toEqual({ type: 'number', description: 'The most questions the survey may hold. Constraints: minimum: 1. maximum: 20. default: 10. Optional: leave the key out when unused.' })
		expect(((defs.node_Survey!.properties as Record<string, JsonSchema>).config!).description)
			.toBe('How the survey is titled and where it is sent.')
		expect(defs.node_Survey!.required)
			.toEqual(['id', 'type', 'config'])
		expect(defs.node_Note!.required)
			.toEqual(['id', 'type'])
	})
})

describe('flat and tree converters', () => {
	it('round-trips valid and invalid sources to exactly the same source and the same compile result', () => {
		const { treeToFlat, flatToTree } = createFlatConverter(ir)
		const sources: [string, unknown][] = [['the example', example], ...invalidSources()]
		for (const [label, source] of sources) {
			// The flat form is JSON: it must survive serialization on its way through a model.
			const roundTripped = flatToTree(JSON.parse(JSON.stringify(treeToFlat(structuredClone(source)))))
			expect(roundTripped, label)
				.toStrictEqual(source)
			// Key order too, for a node of the recognized keys only (an unrecognized key moves behind them).
			if (label === 'the example') {
				expect(JSON.stringify(roundTripped), label)
					.toBe(JSON.stringify(source))
			}
			const expected = surveySystem.createBlueprint(structuredClone(source))
			const actual = surveySystem.createBlueprint(roundTripped)
			expect(actual.status, label)
				.toBe(expected.status)
			expect(actual.diagnostics.map(diagnostic => diagnostic.code), label)
				.toEqual(expected.diagnostics.map(diagnostic => diagnostic.code))
		}
		// Both outcomes occur, so the comparison above is not vacuous.
		expect(new Set(sources.map(([, source]) => surveySystem.createBlueprint(structuredClone(source)).status)))
			.toEqual(new Set(['valid', 'invalid']))
	})

	it('keeps meta, empty slots, an explicit null config and unrecognized keys', () => {
		const { treeToFlat, flatToTree } = createFlatConverter(ir)
		const tree = {
			id: 'root',
			type: 'Survey',
			config: { title: { en: 'T' }, maxQuestions: null, unknownKey: { a: 1 } },
			slots: {
				header: [],
				questions: [
					{ id: 'a', type: 'Rating', config: null, meta: { note: [1, null] } },
					{ id: 'b', type: 'Unregistered', config: { title: { en: 'kept as written' } }, slots: {}, extra: true },
				],
			},
			meta: null,
		}
		const flat = treeToFlat(structuredClone(tree))
		expect(flat.nodes)
			.toEqual([
				{ id: 'root', type: 'Survey', config: { title: [{ key: 'en', value: 'T' }], maxQuestions: null, unknownKey: { a: 1 } }, slots: ['header', 'questions'], meta: null },
				{ id: 'a', type: 'Rating', parent: 'root', slot: 'questions', config: null, meta: { note: [1, null] } },
				{ id: 'b', type: 'Unregistered', parent: 'root', slot: 'questions', config: { title: { en: 'kept as written' } }, slots: [], extra: true },
			])
		expect(flatToTree(JSON.parse(JSON.stringify(flat))))
			.toStrictEqual(tree)
	})

	it('refuses lists that are not one tree', () => {
		const { flatToTree } = createFlatConverter(ir)
		const node = (id: string, parent: string | null) => (parent === null ? { id, type: 'Note' } : { id, type: 'Note', parent, slot: 'footer' })
		expect(() => flatToTree({ nodes: [] }))
			.toThrow(FlatConversionError)
		expect(() => flatToTree({ nodes: [node('a', null), node('b', null)] }))
			.toThrow('More than one node has parent null')
		expect(() => flatToTree({ nodes: [node('a', null), node('b', 'missing')] }))
			.toThrow('which is not a node')
		expect(() => flatToTree({ nodes: [node('a', null), node('a', 'a')] }))
			.toThrow('used more than once')
		expect(() => flatToTree({ nodes: [node('a', null), node('b', 'c'), node('c', 'b')] }))
			.toThrow('cycle')
	})
})

describe('--check', () => {
	it('passes on the fully documented fixture System', () => {
		const result = checkIr(ir)
		expect(result)
			.toMatchObject({ ok: true, problems: [] })
		expect(result.documented)
			.toBe(result.members)
	})

	it('fails on the undocumented fixture plugin, naming the member, the config, the slot, the reason and the unknown tag', () => {
		const result = checkIr(fixtureIr)
		expect(result.ok)
			.toBe(false)
		expect(result.problems)
			.toEqual([
				{ kind: 'missing-doc', severity: 'error', where: 'Counter.config', message: 'Counter.config has no JSDoc.' },
				{ kind: 'missing-doc', severity: 'error', where: 'Counter.slots.items', message: 'Counter.slots.items has no JSDoc.' },
				{ kind: 'missing-doc', severity: 'error', where: 'Counter.state.step', message: 'Counter.state.step has no JSDoc.' },
				{ kind: 'unknown-tag', severity: 'error', where: 'Counter.state.limit', message: 'Counter.state.limit uses the unknown tag @madeUpTag.' },
				{ kind: 'missing-doc', severity: 'error', where: 'Counter.methods.add(by)', message: 'Counter.methods.add has no @param for "by".' },
				{ kind: 'missing-doc', severity: 'error', where: 'Counter.methods.add(options).silent', message: 'Counter.methods.add(options).silent has no JSDoc.' },
				{ kind: 'missing-doc', severity: 'error', where: 'Counter.reasons.too-large', message: 'Counter.reasons.too-large has no JSDoc.' },
				{ kind: 'missing-doc', severity: 'error', where: 'Counter.reasons.too-large.limit', message: 'Counter.reasons.too-large.limit has no JSDoc.' },
			])
		expect(fixtureIr.plugins[0]!.state[0]!.doc)
			.toEqual({ summary: 'The current count.', remarks: '', tags: { minimum: '0' }, unknownTags: [] })
	})

	it('treats a named type a reason payload uses like one config.raw uses', () => {
		const copy = structuredClone(ir)
		copy.types.SubmitSummary!.doc.summary = ''
		// Only an Event payload uses SubmitSummary: a warning.
		expect(checkIr(copy).problems)
			.toEqual([{ kind: 'missing-doc', severity: 'warning', where: 'type SubmitSummary', message: 'type SubmitSummary has no JSDoc.' }])
		copy.plugins[1]!.reasons![0]!.payload = { typeText: 'SubmitSummary', shape: { kind: 'ref', name: 'SubmitSummary' } }
		expect(checkIr(copy).problems.map(problem => problem.severity))
			.toEqual(['error'])
	})
})

describe('emitDocs', () => {
	it('is plain JSON with every section of a plugin', () => {
		const docs = emitDocs(ir)
		expect(JSON.parse(JSON.stringify(docs)))
			.toStrictEqual(docs)
		expect(Object.keys(docs.plugins))
			.toEqual(['Survey', 'Rating', 'Choice', 'Note'])
		const survey = docs.plugins.Survey!
		expect(survey)
			.toMatchObject({
				type: 'Survey',
				summary: 'A survey: a header, the questions in order, and a footer note.',
				config: { summary: 'How the survey is titled and where it is sent.', omittable: false, rawType: 'SurveyRawConfig', schema: emitConfigSchema(ir, ir.plugins[0]!) },
				slots: {
					header: { expectedTypes: null, contract: null, expectation: 'WidgetChild' },
					questions: { expectedTypes: ['Rating', 'Choice'], contract: '{ properties: { answered: boolean; }; }' },
					footer: { summary: 'Closing notes shown under the questions.', expectedTypes: ['Note'] },
				},
				state: { submitted: { summary: 'Whether the survey was sent.', type: 'boolean', authorWritable: false } },
				properties: { progress: { type: 'number', tags: { minimum: '0', maximum: '1' } } },
				methods: { submit: { signature: 'submit(): boolean', params: [], returns: { type: 'boolean', summary: 'Whether the survey was sent by this call.' } } },
				events: { submitted: { summary: 'The survey was sent.', payload: [{ label: 'summary', type: 'SubmitSummary' }] } },
				reasons: { 'empty-title': { details: null }, 'too-many-questions': { details: '{ max: number; count: number; }' } },
			})
		expect(docs.plugins.Rating!.methods!.rate!.params)
			.toEqual([{ name: 'value', type: 'number', optional: false, summary: 'The value, from 1 to the scale.' }])
	})

	it('writes null for an undeclared capability', () => {
		expect(emitDocs(ir).plugins.Note)
			.toMatchObject({ slots: null, state: null, properties: null, methods: null, events: null, reasons: null })
	})
})

describe('the committed example output', () => {
	it('is what the generator writes today', () => {
		const files = generateFiles(ir, { example })
		const directory = resolve(here, '../examples/survey')
		for (const [path, content] of Object.entries(files)) {
			expect(readFileSync(resolve(directory, path), 'utf8'), path)
				.toBe(content)
		}
		// Nothing stale is left behind: the manifest is the complete list.
		const onDisk: string[] = []
		const walk = (relative: string): void => {
			for (const entry of readdirSync(resolve(directory, relative), { withFileTypes: true })) {
				const path = relative === '' ? entry.name : `${relative}/${entry.name}`
				if (entry.isDirectory())
					walk(path)
				else
					onDisk.push(path)
			}
		}
		walk('')
		expect(onDisk.sort())
			.toEqual(Object.keys(files)
				.sort())
	})

	it('shows an example document that compiles without diagnostics', () => {
		expect(surveySystem.createBlueprint(structuredClone(example)))
			.toMatchObject({ status: 'valid', diagnostics: [] })
		expect(generateFiles(ir, { example })['skills/survey-system-source-json-authoring/SKILL.md'])
			.toContain(JSON.stringify(example, null, 2))
	})

	it('does not send readers to the private package, and describes the 0.3 API only', () => {
		const files = generateFiles(ir)
		const authoring = files['skills/survey-system-source-json-authoring/SKILL.md']!
		expect(authoring).not.toContain('@deviltea/widget-skills')
		expect(authoring).not.toContain('flatToTree')
		const renderer = files['skills/survey-system-renderer-implementation/SKILL.md']!
		expect(renderer)
			.toContain('createWidgetVueRenderer(system, renderers => renderers')
		expect(renderer)
			.toContain('returns the Method\'s value on success and `null` on failure')
		expect(renderer).not.toContain('packages/vue/src')
		const plugin = files['skills/widget-plugin-authoring/SKILL.md']!
		expect(plugin).not.toContain('.description(')
		expect(plugin).not.toContain('Upcoming')
		expect(plugin)
			.toContain('`interfaces → config? → slots? → structure? → state? → properties? → methods? → events? → done`')
		for (const content of Object.values(files))
			expect(content).not.toContain('writes nothing and emits nothing')
	})

	it('documents the reasons and their details for repair and for renderers', () => {
		const files = generateFiles(ir)
		expect(files['skills/survey-system-source-json-authoring/references/survey.md'])
			.toContain('- `too-many-questions` (`details: { max: number; count: number; }`): The `questions` slot holds more questions than `maxQuestions` allows.')
		expect(files['skills/survey-system-renderer-implementation/references/rating.md'])
			.toContain('- `out-of-range` (`details: { min: number; max: number; received: number; }`): The value is outside the scale.')
		expect(files['skills/survey-system-source-json-authoring/references/survey.md'])
			.toContain('- `empty-title` (no `details`): The title has no language.')
	})

	it('keeps the type documentation and the entry-list note on a dictionary', () => {
		const description = (emitLlmSchema(ir).$defs as Record<string, JsonSchema>).type_I18nText!.description as string
		expect(description)
			.toContain('Text per language')
		expect(description)
			.toContain('written as a list of { "key", "value" } entries')
	})
})

describe('generateFiles', () => {
	it('writes the IR, both schemas and three skills with frontmatter', () => {
		const files = generateFiles(ir)
		const skills = Object.keys(files)
			.filter(path => path.endsWith('/SKILL.md'))
		expect(skills)
			.toEqual([
				'skills/survey-system-source-json-authoring/SKILL.md',
				'skills/survey-system-renderer-implementation/SKILL.md',
				'skills/widget-plugin-authoring/SKILL.md',
			])
		for (const path of skills) {
			expect(files[path])
				.toMatch(/^---\nname: [a-z0-9-]+\ndescription: ".+"\n---\n/)
		}
		expect(JSON.parse(files['ir.json']!))
			.toEqual(ir)
		expect(files['skills/survey-system-renderer-implementation/references/choice.md'])
			.toContain('### `select(id: string): readonly string[]`')
	})
})
