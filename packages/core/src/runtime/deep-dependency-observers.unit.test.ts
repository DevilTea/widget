/**
 * Conformance: completing a deep read iteratively is invisible to observers (DevilTea/widget Discussion #12,
 * https://github.com/DevilTea/widget/discussions/12#discussioncomment-19593596).
 *
 * After a read whose evaluations were abandoned and completed again, nothing is left stale: reading any
 * Property afterwards, with no State write, runs no `compute`, notifies no Property, diagnostics or widget
 * subscriber, and publishes no further inspection completion; each Property publishes one completion per
 * result. A `compute` that reads, by closure, a Property while such a read is in progress (not a supported
 * pattern, but Core recovers from it) gets its value once, without re-entering the read in progress.
 */

import type { ExecutionResult } from '../index'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createWidgetPlugin, createWidgetSystem, WidgetSystemRuntimeDisposedError } from '../index'
import { inspectRuntime } from '../inspection'

interface NodeConfig {
	readonly index: number
	readonly prev: string | null
	/** Inputs read after `prev`. */
	readonly extra?: readonly string[]
	/** Reads `prev` inside try/catch, counting what it throws as 0, and goes on. */
	readonly catchPrev?: boolean
	/** With `catchPrev`: when reading `prev` throws, also reads this widget's `out`. */
	readonly onCatch?: string
	/** Catches what reading its own State throws too, counting it as 0. */
	readonly catchState?: boolean
	/** Reads `prev` only while its own State is odd. */
	readonly gate?: boolean
	/** Like `gate`, but still reads everything else while closed. */
	readonly gatePrev?: boolean
	/** Also reads this widget's `out` through its Method `peek`. */
	readonly viaMethod?: string
	/** Also reads this widget's `out` with the public `get()`. */
	readonly publicGet?: string
	/** Reads `viaMethod` before `prev` rather than after. */
	readonly methodFirst?: boolean
}

interface NodeInterfaces {
	config: { raw: NodeConfig, resolved: NodeConfig }
	state: { n: number }
	properties: { out: number }
	methods: { peek: () => number }
}

const isNumber = (input: unknown): input is number => typeof input === 'number'

function numberOf(result: ExecutionResult<unknown, unknown>): number {
	return result.ok && typeof result.value === 'number' ? result.value : 0
}

const env = {
	computeCalls: [] as number[],
	runtime: null as null | { getWidget: (id: string) => unknown },
	onCompute: null as null | ((index: number) => void),
	/** Called by `compute` right after it has read `prev` (not when that read threw). */
	afterPrev: null as null | ((index: number) => void),
}

const nodePlugin = createWidgetPlugin('node')
	.description('Test widget')
	.interfaces<NodeInterfaces>()
	.config({
		description: 'Node',
		validate: (input): input is NodeConfig => typeof input === 'object' && input !== null,
		resolve: raw => raw!,
	})
	.state(state => state.n({ validate: isNumber, default: () => 1 }))
	.properties(properties => properties.out({
		registerDeps: ({ dep, config }) => ({
			n: dep.self.state.get('n'),
			prev: dep.widget(config.prev ?? 'absent')
				.optional()
				.properties
				.get('out'),
			onCatch: dep.widget(config.onCatch ?? 'absent')
				.optional()
				.properties
				.get('out'),
			extra: (config.extra ?? []).map(id => dep.widget(id)
				.optional()
				.properties
				.get('out')),
			peek: dep.widget(config.viaMethod ?? 'absent')
				.optional()
				.methods
				.invoke('peek'),
		}),
		compute: ({ deps, config, addDiagnostic }) => {
			env.computeCalls[config.index] = (env.computeCalls[config.index] ?? 0) + 1
			env.onCompute?.(config.index)
			let own = 0
			try {
				own = numberOf(deps.n())
			}
			catch (error) {
				if (!config.catchState)
					throw error
			}
			if (config.gate && own % 2 === 0)
				return own
			let sum = own
			if (config.viaMethod !== undefined && config.methodFirst)
				sum += numberOf(deps.peek())
			if (config.gatePrev && own % 2 === 0) {
				// The predecessor is not read while closed.
			}
			else if (config.catchPrev) {
				try {
					sum += numberOf(deps.prev())
				}
				catch {
					if (config.onCatch !== undefined)
						sum += numberOf(deps.onCatch())
				}
			}
			else {
				sum += numberOf(deps.prev())
				env.afterPrev?.(config.index)
			}
			for (const read of deps.extra)
				sum += numberOf(read())
			if (config.viaMethod !== undefined && !config.methodFirst)
				sum += numberOf(deps.peek())
			if (config.publicGet !== undefined) {
				const widget = env.runtime!.getWidget(config.publicGet) as { properties: { out: { get: () => ExecutionResult<unknown, unknown> } } }
				sum += numberOf(widget.properties.out.get())
			}
			if (own === 0)
				addDiagnostic({ message: `node ${config.index} is zero` })
			return sum
		},
	}))
	.methods(methods => methods
		.peek({
			registerDeps: ({ dep }) => ({ out: dep.self.properties.get('out') }),
			validateArgs: (args): args is [] => args.length === 0,
			execute: ({ deps }) => numberOf(deps.out()),
		}))
	.done()

