/**
 * Conformance: reading a Property is not bounded by the engine stack (DevilTea/widget Discussion #12,
 * https://github.com/DevilTea/widget/discussions/12#discussioncomment-19593596).
 *
 * The first read of a Property whose dependencies are not evaluated yet used to nest one evaluation per link
 * of the dependency chain and end in the engine's stack overflow. Core now bounds that nesting internally and
 * completes the abandoned evaluations iteratively, deepest first: the result, the diagnostics and the set of
 * evaluated Properties are those of an evaluation that had enough stack. An abandoned run may repeat a
 * `compute`, but caches nothing, commits no diagnostics and publishes no inspection completion.
 */

import type { ExecutionResult, RuntimeWidgetDiagnostic } from '../index'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createWidgetPlugin, createWidgetSystem, WidgetSystemRuntimeDisposedError } from '../index'
import { inspectRuntime } from '../inspection'

/** Far beyond what V8 can nest (around a thousand cold links) and every engine Core targets. */
const LONG = 12_000

const isNumber = (input: unknown): input is number => typeof input === 'number'

function valueOf(result: ExecutionResult<unknown, unknown>): unknown {
	return result.ok ? result.value : { failed: result.failure.diagnostics.length }
}

function numberOf(result: ExecutionResult<unknown, unknown>): number {
	return result.ok && typeof result.value === 'number' ? result.value : 0
}

class LinkFailure extends Error {}

const reported: unknown[] = []
function onUncaughtException(error: unknown): void {
	reported.push(error)
}

beforeEach(() => {
	reported.length = 0
	process.on('uncaughtException', onUncaughtException)
})

afterEach(async () => {
	await new Promise<void>(resolve => setTimeout(resolve, 0))
	process.off('uncaughtException', onUncaughtException)
})

// ---------------------------------------------------------------------------------------------------------
// A chain across widgets: `total` of link i reads `total` of link i - 1 through `dep.widget(id)`.
// ---------------------------------------------------------------------------------------------------------

interface LinkConfig {
	readonly index: number
	readonly prev: string | null
	/** The compute wraps its dependency read in try/catch and returns a fallback. */
	readonly guarded?: boolean
	/** Reads the previous link only while `n` is odd. */
	readonly gated?: boolean
}

interface LinkInterfaces {
	config: { raw: LinkConfig, resolved: LinkConfig }
	state: { n: number }
	properties: { total: number }
}

const linkStats = { computeCalls: [] as number[], fallbacks: 0, onCompute: null as ((index: number) => void) | null }

const linkPlugin = createWidgetPlugin('link')
	.description('Test widget')
	.interfaces<LinkInterfaces>()
	.config({
		description: 'Link',
		validate: (input): input is LinkConfig => typeof input === 'object' && input !== null,
		resolve: raw => raw!,
	})
	.state(state => state.n({ validate: isNumber, default: () => 1 }))
	.properties(properties => properties.total({
		registerDeps: ({ dep, config }) => ({
			prev: dep.widget(config.prev ?? 'absent')
				.optional()
				.properties
				.get('total'),
			n: dep.self.state.get('n'),
		}),
		compute: ({ deps, config, addDiagnostic }) => {
			linkStats.computeCalls[config.index] = (linkStats.computeCalls[config.index] ?? 0) + 1
			linkStats.onCompute?.(config.index)
			const own = numberOf(deps.n())
			if (config.gated && own % 2 === 0)
				return own
			let prev: ExecutionResult<unknown, unknown>
			if (config.guarded) {
				try {
					prev = deps.prev()
				}
				catch {
					linkStats.fallbacks++
					addDiagnostic({ message: 'caught' })
					return -1
				}
			}
			else {
				prev = deps.prev()
			}
			if (own < 0)
				throw new LinkFailure(`link ${config.index} failed`)
			if (own === 0)
				addDiagnostic({ message: `link ${config.index} is zero` })
			return numberOf(prev) + own
		},
	}))
	.done()

const listPlugin = createWidgetPlugin('list')
	.description('Test widget')
	.interfaces<{ slots: 'items' }>()
	.slots({ items: { description: 'Items' } })
	.done()

