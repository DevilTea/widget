import type { JsonSchema, SystemIr } from './index'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { inspectPlugin } from '@deviltea/widget-core/inspection'
import { beforeAll, describe, expect, it } from 'vitest'
import { onboardingPresets } from '../../lab/src/showcases/onboarding/presets'
import { onboardingSystem } from '../../lab/src/showcases/onboarding/system'
import { undocumentedSystem } from './fixtures/undocumented-system'
import { applyRuntimeFacts, checkIr, collectRuntimeFacts, createFlatConverter, emitFullSchema, emitLlmSchema, extractIr, FlatConversionError, generateFiles, validateSchema } from './index'

const here = dirname(fileURLToPath(import.meta.url))
const root = resolve(here, '../../..')
const sourceTsconfigPath = resolve(here, '../tsconfig.source.json')

// Building a TypeScript program over the Lab is slow; every test shares the two extractions.
let ir: SystemIr
let fixtureIr: SystemIr

beforeAll(() => {
	ir = extractIr({
		modulePath: resolve(root, 'apps/lab/src/showcases/onboarding/system.ts'),
		exportName: 'onboardingSystem',
		tsconfigPath: resolve(root, 'apps/lab/tsconfig.app.json'),
		sourceTsconfigPath,
		runtime: collectRuntimeFacts(onboardingSystem, inspectPlugin as never),
		cwd: root,
	})
	fixtureIr = extractIr({
		modulePath: resolve(here, 'fixtures/undocumented-system.ts'),
		exportName: 'undocumentedSystem',
		tsconfigPath: resolve(here, '../tsconfig.json'),
		sourceTsconfigPath,
		runtime: collectRuntimeFacts(undocumentedSystem, inspectPlugin as never),
		cwd: root,
	})
}, 180_000)

describe('extractIr on the onboarding System', () => {
	it('lists the plugin types in registration order and agrees with the runtime', () => {
		expect(ir.plugins.map(plugin => plugin.type))
			.toEqual(['Onboarding', 'AccountStep', 'InterestsStep', 'SafetyStep', 'InductionStep'])
		expect(ir.plugins.map(plugin => plugin.type))
			.toEqual(onboardingSystem.catalog.widgets.map(widget => widget.type))
		expect(ir.mismatches)
			.toEqual([])
	})

	it('reads the root plugin\'s members, signatures and labeled payloads', () => {
		const onboarding = ir.plugins[0]!
		expect(onboarding.interfacesName)
			.toBe('OnboardingInterfaces')
		expect(onboarding.slotForm)
			.toBe('union')
		expect(onboarding.slots.map(slot => slot.name))
			.toEqual(['steps'])
		expect(onboarding.slots[0]!.expected)
			.toBeNull()
		expect(onboarding.slots[0]!.runtimeDescription)
			.toContain('The steps in order')
		expect(onboarding.state.map(member => [member.name, member.typeText, member.authorWritable]))
			.toEqual([['current', 'number', false], ['finished', 'boolean', false]])
		expect(onboarding.properties.map(member => member.name))
			.toEqual(['title', 'steps', 'progress', 'answers'])
		expect(onboarding.methods.map(method => method.signature))
			.toEqual([
				'canEnter(index: number): boolean',
				'next(): number',
				'back(): number',
				'goTo(index: number): number',
				'finish(): boolean',
			])
		expect(onboarding.events.map(event => [event.name, event.payload]))
			.toEqual([
				['stepChanged', [{ label: 'change', typeText: 'StepChange' }]],
				['completed', [{ label: 'completion', typeText: 'Completion' }]],
			])
		expect(onboarding.reasons)
			.toBeNull()
	})

	it('expands the raw config to named types with their declarations and JSDoc', () => {
		const onboarding = ir.plugins[0]!
		expect(onboarding.config)
			.toMatchObject({ rawText: 'OnboardingRawConfig', resolvedText: 'OnboardingConfig', rawShape: { kind: 'ref', name: 'OnboardingRawConfig' }, omittable: false })
		const raw = ir.types.OnboardingRawConfig!
		expect(raw.file)
			.toBe('apps/lab/src/showcases/onboarding/config.ts')
		expect(raw.text)
			.toContain('export interface OnboardingRawConfig')
		expect(raw.shape)
			.toMatchObject({
				kind: 'object',
				properties: [
					{ name: 'title', optional: false, shape: { kind: 'ref', name: 'I18nText' } },
					{ name: 'startStep', optional: true, shape: { kind: 'number' }, doc: { summary: 'The index of the step the wizard opens on (0 = the first).' } },
				],
			})
		expect(ir.types.I18nText!.shape)
			.toEqual({ kind: 'record', value: { kind: 'string' } })
		expect(ir.types.I18nText!.text.startsWith('/** Text per language'))
			.toBe(true)
	})

	it('records a name the types and the runtime disagree on', () => {
		const copy = structuredClone(ir)
		const facts = collectRuntimeFacts(onboardingSystem, inspectPlugin as never)
		facts.plugins[0]!.state = [{ name: 'current', authorWritable: false }, { name: 'extra', authorWritable: false }]
		copy.mismatches = []
		applyRuntimeFacts(copy, facts)
		expect(copy.mismatches)
			.toEqual([
				'Onboarding.state: declared in the types but not at runtime: finished.',
				'Onboarding.state: declared at runtime but not in the types: extra.',
			])
		expect(checkIr(copy).problems.filter(problem => problem.kind === 'name-mismatch'))
			.toHaveLength(2)
	})
})