const listPlugin = createWidgetPlugin('list')
	.description('Test widget')
	.interfaces<{ slots: 'items' }>()
	.slots({ items: { description: 'Items' } })
	.done()

const system = createWidgetSystem({ plugins: [nodePlugin, listPlugin] })

function createGraph(configs: readonly NodeConfig[]) {
	env.computeCalls = []
	env.onCompute = null
	env.afterPrev = null
	const blueprint = system.createBlueprint({ id: 'list', type: 'list', slots: { items: configs.map(config => ({ id: `n${config.index}`, type: 'node', config })) } })
	if (blueprint.status !== 'valid')
		throw new Error('expected a valid Blueprint')
	const runtime = blueprint.createRuntime()
	env.runtime = runtime as unknown as { getWidget: (id: string) => unknown }
	const node = (index: number) => {
		const widget = runtime.getWidget(`n${index}`)
		if (widget?.type !== 'node')
			throw new Error('expected a node widget')
		return widget
	}
	return { runtime, node, size: configs.length }
}

function chain(length: number, configure: (index: number) => Partial<NodeConfig> = () => ({})): NodeConfig[] {
	return Array.from({ length }, (_, index) => ({ index, prev: index === 0 ? null : `n${index - 1}`, ...configure(index) }))
}

/**
 * Subscribes to everything a host can observe on every node — Property values and diagnostics, widget and
 * Runtime diagnostics, inspection completions — and counts each listener's calls.
 */
function observeEverything(graph: ReturnType<typeof createGraph>) {
	const counts = new Map<string, number>()
	const count = (key: string) => () => {
		counts.set(key, (counts.get(key) ?? 0) + 1)
	}
	const inspection = inspectRuntime(graph.runtime)
	const nodeIds = new Map<string, (typeof inspection.blueprint.nodes)[number]['nodeId']>()
	for (const entry of inspection.blueprint.nodes) {
		if (entry.resolved)
			nodeIds.set(entry.node.id, entry.nodeId)
	}
	for (let index = 0; index < graph.size; index++) {
		const widget = graph.node(index)
		widget.properties.out.subscribeDiagnostics(count(`property diagnostics n${index}`))
		widget.subscribeDiagnostics(count(`widget diagnostics n${index}`))
		inspection.getWidget(nodeIds.get(`n${index}`)!)!.getProperty('out')!.subscribe(count(`inspection n${index}`))
	}
	graph.runtime.subscribeDiagnostics(count('runtime diagnostics'))
	const subscribe = (index: number) => graph.node(index).properties.out.subscribe(count(`value n${index}`))
	return { counts, subscribe, snapshot: () => new Map(counts) }
}

/** Reads every Property, from the last node down and then from the first up. */
function readEverything(graph: ReturnType<typeof createGraph>): unknown[] {
	const values: unknown[] = []
	for (let index = graph.size - 1; index >= 0; index--)
		values.push(graph.node(index).properties.out.get())
	for (let index = 0; index < graph.size; index++)
		values.push(graph.node(index).properties.out.get())
	return values
}