const linkSystem = createWidgetSystem({ plugins: [linkPlugin, listPlugin] })

function createChain(length: number, configure: (index: number) => Partial<LinkConfig> = () => ({})) {
	linkStats.computeCalls = []
	linkStats.fallbacks = 0
	linkStats.onCompute = null
	const items = Array.from({ length }, (_, index) => ({
		id: `l${index}`,
		type: 'link',
		config: { index, prev: index === 0 ? null : `l${index - 1}`, ...configure(index) },
	}))
	const blueprint = linkSystem.createBlueprint({ id: 'list', type: 'list', slots: { items } })
	if (blueprint.status !== 'valid')
		throw new Error('expected a valid Blueprint')
	const runtime = blueprint.createRuntime()
	const link = (index: number) => {
		const widget = runtime.getWidget(`l${index}`)
		if (widget?.type !== 'link')
			throw new Error('expected a link widget')
		return widget
	}
	return { runtime, link }
}

function totalComputeCalls(): number {
	return linkStats.computeCalls.reduce((sum, calls) => sum + (calls ?? 0), 0)
}

function maxComputeCalls(): number {
	return linkStats.computeCalls.reduce((max, calls) => Math.max(max, calls ?? 0), 0)
}

describe('a cold read of the head of a long chain', () => {
	it('returns the value of a chain across widgets with a linear number of compute calls', () => {
		const { link } = createChain(LONG)

		expect(link(LONG - 1).properties.total.get())
			.toEqual({ ok: true, value: LONG })
		expect(maxComputeCalls())
			.toBeLessThanOrEqual(3)
		expect(totalComputeCalls())
			.toBeLessThanOrEqual(3 * LONG)
		// Every link is evaluated and cached: reading them back runs no compute.
		const calls = totalComputeCalls()
		for (let index = 0; index < LONG; index += 997) {
			expect(link(index).properties.total.get())
				.toEqual({ ok: true, value: index + 1 })
		}
		expect(totalComputeCalls())
			.toBe(calls)
	})

	it('recomputes the whole chain after a write at its tail without nesting', () => {
		const { link } = createChain(LONG)
		link(LONG - 1).properties.total.get()

		link(0).state.n.set(5)

		expect(link(LONG - 1).properties.total.get())
			.toEqual({ ok: true, value: LONG + 4 })
	})

	it('returns the value of a chain of many Properties in one widget', () => {
		const length = LONG
		let computeCalls = 0
		const widePlugin = createWidgetPlugin('wide')
			.description('Test widget')
			.interfaces<{ state: { seed: number }, properties: Record<`p${number}`, number> }>()
			.state(state => state.seed({ validate: isNumber, default: () => 1 }))
			// Ten thousand members cannot be spelled out: register them through the section's string keys.
			.properties(((section: unknown) => {
				const registrars = section as Record<string, (definition: unknown) => unknown>
				registrars.p0!({
					registerDeps: ({ dep }: { dep: any }) => ({ seed: dep.self.state.get('seed') }),
					compute: ({ deps }: { deps: { seed: () => ExecutionResult<number | null, unknown> } }) => {
						computeCalls++
						return numberOf(deps.seed())
					},
				})
				for (let index = 1; index < length; index++) {
					registrars[`p${index}`]!({
						registerDeps: ({ dep }: { dep: any }) => ({ prev: dep.self.properties.get(`p${index - 1}`) }),
						compute: ({ deps }: { deps: { prev: () => ExecutionResult<number, unknown> } }) => {
							computeCalls++
							return numberOf(deps.prev()) + 1
						},
					})
				}
				return section
			}) as never)
			.done()
		const blueprint = createWidgetSystem({ plugins: [widePlugin] })
			.createBlueprint({ id: 'wide', type: 'wide' })
		if (blueprint.status !== 'valid')
			throw new Error('expected a valid Blueprint')
		const widget = blueprint.createRuntime()
			.getWidget('wide')!
		const properties = widget.properties as unknown as Record<string, { get: () => ExecutionResult<number, unknown> }>

		expect(properties[`p${length - 1}`]!.get())
			.toEqual({ ok: true, value: length })
		expect(computeCalls)
			.toBeLessThanOrEqual(3 * length)

		widget.state.seed.set(10)

		expect(properties[`p${length - 1}`]!.get())
			.toEqual({ ok: true, value: length + 9 })
	})
})

