/**
 * Runtime conformance of the docs written in the builder (Discussion #12, "Descriptions live in the plugin
 * builder; JSON Schema is inferred from the types (0.4.0)", points 1-7, 9, 11 and 12): `.description()` starts the
 * builder, every docs value is checked when it is declared, and `plugin.docs` is plain, serializable data that
 * the catalog, inspection and Blueprints do not carry.
 *
 * Only public entries are imported.
 */

import type { TypeDocs, WidgetChild, WidgetPluginDocs, WidgetRef } from './index'
import { describe, expect, it } from 'vitest'
import { createWidgetPlugin, createWidgetSystem, defineTypeDocs, undocumented } from './index'
import { inspectBlueprint, inspectPlugin } from './inspection/index'

function capture(run: () => unknown): unknown {
	try {
		run()
	}
	catch (error) {
		return error
	}
	return undefined
}

/** A contract violation is an uncoded `TypeError` whose message names every listed identifier. */
function expectContractViolation(error: unknown, names: readonly string[]): void {
	expect(error)
		.toBeInstanceOf(TypeError)
	for (const name of names) {
		expect((error as TypeError).message)
			.toContain(name)
	}
}

// -------------------------------------------------------------------------------------------------
// Fixture
// -------------------------------------------------------------------------------------------------

type Condition
	= | { readonly op: 'all', readonly conditions: readonly Condition[] }
		| { readonly op: 'not', readonly condition: Condition }
		| { readonly op: 'answered', readonly question: WidgetRef<'Rating'> }

const conditionDocs: TypeDocs<Condition> = defineTypeDocs<Condition>('Condition', {
	description: 'A rule over the answers.',
	fields: {
		op: { description: 'The kind of node.' },
		conditions: { description: 'The members of an all.', items: { ref: () => conditionDocs } },
		condition: { description: 'The negated rule.', ref: () => conditionDocs },
		question: { description: 'The question tested.' },
	},
})

interface SurveyRaw {
	readonly title?: string
	readonly languages: readonly string[]
	readonly visibleWhen?: boolean | Condition
	readonly labels?: Readonly<Record<string, string>>
}

interface SurveyInterfaces {
	config: { raw: SurveyRaw | null, resolved: { title: string } }
	slots: { pages: WidgetChild }
	state: { answers: { readonly done: number } }
	properties: { visible: boolean }
	methods: { submit: (note: string) => { readonly id: string } }
	events: { submitted: [response: { readonly id: string }], reset: [] }
	reasons: { 'empty': void, 'too-long': { readonly max: number } }
}

const description = 'A survey: pages of questions answered in order.'

function surveyPlugin() {
	return createWidgetPlugin('survey')
		.description(description)
		.interfaces<SurveyInterfaces>()
		.config({
			description: 'How the survey is shown.',
			raw: {
				fields: {
					title: { description: 'The title above the first page.' },
					languages: { description: 'The languages offered, in order.' },
					visibleWhen: { description: 'When the survey is shown.', ref: conditionDocs },
					labels: { description: 'Labels by language.', values: { description: 'One label.' } },
				},
			},
			resolved: undocumented,
			validate: (input): input is SurveyRaw | null => input === null || typeof input === 'object',
			resolve: raw => ({ title: raw?.title ?? '' }),
		})
		.slots({ pages: { description: 'The pages, in order.' } })
		.state(state => state.answers({
			description: 'Progress so far.',
			fields: { done: { description: 'How many questions are answered.' } },
			validate: (input): input is { readonly done: number } => typeof input === 'object' && input !== null,
			default: () => ({ done: 0 }),
		}))
		.properties(properties => properties.visible({ description: undocumented, compute: () => true }))
		.methods(methods => methods.submit({
			description: 'Submits the answers.',
			params: [{ description: 'A note kept with the response.' }],
			returns: { description: 'The stored response.', fields: { id: { description: 'Its id.' } } },
			validateArgs: (args): args is [string] => typeof args[0] === 'string',
			execute: () => ({ id: 'r1' }),
		}))
		.events({
			submitted: { description: 'The survey was submitted.', payload: [{ description: 'The response.', fields: { id: { description: 'Its id.' } } }] },
			reset: undocumented,
		})
		.reasons({
			'empty': { description: 'Nothing was answered.' },
			'too-long': { description: 'An answer is too long.', details: { fields: { max: { description: 'The limit.' } } } },
		})
		.done()
}