function totalComputeCalls(): number {
	return env.computeCalls.reduce((sum, calls) => sum + (calls ?? 0), 0)
}

/**
 * The graph shapes the deep read is completed through: a catching compute that then reads the first node
 * (evaluated first while the chain is unwinding), a conditional dependency, a Property depending on a Method
 * that reads a deep chain, and a compute calling a public `get()` of a deep chain. Node 0's State is 0, so a
 * diagnostic travels up every chain.
 */
const SHAPES: Record<string, () => NodeConfig[]> = {
	'a catching compute': () => chain(60, index => (index === 59 ? { catchPrev: true, extra: ['n0'] } : {})),
	'a conditional dependency': () => chain(60, index => (index === 59 ? { gate: true } : {})),
	'a Property depending on a Method': () => [...chain(60), { index: 60, prev: null, viaMethod: 'n59' }, { index: 61, prev: 'n60' }],
	'a compute calling a public get()': () => [...chain(60), { index: 60, prev: null, publicGet: 'n59' }, { index: 61, prev: 'n60' }],
}

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
	env.runtime = null
})

describe('after a deep read, reads with no State write', () => {
	it.each(Object.keys(SHAPES))('run no compute and notify or publish nothing (%s)', (shape) => {
		const graph = createGraph(SHAPES[shape]!())
		graph.node(0).state.n.set(0)
		const observed = observeEverything(graph)
		const last = graph.size - 1
		observed.subscribe(last)
		// Shapes whose last node is cheap: also read the deep head cold directly.
		graph.node(last).properties.out.get()
		graph.node(59).properties.out.get()

		const calls = totalComputeCalls()
		const counts = observed.snapshot()
		const first = readEverything(graph)
		const second = readEverything(graph)

		expect(second)
			.toEqual(first)
		expect(totalComputeCalls())
			.toBe(calls)
		expect(observed.counts)
			.toEqual(counts)
		expect(reported)
			.toEqual([])
	})

	it.each(Object.keys(SHAPES))('end with one inspection completion per Property, and one notification per change after (%s)', (shape) => {
		const graph = createGraph(SHAPES[shape]!())
		const observed = observeEverything(graph)
		const last = graph.size - 1
		observed.subscribe(last)
		readEverything(graph)

		for (let index = 0; index < graph.size; index++) {
			expect(observed.counts.get(`inspection n${index}`), `inspection n${index}`)
				.toBe(1)
		}
		expect(observed.counts.get(`value n${last}`) ?? 0)
			.toBe(0)

		graph.node(1).state.n.set(5)

		expect(observed.counts.get(`value n${last}`))
			.toBe(1)
		readEverything(graph)
		const counts = observed.snapshot()
		readEverything(graph)
		expect(observed.counts)
			.toEqual(counts)
	})
})