// ---------------------------------------------------------------------------------------------------------
// The survey shape: `visible` reads the previous question's `value`; `value` reads its own State and `visible`.
// ---------------------------------------------------------------------------------------------------------

interface QuestionConfig {
	readonly prev: string | null
}

interface QuestionInterfaces {
	config: { raw: QuestionConfig, resolved: QuestionConfig }
	state: { answer: number | null }
	properties: { visible: boolean, value: number | null }
}

const questionPlugin = createWidgetPlugin('question')
	.description('Test widget')
	.interfaces<QuestionInterfaces>()
	.config({
		description: 'Question',
		validate: (input): input is QuestionConfig => typeof input === 'object' && input !== null,
		resolve: raw => raw!,
	})
	.state(state => state.answer({ validate: (input): input is number | null => input === null || typeof input === 'number', default: () => 1 }))
	.properties(properties => properties
		.visible({
			registerDeps: ({ dep, config }) => ({
				prev: dep.widget(config.prev ?? 'absent')
					.optional()
					.properties
					.get('value'),
			}),
			compute: ({ deps, config }) => {
				const prev = deps.prev()
				return config.prev === null || (prev.ok && prev.value !== null)
			},
		})
		.value({
			registerDeps: ({ dep }) => ({ answer: dep.self.state.get('answer'), visible: dep.self.properties.get('visible') }),
			compute: ({ deps }) => {
				const visible = deps.visible()
				const answer = deps.answer()
				return visible.ok && visible.value && answer.ok ? answer.value : null
			},
		}))
	.done()

const surveySystem = createWidgetSystem({ plugins: [questionPlugin, listPlugin] })

describe('the survey shape', () => {
	it('reads the last question of a long survey cold and follows writes', () => {
		const length = LONG / 2
		const items = Array.from({ length }, (_, index) => ({ id: `q${index}`, type: 'question', config: { prev: index === 0 ? null : `q${index - 1}` } }))
		const blueprint = surveySystem.createBlueprint({ id: 'survey', type: 'list', slots: { items } })
		if (blueprint.status !== 'valid')
			throw new Error('expected a valid Blueprint')
		const runtime = blueprint.createRuntime()
		const question = (index: number) => {
			const widget = runtime.getWidget(`q${index}`)
			if (widget?.type !== 'question')
				throw new Error('expected a question widget')
			return widget
		}
		const last = question(length - 1)

		expect(last.properties.value.get())
			.toEqual({ ok: true, value: 1 })
		expect(last.properties.visible.get())
			.toEqual({ ok: true, value: true })

		question(10).state.answer.set(null)

		expect(last.properties.visible.get())
			.toEqual({ ok: true, value: false })
		expect(question(11).properties.visible.get())
			.toEqual({ ok: true, value: false })
		expect(question(10).properties.visible.get())
			.toEqual({ ok: true, value: true })

		question(10).state.answer.set(7)
		last.state.answer.set(3)

		expect(last.properties.value.get())
			.toEqual({ ok: true, value: 3 })
	})
})

// ---------------------------------------------------------------------------------------------------------
// Subscriptions.
// ---------------------------------------------------------------------------------------------------------