const expectedDocs: WidgetPluginDocs = {
	description,
	config: {
		description: 'How the survey is shown.',
		raw: {
			fields: {
				title: { description: 'The title above the first page.' },
				languages: { description: 'The languages offered, in order.' },
				visibleWhen: { description: 'When the survey is shown.', ref: 'Condition' },
				labels: { description: 'Labels by language.', values: { description: 'One label.' } },
			},
		},
		resolved: null,
	},
	slots: { pages: { description: 'The pages, in order.' } },
	state: { answers: { description: 'Progress so far.', fields: { done: { description: 'How many questions are answered.' } } } },
	properties: { visible: { description: null } },
	methods: {
		submit: {
			description: 'Submits the answers.',
			params: [{ description: 'A note kept with the response.' }],
			returns: { description: 'The stored response.', fields: { id: { description: 'Its id.' } } },
		},
	},
	events: {
		submitted: { description: 'The survey was submitted.', payload: [{ description: 'The response.', fields: { id: { description: 'Its id.' } } }] },
		reset: { description: null },
	},
	reasons: {
		'empty': { description: 'Nothing was answered.' },
		'too-long': { description: 'An answer is too long.', details: { fields: { max: { description: 'The limit.' } } } },
	},
	types: {
		Condition: {
			description: 'A rule over the answers.',
			fields: {
				op: { description: 'The kind of node.' },
				conditions: { description: 'The members of an all.', items: { ref: 'Condition' } },
				condition: { description: 'The negated rule.', ref: 'Condition' },
				question: { description: 'The question tested.' },
			},
		},
	},
}

// -------------------------------------------------------------------------------------------------
// plugin.docs
// -------------------------------------------------------------------------------------------------

describe('plugin.docs', () => {
	it('holds every description and docs object, `undocumented` as null and `ref` as a name in `types`', () => {
		expect(surveyPlugin().docs)
			.toEqual(expectedDocs)
	})

	it('is plain data that structuredClone and JSON round-trip', () => {
		const docs = surveyPlugin().docs

		expect(structuredClone(docs))
			.toEqual(docs)
		expect(JSON.parse(JSON.stringify(docs)))
			.toEqual(docs)
		const visit = (value: unknown): void => {
			expect(typeof value === 'function' || typeof value === 'symbol' || typeof value === 'undefined')
				.toBe(false)
			if (typeof value === 'object' && value !== null) {
				Object.values(value)
					.forEach(visit)
			}
		}
		visit(docs)
	})

	it('is frozen at every level', () => {
		const docs = surveyPlugin().docs
		const visit = (value: unknown): void => {
			if (typeof value !== 'object' || value === null)
				return
			expect(Object.isFrozen(value))
				.toBe(true)
			Object.values(value)
				.forEach(visit)
		}
		visit(docs)
	})

	it('is null for each section the plugin does not declare, and for reasons when `.reasons()` was not called', () => {
		const plain = createWidgetPlugin('plain')
			.description('Nothing to it.')
			.interfaces<Record<never, never>>()
			.done()

		expect(plain.docs)
			.toEqual({ description: 'Nothing to it.', config: null, slots: null, state: null, properties: null, methods: null, events: null, reasons: null, types: {} })
	})

	it('keeps an explicitly empty section empty (`slots: never`, an empty events record)', () => {
		const plugin = createWidgetPlugin('empty')
			.description(undocumented)
			.interfaces<{ slots: never, events: Record<never, never> }>()
			.slots({})
			.events({})
			.done()

		expect(plugin.docs.slots)
			.toEqual({})
		expect(plugin.docs.events)
			.toEqual({})
	})

	it('keeps declaration order and JavaScript-special member names', () => {
		const plugin = createWidgetPlugin('special')
			.description(undocumented)
			.interfaces<{ events: { z: [], __proto__: [], constructor: [], a: [] } }>()
			.events({ z: { description: 'Z.' }, ['__proto__']: { description: 'P.' }, constructor: { description: 'C.' }, a: undocumented })
			.done()

		expect(Object.keys(plugin.docs.events!))
			.toEqual(['z', '__proto__', 'constructor', 'a'])
		expect(Object.getOwnPropertyDescriptor(plugin.docs.events, '__proto__')?.value)
			.toEqual({ description: 'P.' })
		expect(JSON.parse(JSON.stringify(plugin.docs.events)))
			.toEqual(JSON.parse('{"z":{"description":"Z."},"__proto__":{"description":"P."},"constructor":{"description":"C."},"a":{"description":null}}'))
	})

	it('captures docs by value when they are declared', () => {
		const fields = { title: { description: 'Before.' } }
		const plugin = createWidgetPlugin('captured')
			.description(undocumented)
			.interfaces<{ config: { raw: { title?: string }, resolved: { title: string } } }>()
			.config({
				description: 'Config.',
				raw: { fields },
				resolved: { fields },
				validate: (input): input is { title?: string } => typeof input === 'object',
				resolve: raw => ({ title: raw?.title ?? '' }),
			})
			.done()
		fields.title.description = 'After.'

		expect(plugin.docs.config?.raw)
			.toEqual({ fields: { title: { description: 'Before.' } } })
	})

	it('is not part of the catalog, plugin inspection or Blueprint data', () => {
		const plugin = surveyPlugin()
		const system = createWidgetSystem({ plugins: [plugin] })
		const blueprint = system.createBlueprint({ id: 's', type: 'survey', config: null, slots: { pages: [] } })
		const inspected = inspectBlueprint(blueprint)
			.getNode(inspectBlueprint(blueprint).rootNodeId)!.node
		// A Blueprint node refers to its plugin by identity (`node.plugin`); it copies none of the plugin's docs.
		const { plugin: rootPlugin, ...rootData } = blueprint.root as typeof blueprint.root & { readonly plugin?: unknown }
		const carried = JSON.stringify([system.catalog, inspectPlugin(plugin), [...inspectPlugin(plugin).state!], rootData])

		expect(rootPlugin)
			.toBe(plugin)
		expect(inspected)
			.toBe(blueprint.root)
		expect(carried).not.toContain(description)
		expect(carried).not.toContain('Progress so far.')
		expect(Object.keys(system.catalog.widgets[0]!))
			.not.toContain('docs')
		expect(Object.keys(inspectPlugin(plugin)))
			.not.toContain('docs')
	})
})