describe('a deep read of a chain alien-signals tore down (its last subscriber unsubscribed)', () => {
	const shapes: Record<string, () => NodeConfig[]> = {
		...SHAPES,
		'links that also read a Property of their own': () => Array.from({ length: 120 }, (_, index) => (index < 60
			? { index, prev: null }
			: { index, prev: index === 60 ? null : `n${index - 1}`, extra: [`n${index - 60}`] })),
	}

	it.each(Object.keys(shapes))('leaves nothing to compute, notify or publish on reads with no State write (%s)', (shape) => {
		const graph = createGraph(shapes[shape]!())
		graph.node(0).state.n.set(0)
		const last = graph.size - 1
		graph.node(last).properties.out.subscribe(() => {})()
		const observed = observeEverything(graph)
		const head = graph.node(last).properties.out.get()

		const calls = totalComputeCalls()
		const counts = observed.snapshot()
		const first = readEverything(graph)
		const second = readEverything(graph)

		expect(first[0])
			.toEqual(head)
		expect(second)
			.toEqual(first)
		expect(totalComputeCalls())
			.toBe(calls)
		expect(observed.counts)
			.toEqual(counts)
		expect(reported)
			.toEqual([])
	})

	it('leaves nothing to compute, notify or publish when the read starts above the torn-down part', () => {
		// n5 reads n3 and then its own n4; n3 reads n2 and n1, which reads n0 (State 0, a diagnostic). A chain of
		// `above` links over n5 ends with the head; the link two below the head is subscribed and unsubscribed,
		// which tears everything below it down, and the never evaluated head is read. Every offset of the limit
		// relative to n3 is covered.
		for (let above = 3; above <= 40; above++) {
			const head = 5 + above
			const configs: NodeConfig[] = [
				{ index: 0, prev: null },
				{ index: 1, prev: 'n0' },
				{ index: 2, prev: null },
				{ index: 3, prev: 'n2', extra: ['n1'] },
				{ index: 4, prev: null },
				{ index: 5, prev: 'n3', extra: ['n4'] },
				...chain(head + 1)
					.slice(6),
			]
			const graph = createGraph(configs)
			graph.node(0).state.n.set(0)
			graph.node(head - 2).properties.out.subscribe(() => {})()
			const observed = observeEverything(graph)
			const result = graph.node(head).properties.out.get()

			const calls = totalComputeCalls()
			const counts = observed.snapshot()
			const first = readEverything(graph)
			const second = readEverything(graph)

			expect(first[0], `above=${above}`)
				.toEqual(result)
			expect(second, `above=${above}`)
				.toEqual(first)
			expect(totalComputeCalls(), `above=${above}`)
				.toBe(calls)
			expect(observed.counts, `above=${above}`)
				.toEqual(counts)
		}
	})

	it('nests no deeper than the first cold read did', () => {
		// The deepest engine stack any compute runs on, for the first cold read of a 400-link chain and for
		// the cold read again once the chain was torn down. Unbounded, the second would grow with the chain.
		const length = 400
		const graph = createGraph(chain(length))
		let deepest = 0
		env.onCompute = () => {
			deepest = Math.max(deepest, new Error('depth probe').stack!.split('\n').length)
		}
		const stackTraceLimit = Error.stackTraceLimit
		Error.stackTraceLimit = Number.POSITIVE_INFINITY
		try {
			expect(graph.node(length - 1).properties.out.get())
				.toEqual({ ok: true, value: length })
			const cold = deepest
			graph.node(length - 1).properties.out.subscribe(() => {})()
			deepest = 0
			env.computeCalls = []

			expect(graph.node(length - 1).properties.out.get())
				.toEqual({ ok: true, value: length })
			expect(deepest)
				.toBeLessThanOrEqual(2 * cold)
			expect(Math.max(...env.computeCalls))
				.toBeLessThanOrEqual(4)
		}
		finally {
			Error.stackTraceLimit = stackTraceLimit
		}
	})
})