describe('a cold subscription to the head of a long chain', () => {
	it('delivers the values of later writes', () => {
		const { link } = createChain(LONG)
		const seen: unknown[] = []
		link(LONG - 1).properties.total.subscribe(result => seen.push(valueOf(result)))

		link(0).state.n.set(2)
		link(LONG - 1).state.n.set(3)

		expect(seen)
			.toEqual([LONG + 1, LONG + 3])
		expect(reported)
			.toEqual([])
	})

	it('reads the chain cold again after the last subscriber unsubscribed', async () => {
		// Short enough that alien-signals' own recursive teardown of a watched chain (out of scope) does not
		// overflow, long enough to exceed the internal nesting limit many times.
		const length = 1_000
		const { link } = createChain(length)
		const seen: unknown[] = []
		const unsubscribe = link(length - 1).properties.total.subscribe(result => seen.push(valueOf(result)))
		link(0).state.n.set(2)

		expect(seen)
			.toEqual([length + 1])

		unsubscribe()
		link(0).state.n.set(4)

		expect(link(length - 1).properties.total.get())
			.toEqual({ ok: true, value: length + 3 })

		const again: unknown[] = []
		link(length - 1).properties.total.subscribe(result => again.push(valueOf(result)))
		link(0).state.n.set(1)

		expect(again)
			.toEqual([length])
		await Promise.resolve()
		expect(reported)
			.toEqual([])
	})

	it('reads cold again a chain far longer than the engine could nest once its last subscriber unsubscribed', () => {
		// Unsubscribing makes alien-signals tear the whole chain down (its links are dropped): every link has
		// completed before but has no dependency left, and must be read again as boundedly as a first read.
		const length = 2_500
		const { link } = createChain(length)
		const unsubscribe = link(length - 1).properties.total.subscribe(() => {})
		unsubscribe()
		link(0).state.n.set(3)

		expect(link(length - 1).properties.total.get())
			.toEqual({ ok: true, value: length + 2 })
	})

	it('delivers a value that newly reads a cold, deep branch on the effect\'s own re-evaluation', () => {
		// The head reads the rest of the chain only while its own `n` is odd: the first write below makes the
		// subscription's dirty check (alien-signals' update path, without Core's read) reach the cold chain.
		const { link } = createChain(LONG, index => (index === LONG - 1 ? { gated: true } : {}))
		const head = link(LONG - 1)
		head.state.n.set(2)
		const seen: unknown[] = []
		head.properties.total.subscribe(result => seen.push(valueOf(result)))

		expect(head.properties.total.get())
			.toEqual({ ok: true, value: 2 })
		linkStats.computeCalls = []

		head.state.n.set(3)

		expect(seen)
			.toEqual([LONG - 1 + 3])
		expect(head.properties.total.get())
			.toEqual({ ok: true, value: LONG - 1 + 3 })
		expect(maxComputeCalls())
			.toBeLessThanOrEqual(3)

		link(0).state.n.set(2)

		expect(seen)
			.toEqual([LONG + 2, LONG + 3])
	})

	it('reads a cold, deep branch reached by a re-evaluation driven by a direct read', () => {
		const { link } = createChain(LONG, index => (index === LONG - 1 ? { gated: true } : {}))
		const head = link(LONG - 1)
		head.state.n.set(2)

		expect(head.properties.total.get())
			.toEqual({ ok: true, value: 2 })

		head.state.n.set(1)

		expect(head.properties.total.get())
			.toEqual({ ok: true, value: LONG })
	})

	it('delivers a long chain read from inside a State listener during a write\'s flush', () => {
		const { link } = createChain(LONG)
		const seen: unknown[] = []
		link(0).state.n.subscribe(() => seen.push(valueOf(link(LONG - 1).properties.total.get())))

		link(0).state.n.set(2)

		expect(seen)
			.toEqual([LONG + 1])
	})
})

// ---------------------------------------------------------------------------------------------------------
// Methods.
// ---------------------------------------------------------------------------------------------------------

interface ReaderConfig {
	readonly head: string
}

interface ReaderInterfaces {
	config: { raw: ReaderConfig, resolved: ReaderConfig }
	properties: { viaMethod: number }
	methods: { readHead: () => number }
}

const readerPlugin = createWidgetPlugin('reader')
	.description('Test widget')
	.interfaces<ReaderInterfaces>()
	.config({
		description: 'Reader',
		validate: (input): input is ReaderConfig => typeof input === 'object' && input !== null,
		resolve: raw => raw!,
	})
	.properties(properties => properties.viaMethod({
		registerDeps: ({ dep }) => ({ readHead: dep.self.methods.invoke('readHead') }),
		compute: ({ deps }) => numberOf(deps.readHead()) * 2,
	}))
	.methods(methods => methods.readHead({
		registerDeps: ({ dep, config }) => ({
			head: dep.widget(config.head)
				.optional()
				.properties
				.get('total'),
		}),
		validateArgs: (args): args is [] => args.length === 0,
		execute: ({ deps }) => numberOf(deps.head()),
	}))
	.done()