// -------------------------------------------------------------------------------------------------
// Builder order
// -------------------------------------------------------------------------------------------------

describe('`.description()` starts the builder', () => {
	it('throws a TypeError when `.interfaces()` comes first (untyped JavaScript)', () => {
		const start = createWidgetPlugin('js') as unknown as { interfaces: () => unknown }

		expectContractViolation(capture(() => start.interfaces()), ['js', 'interfaces', '.description()'])
	})

	it('rejects a description that is neither a string nor undocumented', () => {
		for (const value of [undefined, null, 1, {}, ['a']]) {
			expectContractViolation(capture(() => createWidgetPlugin('bad-description')
				.description(value as never)), ['bad-description', 'description'])
		}
	})

	it('does not need `.reasons()` when the interfaces declare no reasons, and records none', () => {
		const plugin = createWidgetPlugin('no-reasons')
			.description('d')
			.interfaces<{ state: { a: number } }>()
			.state(state => state.a({ description: 'A.', validate: (input): input is number => typeof input === 'number' }))
			.done()

		expect(plugin.docs.reasons)
			.toBeNull()
	})
})

// -------------------------------------------------------------------------------------------------
// Validation at build time
// -------------------------------------------------------------------------------------------------

describe('docs values are checked when declared', () => {
	interface AllInterfaces {
		config: { raw: { a?: string }, resolved: { a: string } }
		slots: { body: WidgetChild }
		state: { s: { x: number } }
		properties: { p: number }
		methods: { m: (value: number) => number }
		events: { e: [value: number] }
		reasons: { r: { max: number } }
	}
	type Phase = 'config' | 'slots' | 'state' | 'properties' | 'methods' | 'events' | 'reasons'

	/** Builds a plugin with one malformed docs value in `phase`, given as `docs` (merged into the definition). */
	function build(phase: Phase, docs: Readonly<Record<string, unknown>>) {
		const validate = (input: unknown): input is never => input !== undefined
		const builder = createWidgetPlugin('bad-docs')
			.description(undocumented)
			.interfaces<AllInterfaces>() as unknown as Record<Phase, (argument: unknown) => unknown>
		switch (phase) {
			case 'config':
				return builder.config({ description: undocumented, validate, resolve: () => ({ a: '' }), ...docs })
			case 'slots':
				return builder.slots({ body: { description: undocumented, ...docs } })
			case 'state':
				return builder.state((section: Record<string, (definition: unknown) => unknown>) => section.s!({ description: undocumented, validate, ...docs }))
			case 'properties':
				return builder.properties((section: Record<string, (definition: unknown) => unknown>) => section.p!({ description: undocumented, compute: () => 1, ...docs }))
			case 'methods':
				return builder.methods((section: Record<string, (definition: unknown) => unknown>) => section.m!({ description: undocumented, validateArgs: validate, execute: () => 1, ...docs }))
			case 'events':
				return builder.events({ e: { description: undocumented, ...docs } })
			case 'reasons':
				return builder.reasons({ r: { description: undocumented, ...docs } })
		}
	}

	const cases: ReadonlyArray<readonly [Phase, Readonly<Record<string, unknown>>, readonly string[]]> = [
		['config', { description: undefined }, ['config', 'description']],
		['config', { description: 7 }, ['config', 'description']],
		['config', { raw: 'prose' }, ['config', 'raw']],
		['config', { raw: { fields: { a: { describe: 'typo' } } } }, ['config', 'raw.fields.a', '"describe"']],
		['config', { raw: { fields: { a: {} } } }, ['config', 'raw.fields.a', 'description']],
		['config', { raw: { fields: [] } }, ['config', 'raw.fields']],
		['config', { resolved: { fields: { a: { description: 'A.', ref: 'Condition' } } } }, ['config', 'resolved.fields.a.ref', 'defineTypeDocs']],
		['config', { raw: { fields: { a: { description: 'A.', ref: conditionDocs, fields: {} } } } }, ['config', 'raw.fields.a', '"ref"']],
		['slots', { description: null }, ['slots', '"body"', 'description']],
		['state', { description: undefined }, ['state', '"s"', 'description']],
		['state', { fields: { x: { description: 1 } } }, ['state', '"s"', 'fields.x.description']],
		['state', { items: 'x' }, ['state', '"s"', 'items']],
		['properties', { description: false }, ['properties', '"p"', 'description']],
		['methods', { params: { 0: { description: 'x' } } }, ['methods', '"m"', 'params']],
		['methods', { params: [{}] }, ['methods', '"m"', 'params.0', 'description']],
		['methods', { returns: 'prose' }, ['methods', '"m"', 'returns']],
		['events', { payload: [{ description: 'v', extra: true }] }, ['events', '"e"', 'payload.0', '"extra"']],
		['events', { details: {} }, ['events', '"e"', '"details"']],
		['reasons', { details: { fields: { max: 'prose' } } }, ['reasons', '"r"', 'details.fields.max']],
		['reasons', { payload: [] }, ['reasons', '"r"', '"payload"']],
	]

	for (const [phase, docs, names] of cases) {
		it(`rejects ${JSON.stringify(docs)} in ${phase}`, () => {
			expectContractViolation(capture(() => build(phase, docs)), ['bad-docs', ...names])
		})
	}

	it('rejects a reasons declaration that is not an object of docs', () => {
		for (const value of [undefined, null, ['r'], 'r']) {
			expectContractViolation(capture(() => (createWidgetPlugin('reasons-arg')
				.description(undocumented)
				.interfaces<{ reasons: { r: void } }>() as unknown as { reasons: (value: unknown) => unknown })
				.reasons(value)), ['reasons-arg', 'reasons'])
		}
	})
})