// A `compute` that reads, through a Runtime it holds by closure, a Property whose evaluation is in progress (or
// that depends on one) is not a supported pattern (see the Core guide). Core still recovers from it in the cases
// below, which used to be reached by inspection listeners; since those run once the outermost operation has
// finished (issue #198), a `compute` drives the recovery code instead, and these tests pin it.
describe('a compute reading by closure a Property while a deep read of it is in progress', () => {
	it('gets its value once and the read in progress completes normally', () => {
		const graph = createGraph(chain(100))
		const seen: unknown[] = []
		let armed = true
		env.afterPrev = (index) => {
			if (index === 51 && armed) {
				armed = false
				seen.push(graph.node(99).properties.out.get())
			}
		}

		expect(graph.node(99).properties.out.get())
			.toEqual({ ok: true, value: 100 })
		expect(seen)
			.toEqual([{ ok: true, value: 100 }])
		expect(reported)
			.toEqual([])
		// Linear work: each link is evaluated a bounded number of times. Most of the chain runs about twice as often
		// as in a plain cold read (about 2 per link), because the compute makes a nested boundary read; the maximum
		// is 5 (measured: 4 links 2 times, 83 links 4 times, 13 links 5 times), and the work stays linear in the
		// chain length.
		expect(Math.max(...env.computeCalls))
			.toBeLessThanOrEqual(5)
	})

	it('gets its value once from a long chain too', () => {
		const graph = createGraph(chain(5_000))
		const seen: unknown[] = []
		let armed = true
		env.afterPrev = (index) => {
			if (index === 2_501 && armed) {
				armed = false
				seen.push(graph.node(4_999).properties.out.get())
			}
		}

		expect(graph.node(4_999).properties.out.get())
			.toEqual({ ok: true, value: 5_000 })
		expect(seen)
			.toEqual([{ ok: true, value: 5_000 }])
		expect(Math.max(...env.computeCalls))
			.toBeLessThanOrEqual(5)
	})

	it('gets its value once wherever the reading link sits, also when it reads the head while the head is evaluating', () => {
		// The link that reads sits near the head (at 99 it is the head reading itself) or far down, while the
		// driver completes a deeper link.
		for (const at of [99, 95, 90, 85, 60, 20]) {
			const graph = createGraph(chain(100))
			const seen: unknown[] = []
			let armed = true
			env.afterPrev = (index) => {
				if (index === at && armed) {
					armed = false
					seen.push(graph.node(99).properties.out.get())
				}
			}

			expect(graph.node(99).properties.out.get(), `read from n${at}`)
				.toEqual({ ok: true, value: 100 })
			expect(seen, `read from n${at}`)
				.toEqual([{ ok: true, value: 100 }])
			expect(Math.max(...env.computeCalls), `read from n${at}`)
				.toBeLessThanOrEqual(at === 99 ? 3 : 5)
		}
		expect(reported)
			.toEqual([])
	})

	it('leaves every Property following later writes when the chain is re-read with every link stale', () => {
		// Every link reads its own State first: after every State is written, each re-evaluation nests the next
		// one, and the read is abandoned and completed like a first read. One link reads the head in the middle.
		for (const at of [95, 70, 40]) {
			const graph = createGraph(chain(100))
			graph.node(99).properties.out.get()
			const seen: unknown[] = []
			let armed = false
			env.afterPrev = (index) => {
				if (index === at && armed) {
					armed = false
					seen.push(graph.node(99).properties.out.get())
				}
			}
			for (let index = 0; index < 100; index++)
				graph.node(index).state.n.set(2)
			armed = true

			expect(graph.node(99).properties.out.get(), `read from n${at}`)
				.toEqual({ ok: true, value: 200 })
			expect(seen, `read from n${at}`)
				.toEqual([{ ok: true, value: 200 }])
			armed = false
			for (let index = 0; index < 100; index += 7)
				graph.node(index).state.n.set(3)
			const expected = Array.from({ length: 100 }, (_, index) => (index % 7 === 0 ? 3 : 2))
			for (let index = 0, sum = 0; index < 100; index++) {
				sum += expected[index]!
				expect(graph.node(index).properties.out.get(), `read from n${at}, n${index}`)
					.toEqual({ ok: true, value: sum })
			}
		}
		expect(reported)
			.toEqual([])
	})
})

describe('a compute reading by closure, through another Property, a link whose re-evaluation is in progress', () => {
	it('leaves the links above it following later writes', () => {
		// Q (n100) reads n{target}. While a re-read of the stale chain completes a stretch of links, n31's compute
		// reads Q, which reads a link whose evaluation is in progress further up the stack: that link is replaced
		// by a fresh computed for this read, and the link above it, which reads it, must follow the fresh one.
		for (let target = 31; target <= 42; target++) {
			const configs = chain(100)
			configs.push({ index: 100, prev: `n${target}` })
			const graph = createGraph(configs)
			graph.node(99).properties.out.get()
			graph.node(100).properties.out.get()
			let armed = false
			env.afterPrev = (index) => {
				if (index === 31 && armed) {
					armed = false
					graph.node(100).properties.out.get()
				}
			}
			for (let index = 0; index < 100; index++)
				graph.node(index).state.n.set(2)
			armed = true

			expect(graph.node(99).properties.out.get(), `Q reads n${target}`)
				.toEqual({ ok: true, value: 200 })
			armed = false
			graph.node(target - 2).state.n.set(5)
			expect(graph.node(99).properties.out.get(), `Q reads n${target}, after a write below it`)
				.toEqual({ ok: true, value: 203 })
			expect(graph.node(100).properties.out.get(), `Q reads n${target}, after a write below it`)
				.toEqual({ ok: true, value: 1 + 2 * (target + 1) + 3 })
		}
		expect(reported)
			.toEqual([])
	})
})