const readerSystem = createWidgetSystem({ plugins: [linkPlugin, listPlugin, readerPlugin] })

function createReaderRuntime(length: number) {
	linkStats.computeCalls = []
	const items: unknown[] = Array.from({ length }, (_, index) => ({
		id: `l${index}`,
		type: 'link',
		config: { index, prev: index === 0 ? null : `l${index - 1}` },
	}))
	items.push({ id: 'reader', type: 'reader', config: { head: `l${length - 1}` } })
	const blueprint = readerSystem.createBlueprint({ id: 'list', type: 'list', slots: { items } })
	if (blueprint.status !== 'valid')
		throw new Error('expected a valid Blueprint')
	const runtime = blueprint.createRuntime()
	const reader = runtime.getWidget('reader')
	const tail = runtime.getWidget('l0')
	if (reader?.type !== 'reader' || tail?.type !== 'link')
		throw new Error('expected the reader and link widgets')
	return { runtime, reader, tail }
}

describe('a Method reading a long cold chain', () => {
	it('returns the head\'s value when the host invokes it', () => {
		const { reader } = createReaderRuntime(LONG)

		expect(reader.methods.readHead())
			.toEqual({ ok: true, value: LONG })
		expect(reader.methods.readHead.getDiagnostics())
			.toEqual([])
	})

	it('serves a Property that depends on it, and the Property follows writes to the chain', () => {
		const { reader, tail } = createReaderRuntime(LONG)
		const seen: unknown[] = []
		reader.properties.viaMethod.subscribe(result => seen.push(valueOf(result)))

		expect(reader.properties.viaMethod.get())
			.toEqual({ ok: true, value: 2 * LONG })

		tail.state.n.set(3)

		expect(seen)
			.toEqual([2 * (LONG + 2)])
		expect(reader.properties.viaMethod.get())
			.toEqual({ ok: true, value: 2 * (LONG + 2) })
	})
})

// ---------------------------------------------------------------------------------------------------------
// A compute that catches the abandonment.
// ---------------------------------------------------------------------------------------------------------

describe('a compute that catches its dependency read and returns a fallback', () => {
	it('ends with the true value, and the fallback runs leave no diagnostics behind', () => {
		const { link } = createChain(LONG, () => ({ guarded: true }))
		const head = link(LONG - 1)

		expect(head.properties.total.get())
			.toEqual({ ok: true, value: LONG })
		// The fallback path ran (the abandonment travelled through those computes)...
		expect(linkStats.fallbacks)
			.toBeGreaterThan(0)
		// ...yet no Property kept its result or its diagnostic.
		for (let index = 0; index < LONG; index += 499) {
			expect(link(index).properties.total.get())
				.toEqual({ ok: true, value: index + 1 })
			expect(link(index).properties.total.getDiagnostics())
				.toEqual([])
		}
	})
})

// ---------------------------------------------------------------------------------------------------------
// Diagnostics and inspection.
// ---------------------------------------------------------------------------------------------------------

/** Long enough to exceed the internal nesting limit many times, short enough for wrapped-diagnostic chains. */
const DIAGNOSTIC_CHAIN = 200

/** Looks up a Property's inspection facade by widget id. */
function propertyInspector(runtime: Parameters<typeof inspectRuntime>[0]) {
	const inspection = inspectRuntime(runtime)
	const nodeIds = new Map<string, (typeof inspection.blueprint.nodes)[number]['nodeId']>()
	for (const entry of inspection.blueprint.nodes) {
		if (entry.resolved)
			nodeIds.set(entry.node.id, entry.nodeId)
	}
	return (widgetId: string, name: string) => inspection.getWidget(nodeIds.get(widgetId)!)!.getProperty(name)!
}

/** Reads every link from the tail up, so no read is ever deep: the reference evaluation. */
function readBottomUp(link: (index: number) => { properties: { total: { get: () => unknown } } }, length: number): void {
	for (let index = 0; index < length; index++)
		link(index).properties.total.get()
}