// -------------------------------------------------------------------------------------------------
// Shared type docs
// -------------------------------------------------------------------------------------------------

describe('defineTypeDocs and ref', () => {
	interface Pair { readonly left: number, readonly right: number }

	it('rejects an empty name, a ref at the top and malformed docs', () => {
		expectContractViolation(capture(() => defineTypeDocs<Pair>('', { description: 'P.', fields: { left: undocumented, right: undocumented } })), ['defineTypeDocs', 'name'])
		expectContractViolation(capture(() => defineTypeDocs<Pair>('Pair', { description: 'P.', ref: conditionDocs } as never)), ['Pair', 'ref'])
		expectContractViolation(capture(() => defineTypeDocs<Pair>('Pair', { description: 'P.', fields: { left: { description: 1 } } } as never)), ['Pair', 'fields.left.description'])
	})

	it('resolves a thunk when the plugin is built, and rejects one that does not return type docs', () => {
		const plugin = (target: () => unknown) => createWidgetPlugin('thunk')
			.description(undocumented)
			.interfaces<{ state: { pair: Pair } }>()
			.state(state => state.pair({ description: 'A pair.', ref: target as () => TypeDocs<Pair>, validate: (input): input is Pair => input !== null }))
			.done()
		const pairDocs = defineTypeDocs<Pair>('Pair', { description: 'Two numbers.', fields: { left: { description: 'L.' }, right: { description: 'R.' } } })

		expect(plugin(() => pairDocs).docs.types)
			.toEqual({ Pair: { description: 'Two numbers.', fields: { left: { description: 'L.' }, right: { description: 'R.' } } } })
		expectContractViolation(capture(() => plugin(() => ({ description: 'not type docs' }))), ['thunk', 'state.pair.ref', 'defineTypeDocs'])
	})

	it('rejects two different type docs with one name in one plugin', () => {
		const first = defineTypeDocs<Pair>('Pair', { description: 'One.', fields: { left: undocumented, right: undocumented } })
		const second = defineTypeDocs<Pair>('Pair', { description: 'Two.', fields: { left: undocumented, right: undocumented } })

		expectContractViolation(capture(() => createWidgetPlugin('same-name')
			.description(undocumented)
			.interfaces<{ state: { a: Pair, b: Pair } }>()
			.state(state => state
				.a({ description: 'A.', ref: first, validate: (input): input is Pair => input !== null })
				.b({ description: 'B.', ref: second, validate: (input): input is Pair => input !== null }))
			.done()), ['same-name', 'state.b.ref', '"Pair"'])
	})

	it('lists one entry per name, also for a type referenced many times and from its own docs', () => {
		const docs = surveyPlugin().docs

		expect(Object.keys(docs.types))
			.toEqual(['Condition'])
	})
})