describe('a compute that catches an abandonment and reads another Property while the read unwinds', () => {
	it('leaves that Property following the State the read saw', () => {
		// n59 reads its predecessor inside try/catch and, when that read throws, n60, which reads n50: the
		// abandonment of the re-read reaches n59 while n50 is itself abandoned, and n59 then reads n60.
		const configs = chain(60, index => (index === 59 ? { catchPrev: true, onCatch: 'n60' } : {}))
		configs.push({ index: 60, prev: 'n50' })
		const graph = createGraph(configs)
		expect(graph.node(59).properties.out.get())
			.toEqual({ ok: true, value: 60 })
		expect(graph.node(60).properties.out.get())
			.toEqual({ ok: true, value: 52 })
		for (let index = 0; index < 60; index++)
			graph.node(index).state.n.set(2)

		expect(graph.node(59).properties.out.get())
			.toEqual({ ok: true, value: 120 })
		expect(graph.node(60).properties.out.get())
			.toEqual({ ok: true, value: 103 })
	})
})

describe('a read nested in an evaluation (a Method a compute invokes reads a Property)', () => {
	it('does not let the enclosing chain nest without bound', () => {
		// Every link first invokes a side widget's Method, which reads the side widget's Property (a read nested
		// in the link's evaluation, on a segment of its own), and then reads its predecessor: the nesting counted
		// for the chain must survive the nested read, or the chain would nest without bound.
		const length = 3_000
		const configs = chain(length, () => ({ viaMethod: 'n3000', methodFirst: true }))
		configs.push({ index: length, prev: null })
		const graph = createGraph(configs)

		// Each link adds the side widget's value (1) to its own.
		expect(graph.node(length - 1).properties.out.get())
			.toEqual({ ok: true, value: 2 * length })
	})
})

describe('a re-evaluation that first reads a newly opened, cold and deep dependency', () => {
	it('keeps the dependencies it reads after it: nothing is torn down and evaluated again', () => {
		// n61 reads n60 (which only it reads) after its gated predecessor n59, the head of a cold 60-link chain.
		const configs = chain(60)
		configs.push({ index: 60, prev: null }, { index: 61, prev: 'n59', gatePrev: true, extra: ['n60'] })
		const graph = createGraph(configs)
		const reader = graph.node(61)
		reader.state.n.set(2)
		expect(reader.properties.out.get())
			.toEqual({ ok: true, value: 3 })
		const observed = observeEverything(graph)

		reader.state.n.set(1)

		expect(reader.properties.out.get())
			.toEqual({ ok: true, value: 62 })
		expect(env.computeCalls[60])
			.toBe(1)
		expect(observed.counts.get('inspection n60') ?? 0)
			.toBe(0)
	})
})

describe('a deep read nested in a re-evaluation (a Method it invokes reads a cold chain)', () => {
	it('leaves the re-evaluated Property clean when nothing else reads it', () => {
		const configs = chain(60)
		configs.push({ index: 60, prev: null, gate: true, viaMethod: 'n59' })
		const graph = createGraph(configs)
		const gated = graph.node(60)
		gated.state.n.set(2)
		expect(gated.properties.out.get())
			.toEqual({ ok: true, value: 2 })

		gated.state.n.set(1)

		expect(gated.properties.out.get())
			.toEqual({ ok: true, value: 61 })
		const calls = totalComputeCalls()
		expect(gated.properties.out.get())
			.toEqual({ ok: true, value: 61 })
		expect(totalComputeCalls())
			.toBe(calls)
	})

	it('leaves the re-evaluated Property and its readers clean', () => {
		// n60 first completes with its gate closed: it has dependency links but never invoked the Method.
		// Opening the gate makes its re-evaluation read the cold 60-link chain through the Method.
		const configs = chain(60)
		configs.push({ index: 60, prev: null, gate: true, viaMethod: 'n59' }, { index: 61, prev: 'n60' })
		const graph = createGraph(configs)
		graph.node(60).state.n.set(2)
		expect(graph.node(61).properties.out.get())
			.toEqual({ ok: true, value: 3 })
		const observed = observeEverything(graph)
		observed.subscribe(61)

		graph.node(60).state.n.set(1)

		expect(observed.counts.get('value n61'))
			.toBe(1)
		expect(graph.node(61).properties.out.get())
			.toEqual({ ok: true, value: 62 })
		const calls = totalComputeCalls()
		const counts = observed.snapshot()
		readEverything(graph)
		readEverything(graph)
		expect(totalComputeCalls())
			.toBe(calls)
		expect(observed.counts)
			.toEqual(counts)
	})
})