describe('diagnostics of a long chain read cold', () => {
	it('end exactly as those of an evaluation that never ran deep', () => {
		const zeroAt = 37
		const deep = createChain(DIAGNOSTIC_CHAIN)
		const shallow = createChain(DIAGNOSTIC_CHAIN)
		deep.link(zeroAt).state.n.set(0)
		shallow.link(zeroAt).state.n.set(0)

		const notified: (readonly RuntimeWidgetDiagnostic[])[] = []
		deep.link(zeroAt).properties.total.subscribeDiagnostics(diagnostics => notified.push(diagnostics))
		const headNotified: unknown[] = []
		deep.link(DIAGNOSTIC_CHAIN - 1).properties.total.subscribeDiagnostics(diagnostics => headNotified.push(diagnostics))
		const runtimeNotified: unknown[] = []
		deep.runtime.subscribeDiagnostics(diagnostics => runtimeNotified.push(diagnostics))

		const deepHead = deep.link(DIAGNOSTIC_CHAIN - 1).properties.total.get()
		readBottomUp(shallow.link, DIAGNOSTIC_CHAIN)

		expect(deepHead)
			.toEqual(shallow.link(DIAGNOSTIC_CHAIN - 1).properties.total.get())
		expect(deepHead.ok)
			.toBe(false)
		for (let index = 0; index < DIAGNOSTIC_CHAIN; index++) {
			expect(deep.link(index).properties.total.getDiagnostics())
				.toEqual(shallow.link(index).properties.total.getDiagnostics())
		}
		expect(deep.runtime.getDiagnostics())
			.toEqual(shallow.runtime.getDiagnostics())
		// One commit each: abandoned runs commit nothing a listener could see.
		expect(notified)
			.toEqual([deep.link(zeroAt).properties.total.getDiagnostics()])
		expect(headNotified)
			.toEqual([deep.link(DIAGNOSTIC_CHAIN - 1).properties.total.getDiagnostics()])
		expect(runtimeNotified)
			.toEqual([deep.runtime.getDiagnostics()])
	})

	it('of a compute that adds a diagnostic only on its fallback path stay empty', () => {
		const { link } = createChain(DIAGNOSTIC_CHAIN, () => ({ guarded: true }))
		const notified: unknown[] = []
		for (let index = 0; index < DIAGNOSTIC_CHAIN; index++)
			link(index).properties.total.subscribeDiagnostics(diagnostics => notified.push(diagnostics))

		expect(link(DIAGNOSTIC_CHAIN - 1).properties.total.get())
			.toEqual({ ok: true, value: DIAGNOSTIC_CHAIN })
		expect(linkStats.fallbacks)
			.toBeGreaterThan(0)
		expect(notified)
			.toEqual([])
	})
})

describe('inspection of a long chain read cold', () => {
	it('publishes one completion per Property, with its final result', () => {
		const { runtime, link } = createChain(DIAGNOSTIC_CHAIN)
		const inspect = propertyInspector(runtime)
		const published: unknown[][] = []
		const facades = Array.from({ length: DIAGNOSTIC_CHAIN }, (_, index) => {
			const facade = inspect(`l${index}`, 'total')
			published[index] = []
			facade.subscribe(snapshot => published[index]!.push(snapshot))
			return facade
		})

		link(DIAGNOSTIC_CHAIN - 1).properties.total.get()

		for (let index = 0; index < DIAGNOSTIC_CHAIN; index++) {
			const result = link(index).properties.total.get()
			expect(result)
				.toEqual({ ok: true, value: index + 1 })
			expect(facades[index]!.getSnapshot())
				.toEqual({ status: 'completed', result })
			expect(published[index])
				.toEqual([{ status: 'completed', result }])
		}
	})

	// That a Property only an abandoned run reached stays never-evaluated is pinned in
	// deep-dependency-observers.unit.test.ts.
	it('ends with every link completed when every compute catches its dependency read', () => {
		const { runtime, link } = createChain(DIAGNOSTIC_CHAIN, () => ({ guarded: true }))
		const inspect = propertyInspector(runtime)
		const head = link(DIAGNOSTIC_CHAIN - 1)

		head.properties.total.get()

		for (let index = 0; index < DIAGNOSTIC_CHAIN; index++) {
			expect(inspect(`l${index}`, 'total')
				.getSnapshot())
				.toEqual({ status: 'completed', result: { ok: true, value: index + 1 } })
		}
	})
})