describe('emitFullSchema', () => {
	it('validates every onboarding preset source', () => {
		const schema = emitFullSchema(ir)
		expect(schema.$schema)
			.toBe('https://json-schema.org/draft/2020-12/schema')
		for (const preset of onboardingPresets) {
			expect(validateSchema(schema, JSON.parse(preset.sourceText)), preset.id)
				.toEqual([])
		}
	})

	it('rejects a wrong structure', () => {
		const schema = emitFullSchema(ir)
		const source = JSON.parse(onboardingPresets[0]!.sourceText)
		expect(validateSchema(schema, { ...source, extra: 1 })).not.toEqual([])
		expect(validateSchema(schema, { ...source, config: { title: 'not per language' } })).not.toEqual([])
		expect(validateSchema(schema, { ...source, slots: { steps: [{ id: 'x', type: 'Nope' }] } })).not.toEqual([])
		expect(validateSchema(schema, { ...source, slots: { other: [] } })).not.toEqual([])
	})

	it('has one $defs entry per widget type', () => {
		const defs = emitFullSchema(ir).$defs as Record<string, JsonSchema>
		for (const plugin of ir.plugins) {
			expect(defs[`widget_${plugin.type}`])
				.toMatchObject({ type: 'object', additionalProperties: false, properties: { type: { const: plugin.type } } })
		}
	})

	it('writes constraint tags as keywords', () => {
		const defs = emitFullSchema(fixtureIr).$defs as Record<string, JsonSchema>
		expect(defs.widget_Counter)
			.toMatchObject({ required: ['id', 'type'] })
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

	it('validates the flat form of every preset, with dictionaries as entry lists', () => {
		const schema = emitLlmSchema(ir)
		const { treeToFlat } = createFlatConverter(ir)
		for (const preset of onboardingPresets) {
			const flat = treeToFlat(JSON.parse(preset.sourceText))
			expect(validateSchema(schema, flat), preset.id)
				.toEqual([])
		}
		const flat = treeToFlat(JSON.parse(onboardingPresets[0]!.sourceText))
		expect(flat.nodes[0])
			.toEqual({
				id: 'onboarding',
				type: 'Onboarding',
				config: { title: [{ key: 'en', value: 'Welcome to Tidepool Makers' }, { key: 'zh-TW', value: '歡迎加入潮池工坊' }] },
				slots: ['steps'],
			})
		expect(flat.nodes.slice(1)
			.map(node => [node.id, node.parent, node.slot]))
			.toEqual([
				['account', 'onboarding', 'steps'],
				['interests', 'onboarding', 'steps'],
				['safety', 'onboarding', 'steps'],
				['induction', 'onboarding', 'steps'],
			])
	})

	it('puts constraints into descriptions, not keywords', () => {
		const schema = emitLlmSchema(ir)
		const startStep = ((schema.$defs as Record<string, JsonSchema>).type_OnboardingRawConfig!.properties as Record<string, JsonSchema>).startStep!
		expect(startStep.description)
			.toContain('The index of the step the wizard opens on')
		expect(startStep.description)
			.toContain('Optional: leave the key out when unused.')
		expect(startStep.type)
			.toBe('number')
		expect((schema.$defs as Record<string, JsonSchema>).type_OnboardingRawConfig!.required)
			.toEqual(['title'])
		expect((schema.$defs as Record<string, JsonSchema>).node_Onboarding!.required)
			.toEqual(['id', 'type', 'config'])
	})
})

describe('flat and tree converters', () => {
	it('round-trips every onboarding preset to exactly the same source and the same compile result', () => {
		const { treeToFlat, flatToTree } = createFlatConverter(ir)
		for (const preset of onboardingPresets) {
			const original = JSON.parse(preset.sourceText)
			// The flat form is JSON: it must survive serialization on its way through a model.
			const roundTripped = flatToTree(JSON.parse(JSON.stringify(treeToFlat(original))))
			expect(roundTripped, preset.id)
				.toStrictEqual(JSON.parse(preset.sourceText))
			// Key order too: the nodes are written as id, type, config, slots, like the presets.
			expect(JSON.stringify(roundTripped), preset.id)
				.toBe(JSON.stringify(JSON.parse(preset.sourceText)))
			const expected = onboardingSystem.createBlueprint(original)
			const actual = onboardingSystem.createBlueprint(roundTripped)
			expect(actual.status, preset.id)
				.toBe(expected.status)
			expect(actual.diagnostics.map(diagnostic => diagnostic.code), preset.id)
				.toEqual(expected.diagnostics.map(diagnostic => diagnostic.code))
		}
		// The presets cover both outcomes, so the comparison above is not vacuous.
		expect(new Set(onboardingPresets.map(preset => onboardingSystem.createBlueprint(JSON.parse(preset.sourceText)).status)))
			.toEqual(new Set(['valid', 'invalid']))
	})

	it('is stable from the flat side', () => {
		const { treeToFlat, flatToTree } = createFlatConverter(ir)
		for (const preset of onboardingPresets) {
			const flat = treeToFlat(JSON.parse(preset.sourceText))
			expect(treeToFlat(flatToTree(flat)), preset.id)
				.toEqual(flat)
		}
	})

	it('keeps meta, empty slots, an explicit null config and unrecognized keys', () => {
		const { treeToFlat, flatToTree } = createFlatConverter(ir)
		const tree = {
			id: 'root',
			type: 'Onboarding',
			config: { title: { en: 'T' }, startStep: null, unknownKey: { a: 1 } },
			slots: {
				empty: [],
				steps: [
					{ id: 'a', type: 'AccountStep', config: null, meta: { note: [1, null] } },
					{ id: 'b', type: 'Unregistered', config: { title: { en: 'kept as written' } }, slots: {}, extra: true },
				],
			},
			meta: null,
		}
		const flat = treeToFlat(structuredClone(tree))
		expect(flat.nodes)
			.toEqual([
				{ id: 'root', type: 'Onboarding', config: { title: [{ key: 'en', value: 'T' }], startStep: null, unknownKey: { a: 1 } }, slots: ['empty', 'steps'], meta: null },
				{ id: 'a', type: 'AccountStep', parent: 'root', slot: 'steps', config: null, meta: { note: [1, null] } },
				{ id: 'b', type: 'Unregistered', parent: 'root', slot: 'steps', config: { title: { en: 'kept as written' } }, slots: [], extra: true },
			])
		expect(flatToTree(JSON.parse(JSON.stringify(flat))))
			.toStrictEqual(tree)
		expect(validateSchema(emitFullSchema(ir), { id: 'x', type: 'AccountStep', config: { title: { en: 'T' } }, meta: { any: ['json', 1, null] } }))
			.toEqual([])
	})

	it('refuses lists that are not one tree', () => {
		const { flatToTree } = createFlatConverter(ir)
		const node = (id: string, parent: string | null) => (parent === null ? { id, type: 'AccountStep' } : { id, type: 'AccountStep', parent, slot: 'steps' })
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
	it('fails on the undocumented fixture plugin, naming the member and the unknown tag', () => {
		const result = checkIr(fixtureIr)
		expect(result.ok)
			.toBe(false)
		expect(result.problems)
			.toEqual([
				{ kind: 'missing-doc', where: 'Counter.state.step', message: 'Counter.state.step has no JSDoc.' },
				{ kind: 'unknown-tag', where: 'Counter.state.limit', message: 'Counter.state.limit uses the unknown tag @madeUpTag.' },
			])
		expect(fixtureIr.plugins[0]!.state[0]!.doc)
			.toEqual({ summary: 'The current count.', remarks: '', tags: { minimum: '0' }, unknownTags: [] })
		expect(fixtureIr.plugins[0]!.doc.summary)
			.toBe('A counter.')
	})

	it('counts the onboarding members that still lack JSDoc', () => {
		const result = checkIr(ir)
		expect(result.ok)
			.toBe(false)
		expect(result.problems.every(problem => problem.kind === 'missing-doc'))
			.toBe(true)
		expect(result.members)
			.toBe(result.documented + result.problems.length)
	})
})

describe('generateFiles', () => {
	it('writes the IR, both schemas and three skills with frontmatter', () => {
		const files = generateFiles(ir)
		const skills = Object.keys(files)
			.filter(path => path.endsWith('/SKILL.md'))
		expect(skills)
			.toEqual([
				'skills/onboarding-system-source-json-authoring/SKILL.md',
				'skills/onboarding-system-renderer-implementation/SKILL.md',
				'skills/widget-plugin-authoring/SKILL.md',
			])
		for (const path of skills) {
			expect(files[path])
				.toMatch(/^---\nname: [a-z0-9-]+\ndescription: ".+"\n---\n/)
		}
		expect(JSON.parse(files['ir.json']!))
			.toEqual(ir)
		expect(files['skills/onboarding-system-renderer-implementation/references/onboarding.md'])
			.toContain('### `goTo(index: number): number`')
	})
})