describe('subscribers of a Property that reads a deep chain through a Method, and of its reader', () => {
	it('get only current values after a write', () => {
		// n14 invokes the Method of n13, the last link of a chain deeper than the limit, which also invokes the
		// Method of n0; n15 reads n14. Only what the notifications carry is checked, not which ones are sent.
		const configs = chain(14, index => (index === 13 ? { viaMethod: 'n0' } : {}))
		configs.push({ index: 14, prev: null, viaMethod: 'n13' }, { index: 15, prev: 'n14' })
		const graph = createGraph(configs)
		const notified: string[] = []
		graph.node(15).properties.out.subscribe(result => notified.push(`n15: ${numberOf(result)}`))
		graph.node(14).properties.out.subscribe(result => notified.push(`n14: ${numberOf(result)}`))
		expect(graph.node(15).properties.out.get())
			.toEqual({ ok: true, value: 17 })

		graph.node(0).state.n.set(3)

		expect(graph.node(14).properties.out.get())
			.toEqual({ ok: true, value: 20 })
		expect(graph.node(15).properties.out.get())
			.toEqual({ ok: true, value: 21 })
		expect(notified.filter(entry => entry !== 'n14: 20'))
			.toEqual(['n15: 21'])
		expect(reported)
			.toEqual([])
	})
})

describe('disposal in the middle of a deep read', () => {
	it('ends the read with the post-dispose error even when computes catch what their reads throw', () => {
		const graph = createGraph(chain(200, () => ({ catchPrev: true, catchState: true })))
		env.onCompute = (index) => {
			if (index === 100)
				graph.runtime.dispose()
		}

		expect(() => graph.node(199).properties.out.get())
			.toThrow(WidgetSystemRuntimeDisposedError)
	})
})

describe('a Property re-evaluating with its dependency links', () => {
	it('completes a newly read, cold and deep dependency in place, wherever in the read the limit falls', () => {
		// A cold chain of `above` links reads a gated Property that was evaluated with its gate closed; opening
		// the gate makes it read a long cold chain when the head is first read. Every offset of the limit
		// relative to the gated Property is covered.
		for (let above = 1; above <= 40; above++) {
			const below = 60
			const configs = chain(below)
			configs.push({ index: below, prev: 'n59', gate: true })
			for (let index = below + 1; index <= below + above; index++)
				configs.push({ index, prev: `n${index - 1}` })
			const graph = createGraph(configs)
			const gated = graph.node(below)
			gated.state.n.set(2)
			expect(gated.properties.out.get())
				.toEqual({ ok: true, value: 2 })
			gated.state.n.set(1)

			expect(graph.node(below + above).properties.out.get(), `above=${above}`)
				.toEqual({ ok: true, value: below + 1 + above })
		}
	})
})

describe('a Property only an abandoned run reached', () => {
	it('stays never-evaluated, its compute never run', () => {
		// The head reads its chain inside try/catch and, only when that read throws, a fallback Property.
		const configs = chain(60, index => (index === 59 ? { catchPrev: true, onCatch: 'n60' } : {}))
		configs.push({ index: 60, prev: null })
		const graph = createGraph(configs)
		const inspection = inspectRuntime(graph.runtime)
		const fallbackId = inspection.blueprint.nodes.find(entry => entry.resolved && entry.node.id === 'n60')!.nodeId
		const head = graph.node(59)

		expect(head.properties.out.get())
			.toEqual({ ok: true, value: 60 })
		expect(inspection.getWidget(fallbackId)!.getProperty('out')!.getSnapshot())
			.toEqual({ status: 'never-evaluated' })
		expect(env.computeCalls[60])
			.toBeUndefined()
	})
})