// ---------------------------------------------------------------------------------------------------------
// Fan-in.
// ---------------------------------------------------------------------------------------------------------

interface SumConfig {
	readonly heads: readonly string[]
}

interface SumInterfaces {
	config: { raw: SumConfig, resolved: SumConfig }
	properties: { sum: number }
}

const sumStats = { computeCalls: 0 }

const sumPlugin = createWidgetPlugin('sum')
	.description('Test widget')
	.interfaces<SumInterfaces>()
	.config({
		description: 'Sum',
		validate: (input): input is SumConfig => typeof input === 'object' && input !== null,
		resolve: raw => raw!,
	})
	.properties(properties => properties.sum({
		registerDeps: ({ dep, config }) => ({
			heads: config.heads.map(id => dep.widget(id)
				.optional()
				.properties
				.get('total')),
		}),
		compute: ({ deps }) => {
			sumStats.computeCalls++
			return deps.heads.reduce((sum, read) => sum + numberOf(read()), 0)
		},
	}))
	.done()

describe('a Property aggregating several long chains', () => {
	it('returns their sum within the documented cost bound', () => {
		const chains = 4
		const length = 3_000
		const items: unknown[] = []
		for (let chain = 0; chain < chains; chain++) {
			for (let index = 0; index < length; index++) {
				items.push({
					id: `c${chain}l${index}`,
					type: 'link',
					config: { index: chain * length + index, prev: index === 0 ? null : `c${chain}l${index - 1}` },
				})
			}
		}
		items.push({ id: 'sum', type: 'sum', config: { heads: Array.from({ length: chains }, (_, chain) => `c${chain}l${length - 1}`) } })
		linkStats.computeCalls = []
		sumStats.computeCalls = 0
		const blueprint = createWidgetSystem({ plugins: [linkPlugin, listPlugin, sumPlugin] })
			.createBlueprint({ id: 'list', type: 'list', slots: { items } })
		if (blueprint.status !== 'valid')
			throw new Error('expected a valid Blueprint')
		const sum = blueprint.createRuntime()
			.getWidget('sum')
		if (sum?.type !== 'sum')
			throw new Error('expected the sum widget')

		expect(sum.properties.sum.get())
			.toEqual({ ok: true, value: chains * length })
		expect(sumStats.computeCalls)
			.toBeLessThanOrEqual(chains + 1)
		expect(maxComputeCalls())
			.toBeLessThanOrEqual(3)
	})
})

// ---------------------------------------------------------------------------------------------------------
// User exceptions, disposal, two Runtimes and a host that is already deep.
// ---------------------------------------------------------------------------------------------------------

describe('a compute exception deep in a long chain', () => {
	function readHead(length: number, failAt: number) {
		const { link } = createChain(length)
		link(failAt).state.n.set(-1)
		let thrown: unknown
		try {
			link(length - 1).properties.total.get()
		}
		catch (error) {
			thrown = error
		}
		return { link, thrown }
	}

	it('is rethrown by the head\'s get() exactly as for a short chain, cached, and recovers after a write', () => {
		const short = readHead(10, 3)
		const long = readHead(LONG, 3)

		expect(short.thrown)
			.toBeInstanceOf(LinkFailure)
		expect(long.thrown)
			.toBeInstanceOf(LinkFailure)
		expect((long.thrown as Error).message)
			.toBe((short.thrown as Error).message)
		// The very object the failing compute threw, rethrown by every dependent and the failing link itself.
		expect(() => long.link(LONG - 1).properties.total.get())
			.toThrow(long.thrown as Error)
		expect(() => long.link(3).properties.total.get())
			.toThrow(long.thrown as Error)
		expect(() => long.link(4).properties.total.get())
			.toThrow(long.thrown as Error)
		expect(long.link(2).properties.total.get())
			.toEqual({ ok: true, value: 3 })
		// Cached: reading again runs no compute.
		const calls = totalComputeCalls()
		expect(() => long.link(LONG - 1).properties.total.get())
			.toThrow(LinkFailure)
		expect(totalComputeCalls())
			.toBe(calls)

		long.link(3).state.n.set(1)

		expect(long.link(LONG - 1).properties.total.get())
			.toEqual({ ok: true, value: LONG })
	})
})

describe('disposal while a long chain is being completed', () => {
	// Inspection listeners are notified once the read has finished (issue #198), so an inspection listener can no
	// longer dispose the Runtime in the middle of the read: the read completes and every later read throws.
	it('by an inspection listener: the read completes first, every later read throws the post-dispose error', () => {
		const { runtime, link } = createChain(LONG)
		const deep = propertyInspector(runtime)('l100', 'total')
		deep.subscribe(() => runtime.dispose())

		expect(link(LONG - 1).properties.total.get())
			.toEqual({ ok: true, value: LONG })
		expect(runtime.isDisposed)
			.toBe(true)
		expect(() => link(LONG - 1).properties.total.get())
			.toThrow(WidgetSystemRuntimeDisposedError)
	})

	it('by a compute ends the read with the post-dispose error, as it does for a short chain', () => {
		for (const length of [10, LONG]) {
			const { runtime, link } = createChain(length)
			linkStats.onCompute = (index) => {
				if (index === 5)
					runtime.dispose()
			}

			expect(() => link(length - 1).properties.total.get())
				.toThrow(WidgetSystemRuntimeDisposedError)
			expect(() => link(length - 1).properties.total.get())
				.toThrow(WidgetSystemRuntimeDisposedError)
		}
	})
})

describe('two Runtimes in one realm', () => {
	it('complete a long chain of one Runtime read from inside a compute of another', () => {
		const other = createChain(LONG)
		const otherHead = other.link(LONG - 1)
		const bridgePlugin = createWidgetPlugin('bridge')
			.description('Test widget')
			.interfaces<{ properties: { foreign: number } }>()
			.properties(properties => properties.foreign({
				registerDeps: () => ({}),
				compute: () => numberOf(otherHead.properties.total.get()),
			}))
			.done()
		const blueprint = createWidgetSystem({ plugins: [bridgePlugin] })
			.createBlueprint({ id: 'bridge', type: 'bridge' })
		if (blueprint.status !== 'valid')
			throw new Error('expected a valid Blueprint')
		const bridge = blueprint.createRuntime()
			.getWidget('bridge')!
		const seen: unknown[] = []
		bridge.properties.foreign.subscribe(result => seen.push(valueOf(result)))

		expect(bridge.properties.foreign.get())
			.toEqual({ ok: true, value: LONG })

		other.link(0).state.n.set(2)

		expect(seen)
			.toEqual([LONG + 1])
	})
})

describe('a host that calls from an already deep stack', () => {
	it('gets the engine\'s stack overflow or the value, never a hang, and a shallow read succeeds afterwards', () => {
		const { link } = createChain(LONG)
		const head = link(LONG - 1)
		const outcomes = new Set<string>()
		const atDepth = (depth: number): string => {
			if (depth > 0)
				return atDepth(depth - 1)
			try {
				return head.properties.total.get().ok ? 'value' : 'failed'
			}
			catch (error) {
				return error instanceof RangeError ? 'overflow' : `other: ${String(error)}`
			}
		}
		let maxDepth = 0
		try {
			const probe = (depth: number): number => {
				maxDepth = depth
				return probe(depth + 1) + 1
			}
			probe(0)
		}
		catch {}
		for (let depth = maxDepth - 1; depth > 0; depth = Math.floor(depth * 0.9)) {
			try {
				outcomes.add(atDepth(depth))
			}
			catch (error) {
				// The overflow escaped before `get()` was reached.
				outcomes.add(error instanceof RangeError ? 'overflow' : `other: ${String(error)}`)
			}
		}

		expect([...outcomes].filter(outcome => outcome !== 'value' && outcome !== 'overflow'))
			.toEqual([])
		expect(outcomes.has('overflow'))
			.toBe(true)
		expect(head.properties.total.get())
			.toEqual({ ok: true, value: LONG })
	})
})
