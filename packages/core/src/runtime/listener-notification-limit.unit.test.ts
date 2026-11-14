/**
 * Conformance: a subscription's listener is notified at most `MAX_NOTIFICATIONS_PER_CALL` times within one host
 * call into the Runtime, the Property inspection deliveries that call queues included.
 *
 * A write made by a listener while another Runtime call is in progress is delivered later in that call (issue
 * #204), so listeners that keep changing what they observe (a self-normaliser that writes a fresh copy while
 * something else reads the member, a two-way mirror of objects without a structural comparison, a diverging
 * pair) would make the host's call loop forever. Beyond the limit the listener is not called again for the rest
 * of that call, one `RangeError` naming what the subscription observes is reported asynchronously, the host's
 * call returns normally, values stay consistent, and the next call counts from zero. Converging listeners are
 * not affected, including cascades that notify one subscription many times. Also pinned here: several nested
 * writes to one member are delivered once, with the last value; a listener that writes what it observes is called
 * again when anything reads that member later in the same call, or during a later call when the host reads it
 * after the call; and no batch level is left behind by an exception, a disposal or a Runtime created inside a
 * nested write.
 */

import type { RuntimeState } from '../index'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createWidgetPlugin, createWidgetSystem } from '../index'
import { inspectRuntime } from '../inspection'
import { MAX_NOTIFICATIONS_PER_CALL as LIMIT } from './adapter'

interface NodeInterfaces {
	state: { n: number, o: unknown }
	properties: { out: number, obj: unknown }
	methods: { setN: (value: number) => number, setO: (value: unknown) => unknown }
}

const isNumber = (input: unknown): input is number => typeof input === 'number'
const isAnything = (input: unknown): input is unknown => input !== undefined

const nodePlugin = createWidgetPlugin('node')
	.description('Test widget')
	.interfaces<NodeInterfaces>()
	.state(state => state
		.n({ validate: isNumber, default: () => 1 })
		.o({ validate: isAnything, default: () => ({ x: 1 }) }))
	.properties(properties => properties
		.out({
			registerDeps: ({ dep }) => ({ n: dep.self.state.get('n') }),
			compute: ({ deps }) => {
				const n = deps.n()
				return n.ok && n.value !== null ? n.value : 0
			},
		})
		.obj({
			registerDeps: ({ dep }) => ({ o: dep.self.state.get('o') }),
			compute: ({ deps }) => {
				const o = deps.o()
				return o.ok ? o.value : null
			},
		}))
	.methods(methods => methods
		.setN({
			registerDeps: ({ dep }) => ({ n: dep.self.state.set('n') }),
			validateArgs: (args): args is [number] => isNumber(args[0]),
			execute: ({ args, deps }) => {
				deps.n(args[0])
				return args[0]
			},
		})
		.setO({
			registerDeps: ({ dep }) => ({ o: dep.self.state.set('o') }),
			validateArgs: (args): args is [unknown] => args.length === 1,
			execute: ({ args, deps }) => {
				deps.o(args[0])
				return args[0]
			},
		}))
	.done()

const graphPlugin = createWidgetPlugin('graph')
	.description('Test widget')
	.interfaces<{ slots: 'nodes' }>()
	.slots({ nodes: { description: 'Nodes' } })
	.done()

const system = createWidgetSystem({ plugins: [nodePlugin, graphPlugin] })

function createGraph(ids: readonly string[] = ['a', 'b', 'c']) {
	const blueprint = system.createBlueprint({ id: 'g', type: 'graph', slots: { nodes: ids.map(id => ({ id, type: 'node' })) } })
	if (blueprint.status !== 'valid')
		throw new Error('fixture setup error: the Blueprint is invalid')
	const runtime = blueprint.createRuntime()
	const widget = (id: string) => {
		const found = runtime.getWidget(id)
		if (found?.type !== 'node')
			throw new Error(`missing node ${id}`)
		return found
	}
	return { blueprint, runtime, widget }
}

type Graph = ReturnType<typeof createGraph>
type Via = 'set' | 'method'

function writeN(graph: Graph, id: string, value: number, via: Via): void {
	if (via === 'set')
		graph.widget(id).state.n.set(value)
	else
		graph.widget(id).methods.setN(value)
}

function writeO(graph: Graph, id: string, value: unknown, via: Via): void {
	if (via === 'set')
		graph.widget(id).state.o.set(value)
	else
		graph.widget(id).methods.setO(value)
}

const reported: unknown[] = []
const onUncaughtException = (error: unknown) => reported.push(error)
beforeEach(() => {
	reported.length = 0
	process.on('uncaughtException', onUncaughtException)
})
afterEach(async () => {
	await new Promise<void>(resolve => setTimeout(resolve, 0))
	process.off('uncaughtException', onUncaughtException)
})

async function settle(): Promise<void> {
	await new Promise<void>(resolve => setTimeout(resolve, 0))
}

function expectLimitReport(error: unknown, widgetId: string, member: string): void {
	expect(error)
		.toBeInstanceOf(RangeError)
	const message = (error as RangeError).message
	expect(message)
		.toContain(`"${widgetId}"`)
	expect(message)
		.toContain(`"${member}"`)
}

function expectOneLimitReport(widgetId: string, member: string): void {
	expect(reported)
		.toHaveLength(1)
	expectLimitReport(reported[0], widgetId, member)
}

function inspectedProperty(graph: Graph, widgetId: string, name: string) {
	const inspection = inspectRuntime(graph.runtime)
	const entry = inspection.blueprint.nodes.find(node => node.resolved && node.node.id === widgetId)!
	return inspection.getWidget(entry.nodeId)!.getProperty(name)!
}

describe('listeners that never converge', () => {
	for (const via of ['set', 'method'] as const) {
		for (const second of ['State subscriber', 'Property subscriber', 'listener that only reads it'] as const) {
			it(`stop a self-normaliser with a ${second} after ${LIMIT} notifications (${via})`, async () => {
				const graph = createGraph()
				const a = graph.widget('a')
				let normalising = true
				let normaliserCalls = 0
				let secondCalls = 0
				let tick = 1
				a.state.o.subscribe((value) => {
					normaliserCalls++
					if (!normalising || !Array.isArray(value))
						return
					// A fresh, sorted copy on every call: it never compares equal to what it replaces.
					writeO(graph, 'a', [...value].sort(), via)
					if (second === 'listener that only reads it')
						graph.widget('b').state.n.set(++tick)
				})
				if (second === 'State subscriber') {
					a.state.o.subscribe(() => secondCalls++)
				}
				else if (second === 'Property subscriber') {
					a.properties.obj.subscribe(() => secondCalls++)
				}
				else {
					graph.widget('b').state.n.subscribe(() => {
						secondCalls++
						a.state.o.get()
					})
				}

				writeO(graph, 'a', [3, 1, 2], via)
				await settle()

				expect([normaliserCalls, secondCalls])
					.toEqual([LIMIT, LIMIT])
				expectOneLimitReport('a', 'o')
				expect(a.state.o.get())
					.toEqual([1, 2, 3])
				expect(a.properties.obj.get())
					.toEqual({ ok: true, value: a.state.o.get() })

				// The next call counts from zero and notifies normally.
				normalising = false
				normaliserCalls = 0
				writeO(graph, 'a', [5, 4], via)
				await settle()
				expect(normaliserCalls)
					.toBe(1)
				expect(reported)
					.toHaveLength(1)
			})
		}

		it(`stops a two-way mirror of objects after ${LIMIT} notifications of one subscriber (${via})`, async () => {
			const graph = createGraph()
			let mirroring = true
			const calls = { a: 0, b: 0 }
			graph.widget('a').state.o.subscribe((value) => {
				calls.a++
				if (mirroring)
					writeO(graph, 'b', { ...(value as object) }, via)
			})
			graph.widget('b').state.o.subscribe((value) => {
				calls.b++
				if (mirroring)
					writeO(graph, 'a', { ...(value as object) }, via)
			})

			writeO(graph, 'a', { x: 2 }, via)
			await settle()

			expect(calls)
				.toEqual({ a: LIMIT, b: LIMIT })
			expectOneLimitReport('a', 'o')
			expect(graph.widget('a').state.o.get())
				.toEqual({ x: 2 })
			expect(graph.widget('b').state.o.get())
				.toEqual({ x: 2 })
			expect(graph.widget('a').properties.obj.get())
				.toEqual({ ok: true, value: graph.widget('a').state.o.get() })

			// The next call counts from zero and notifies normally.
			mirroring = false
			calls.a = 0
			calls.b = 0
			writeO(graph, 'a', { x: 3 }, via)
			await settle()
			expect(calls)
				.toEqual({ a: 1, b: 0 })
			expect(reported)
				.toHaveLength(1)
		})

		it(`stops a diverging pair after ${LIMIT} notifications of one subscriber (${via})`, async () => {
			const graph = createGraph()
			let diverging = true
			const calls = { a: 0, b: 0 }
			graph.widget('a').properties.out.subscribe((result) => {
				calls.a++
				if (diverging && result.ok)
					writeN(graph, 'b', result.value + 1, via)
			})
			graph.widget('b').properties.out.subscribe((result) => {
				calls.b++
				if (diverging && result.ok)
					writeN(graph, 'a', result.value + 1, via)
			})

			writeN(graph, 'a', 7, via)
			await settle()

			expect(calls)
				.toEqual({ a: LIMIT, b: LIMIT })
			expectOneLimitReport('a', 'out')
			const a = graph.widget('a').state.n.get()
			const b = graph.widget('b').state.n.get()
			expect([graph.widget('a').properties.out.get(), graph.widget('b').properties.out.get()])
				.toEqual([{ ok: true, value: a }, { ok: true, value: b }])
			expect(a)
				.toBe(b! + 1)

			diverging = false
			calls.a = 0
			calls.b = 0
			writeN(graph, 'b', 1, via)
			await settle()
			expect(calls)
				.toEqual({ a: 0, b: 1 })
			expect(reported)
				.toHaveLength(1)
		})
	}

	it('counts every kind of subscription: a diagnostics subscription is stopped as well', async () => {
		const graph = createGraph()
		const calls = { a: 0, b: 0 }
		let candidate = 0
		const invalid = (id: string) => (graph.widget(id).state.n as RuntimeState<unknown>).set(`invalid ${++candidate}`)
		// Each rejected candidate commits a fresh diagnostic snapshot, so each write notifies the other side.
		graph.widget('a').state.n.subscribeDiagnostics(() => {
			calls.a++
			invalid('b')
		})
		graph.widget('b').state.n.subscribeDiagnostics(() => {
			calls.b++
			invalid('a')
		})

		invalid('a')
		await settle()

		expect(calls)
			.toEqual({ a: LIMIT, b: LIMIT })
		expectOneLimitReport('a', 'n')
	})

	it('counts the Runtime diagnostics subscription too, and names it in the report', async () => {
		const graph = createGraph()
		const calls = { runtime: 0, state: 0 }
		let candidate = 0
		const invalid = (id: string) => (graph.widget(id).state.n as RuntimeState<unknown>).set(`invalid ${++candidate}`)
		graph.runtime.subscribeDiagnostics(() => {
			calls.runtime++
			invalid('a')
		})
		graph.widget('a').state.n.subscribeDiagnostics(() => {
			calls.state++
			invalid('b')
		})

		// Starts on `b`: only the Runtime's listener is notified first, so it is the one that reaches the limit.
		invalid('b')
		await settle()

		expect(calls)
			.toEqual({ runtime: LIMIT, state: LIMIT })
		expect(reported)
			.toHaveLength(1)
		expect(reported[0])
			.toBeInstanceOf(RangeError)
		expect((reported[0] as RangeError).message)
			.toContain('the Runtime')
	})

	it('counts a widget\'s diagnostics subscription, and names the widget in the report', async () => {
		const graph = createGraph()
		const calls = { a: 0, b: 0 }
		let candidate = 0
		const invalid = (id: string) => (graph.widget(id).state.n as RuntimeState<unknown>).set(`invalid ${++candidate}`)
		graph.widget('a')
			.subscribeDiagnostics(() => {
				calls.a++
				invalid('b')
			})
		graph.widget('b')
			.subscribeDiagnostics(() => {
				calls.b++
				invalid('a')
			})

		invalid('a')
		await settle()

		expect(calls)
			.toEqual({ a: LIMIT, b: LIMIT })
		expect(reported)
			.toHaveLength(1)
		expect(reported[0])
			.toBeInstanceOf(RangeError)
		expect((reported[0] as RangeError).message)
			.toContain('"a"')
	})

	it('counts a Method\'s diagnostics subscription, and names the widget and Method in the report', async () => {
		const graph = createGraph()
		const calls = { a: 0, b: 0 }
		let candidate = 0
		// Rejected arguments commit a fresh diagnostic snapshot on every invocation.
		const invalid = (id: string) => (graph.widget(id).methods.setN as unknown as (value: unknown) => unknown)(`invalid ${++candidate}`)
		graph.widget('a').methods.setN.subscribeDiagnostics(() => {
			calls.a++
			invalid('b')
		})
		graph.widget('b').methods.setN.subscribeDiagnostics(() => {
			calls.b++
			invalid('a')
		})

		invalid('a')
		await settle()

		expect(calls)
			.toEqual({ a: LIMIT, b: LIMIT })
		expectOneLimitReport('a', 'setN')
	})
})

describe('the count belongs to the host\'s call', () => {
	it('includes the Property inspection deliveries the call queues: a loop restarted by every delivery is stopped once', async () => {
		const graph = createGraph(['a', 'c', 'd'])
		const [a, c, d] = [graph.widget('a'), graph.widget('c'), graph.widget('d')]
		const calls = { inspection: 0, c: 0, d: 0 }
		let looping = true
		// Subscribed first: its first evaluation completes before the inspection listener exists.
		let aCalls = 0
		a.properties.out.subscribe(() => aCalls++)
		// Every completion of `a.out` is delivered after the operation that produced it, and the listener's write
		// starts the `c`/`d` loop again; each of `d`'s writes to `a` queues another completion.
		inspectedProperty(graph, 'a', 'out')
			.subscribe((snapshot) => {
				calls.inspection++
				if (looping && snapshot.status === 'completed' && snapshot.result.ok)
					c.state.n.set((snapshot.result.value as number) * 1000)
			})
		c.state.n.subscribe((value) => {
			calls.c++
			if (looping)
				d.state.n.set(value! + 1)
		})
		d.state.n.subscribe((value) => {
			calls.d++
			if (looping) {
				c.state.n.set(value! + 1)
				a.state.n.set(value!)
			}
		})

		a.state.n.set(2)
		await settle()

		expect(calls.c)
			.toBe(LIMIT)
		expect(calls.d)
			.toBe(LIMIT)
		expect(aCalls)
			.toBe(LIMIT)
		// One delivery per completion of `a.out`: the first one and one per write `d` made.
		expect(calls.inspection)
			.toBe(LIMIT + 1)
		expect(reported)
			.toHaveLength(2)
		expectLimitReport(reported.find(error => (error as Error).message.includes('"c"')), 'c', 'n')
		expectLimitReport(reported.find(error => (error as Error).message.includes('"a"')), 'a', 'out')
		expect(a.properties.out.get())
			.toEqual({ ok: true, value: a.state.n.get() })
		expect(c.properties.out.get())
			.toEqual({ ok: true, value: c.state.n.get() })
		expect(inspectedProperty(graph, 'a', 'out')
			.getSnapshot())
			.toEqual({ status: 'completed', result: a.properties.out.get() })

		// The next call counts from zero and notifies normally.
		looping = false
		calls.c = 0
		c.state.n.set(-1)
		await settle()
		expect(calls.c)
			.toBe(1)
		expect(reported)
			.toHaveLength(2)
	})

	it('includes the Property inspection deliveries the call queues: a loop alternating between a subscriber and an inspection listener is stopped by the bound on delivery rounds', async () => {
		const graph = createGraph()
		const [a, b] = [graph.widget('a'), graph.widget('b')]
		const calls = { inspection: 0, b: 0 }
		let looping = true
		a.properties.out.subscribe(() => {})
		inspectedProperty(graph, 'a', 'out')
			.subscribe((snapshot) => {
				calls.inspection++
				if (looping && snapshot.status === 'completed' && snapshot.result.ok)
					b.state.n.set((snapshot.result.value as number) + 1)
			})
		b.state.n.subscribe((value) => {
			calls.b++
			if (looping)
				a.state.n.set(value! + 1)
		})

		a.state.n.set(2)
		await settle()

		// One subscriber notification per delivery round: the rounds are bounded first, with their own report.
		expect(calls.b)
			.toBe(calls.inspection)
		expect(calls.b)
			.toBeLessThan(LIMIT)
		expect(reported)
			.toHaveLength(1)
		expect(reported[0])
			.toBeInstanceOf(RangeError)
		expect(a.properties.out.get())
			.toEqual({ ok: true, value: a.state.n.get() })

		looping = false
		calls.b = 0
		b.state.n.set(-1)
		await settle()
		expect(calls.b)
			.toBe(1)
		expect(reported)
			.toHaveLength(1)
	})
})

describe('a subscriber the limit stopped', () => {
	function divergingPair() {
		const graph = createGraph()
		const calls = { a: 0, b: 0, c: 0 }
		const last: { a: number | null, b: number | null } = { a: null, b: null }
		graph.widget('a').state.n.subscribe((value) => {
			calls.a++
			last.a = value
			graph.widget('b').state.n.set(value! + 1)
		})
		graph.widget('b').state.n.subscribe((value) => {
			calls.b++
			last.b = value
			graph.widget('a').state.n.set(value! + 1)
		})
		graph.widget('c').state.n.subscribe(() => calls.c++)
		return { graph, calls, last }
	}

	it('keeps the last value delivered to it, and a later unrelated call does not deliver the current one', async () => {
		const { graph, calls, last } = divergingPair()

		graph.widget('a').state.n.set(7)
		await settle()

		expect(calls.a)
			.toBe(LIMIT)
		expect(last.a)
			.not
			.toBe(graph.widget('a').state.n.get())
		expect(last.b)
			.toBe(graph.widget('b').state.n.get())
		const stale = last.a

		graph.widget('c').state.n.set(5)
		await settle()

		expect(calls)
			.toEqual({ a: LIMIT, b: LIMIT, c: 1 })
		expect(last.a)
			.toBe(stale)
		expectOneLimitReport('a', 'n')
	})

	it('is stopped again, with a second report, when a later call loops again', async () => {
		const { graph, calls } = divergingPair()

		graph.widget('a').state.n.set(7)
		await settle()
		graph.widget('a').state.n.set(1000)
		await settle()

		expect([calls.a, calls.b])
			.toEqual([2 * LIMIT, 2 * LIMIT])
		expect(reported)
			.toHaveLength(2)
		expectLimitReport(reported[0], 'a', 'n')
		expectLimitReport(reported[1], 'a', 'n')
	})
})

describe('listeners that converge', () => {
	for (const via of ['set', 'method'] as const) {
		it(`are not affected: a clamp (${via})`, async () => {
			const graph = createGraph()
			const log: number[] = []
			graph.widget('a').properties.out.subscribe((result) => {
				log.push(result.ok ? result.value : -1)
				if (result.ok && result.value > 10)
					writeN(graph, 'a', 10, via)
			})

			writeN(graph, 'a', 50, via)
			await settle()

			expect(log)
				.toEqual([50])
			expect(graph.widget('a').state.n.get())
				.toBe(10)
			expect(reported)
				.toEqual([])
		})

		it(`are not affected: a two-way mirror of primitives (${via})`, async () => {
			const graph = createGraph()
			const log: string[] = []
			graph.widget('a').state.n.subscribe((value) => {
				log.push(`a=${value}`)
				writeN(graph, 'b', value!, via)
			})
			graph.widget('b').state.n.subscribe((value) => {
				log.push(`b=${value}`)
				writeN(graph, 'a', value!, via)
			})

			writeN(graph, 'a', 5, via)
			await settle()

			expect(log)
				.toEqual(['a=5', 'b=5'])
			expect(reported)
				.toEqual([])
		})

		it(`are not affected: a two-way binding of objects with an equality guard (${via})`, async () => {
			const graph = createGraph()
			const sameContents = (x: unknown, y: unknown) => JSON.stringify(x) === JSON.stringify(y)
			const log: string[] = []
			graph.widget('a').state.o.subscribe((value) => {
				log.push(`a=${JSON.stringify(value)}`)
				if (!sameContents(value, graph.widget('b').state.o.get()))
					writeO(graph, 'b', { ...(value as object) }, via)
			})
			graph.widget('b').state.o.subscribe((value) => {
				log.push(`b=${JSON.stringify(value)}`)
				if (!sameContents(value, graph.widget('a').state.o.get()))
					writeO(graph, 'a', { ...(value as object) }, via)
			})

			writeO(graph, 'a', { x: 2 }, via)
			await settle()

			expect(log)
				.toEqual(['a={"x":2}', 'b={"x":2}'])
			expect(reported)
				.toEqual([])
		})
	}

	it('are not affected when a cascade notifies one subscriber far more than a hundred times', async () => {
		const steps = 250
		const ids = Array.from({ length: steps + 1 }, (_, index) => `w${index}`)
		const graph = createGraph([...ids, 'counter'])
		const counter = graph.widget('counter').state.n
		counter.set(0)
		for (let index = 0; index < steps; index++) {
			graph.widget(`w${index}`).state.n.subscribe((value) => {
				graph.widget(`w${index + 1}`).state.n.set(value!)
				counter.set(counter.get()! + 1)
			})
		}
		const delivered: number[] = []
		counter.subscribe(value => delivered.push(value!))

		graph.widget('w0').state.n.set(42)
		await settle()

		expect(graph.widget(`w${steps}`).state.n.get())
			.toBe(42)
		expect(counter.get())
			.toBe(steps)
		expect(delivered.at(-1))
			.toBe(steps)
		expect(delivered.length)
			.toBeGreaterThan(100)
		expect(reported)
			.toEqual([])
	})

	it('are not affected when a listener drains a queue it observes one item per notification', async () => {
		const graph = createGraph()
		const queue = graph.widget('a').state.o
		let processed = 0
		let renders = 0
		queue.subscribe((value) => {
			const items = value as number[]
			if (items.length > 0) {
				processed++
				queue.set(items.slice(1))
			}
		})
		queue.subscribe(() => renders++)

		queue.set(Array.from({ length: 150 }, (_, index) => index))
		await settle()

		expect(processed)
			.toBe(150)
		expect(renders)
			.toBeGreaterThan(100)
		expect(queue.get())
			.toEqual([])
		expect(reported)
			.toEqual([])
	})
})

describe('nested writes', () => {
	for (const kind of ['State', 'Property'] as const) {
		it(`to one member are delivered once, with the last value (${kind} subscriber)`, () => {
			const graph = createGraph()
			const log: number[] = []
			graph.widget('a').state.n.subscribe(() => {
				graph.widget('b').state.n.set(10)
				graph.widget('b').state.n.set(20)
			})
			if (kind === 'State')
				graph.widget('b').state.n.subscribe(value => log.push(value!))
			else
				graph.widget('b').properties.out.subscribe(result => log.push(result.ok ? result.value : -1))

			graph.widget('a').state.n.set(7)

			expect(log)
				.toEqual([20])
		})
	}

	it('made by a listener to the member it observes are delivered to it again when the member is read later in the same call', () => {
		const graph = createGraph()
		const log: string[] = []
		graph.widget('a').state.n.subscribe((value) => {
			log.push(`a=${value}`)
			if (value! > 10)
				graph.widget('a').state.n.set(10)
			graph.widget('b').state.n.set(value!)
		})
		graph.widget('b').state.n.subscribe((value) => {
			log.push(`b=${value} reads a=${graph.widget('a').state.n.get()}`)
		})

		graph.widget('a').state.n.set(50)

		expect(log)
			.toEqual(['a=50', 'b=50 reads a=10', 'a=10', 'b=10 reads a=10'])
	})

	it('made by a listener to the member it observes, read by the host after the call, are delivered to it during a later call that notifies or invokes', () => {
		const graph = createGraph()
		const other = createGraph()
		const log: string[] = []
		graph.widget('a').state.n.subscribe((value) => {
			log.push(`a=${value}`)
			if (value! > 10)
				graph.widget('a').state.n.set(10)
		})
		graph.widget('b').state.n.subscribe(value => log.push(`b=${value}`))
		other.widget('a').state.n.subscribe(value => log.push(`other a=${value}`))
		const clampTo10 = () => {
			graph.widget('a').state.n.set(50)
			log.push(`host get a=${graph.widget('a').state.n.get()}`)
		}

		// Neither a get() nor a write that nothing observes delivers it.
		clampTo10()
		graph.widget('b').state.n.get()
		graph.widget('c').state.n.set(3)
		log.push('get and unobserved write returned')
		// A write that notifies a subscriber does, on the same Runtime ...
		graph.widget('b').state.n.set(4)
		log.push('set returned')
		// ... or on another one.
		graph.widget('a').state.n.set(1)
		clampTo10()
		other.widget('a').state.n.set(5)
		log.push('other set returned')
		// So does a Method call, even one that changes nothing.
		clampTo10()
		graph.widget('c').methods.setN(3)
		log.push('method returned')

		expect(log)
			.toEqual([
				'a=50',
				'host get a=10',
				'get and unobserved write returned',
				'a=10',
				'b=4',
				'set returned',
				'a=1',
				'a=50',
				'host get a=10',
				'a=10',
				'other a=5',
				'other set returned',
				'a=50',
				'host get a=10',
				'a=10',
				'method returned',
			])
	})

	it('across two Runtimes are delivered after the write returns, within the same outer call', () => {
		const first = createGraph()
		const second = createGraph()
		const order: string[] = []
		first.widget('a').state.n.subscribe((value) => {
			order.push(`first a=${value}`)
			second.widget('a').state.n.set(value! * 10)
			order.push('second set returned')
		})
		second.widget('a').state.n.subscribe((value) => {
			order.push(`second a=${value}`)
			if (value === 70)
				first.widget('a').state.n.set(2)
		})

		first.widget('a').state.n.set(7)
		order.push('host returned')

		expect(order)
			.toEqual(['first a=7', 'second set returned', 'second a=70', 'first a=2', 'second set returned', 'second a=20', 'host returned'])
	})
})

describe('no batch level is left behind', () => {
	/** A later top-level write still notifies its subscriber before it returns. */
	function expectTopLevelWriteNotifiesAtOnce(): void {
		const graph = createGraph()
		const order: string[] = []
		graph.widget('a').state.n.subscribe(value => order.push(`a=${value}`))
		graph.widget('a').state.n.set(3)
		order.push('set returned')
		expect(order)
			.toEqual(['a=3', 'set returned'])
	}

	it('by a listener that writes and then throws', async () => {
		const graph = createGraph()
		const log: number[] = []
		graph.widget('a').state.n.subscribe(() => {
			graph.widget('b').state.n.set(9)
			throw new Error('listener failed')
		})
		graph.widget('b').state.n.subscribe(value => log.push(value!))

		graph.widget('a').state.n.set(7)
		await settle()

		expect(log)
			.toEqual([9])
		expect(reported)
			.toHaveLength(1)
		expectTopLevelWriteNotifiesAtOnce()
	})

	it('by a nested write whose validation throws', () => {
		const throwing = createWidgetPlugin('throwing')
			.description('Test widget')
			.interfaces<{ state: { n: number } }>()
			.state(state => state.n({
				validate: (input): input is number => {
					if (input === 13)
						throw new Error('validate failed')
					return isNumber(input)
				},
				default: () => 1,
			}))
			.done()
		const blueprint = createWidgetSystem({ plugins: [throwing] })
			.createBlueprint({ id: 't', type: 'throwing' })
		if (blueprint.status !== 'valid')
			throw new Error('fixture setup error: the Blueprint is invalid')
		const runtime = blueprint.createRuntime()
		const root = runtime.getWidget('t')!
		let caught: unknown = null
		root.state.n.subscribe((value) => {
			if (value === 7) {
				try {
					root.state.n.set(13)
				}
				catch (error) {
					caught = error
				}
			}
		})

		root.state.n.set(7)

		expect(caught)
			.toBeInstanceOf(Error)
		expectTopLevelWriteNotifiesAtOnce()
	})

	it('by a listener that writes and then disposes the Runtime, whose write is then not delivered', () => {
		const graph = createGraph()
		const log: string[] = []
		graph.widget('a').state.n.subscribe((value) => {
			log.push(`a=${value}`)
			graph.widget('b').state.n.set(44)
			graph.runtime.dispose()
			log.push('disposed')
		})
		graph.widget('b').state.n.subscribe(value => log.push(`b=${value}`))

		graph.widget('a').state.n.set(7)

		expect(log)
			.toEqual(['a=7', 'disposed'])
		expectTopLevelWriteNotifiesAtOnce()
	})

	it('by a listener that creates and writes a Runtime inside a nested write', () => {
		const graph = createGraph()
		const log: string[] = []
		let created: Graph | null = null
		graph.widget('a').state.n.subscribe(() => {
			graph.widget('b').state.n.set(8)
			created = createGraph()
			created.widget('a').state.n.subscribe(value => log.push(`created a=${value}`))
			created.widget('a').state.n.set(4)
			log.push('created set returned')
		})
		graph.widget('b').state.n.subscribe(value => log.push(`b=${value}`))

		graph.widget('a').state.n.set(7)
		log.push('host returned')

		expect(log)
			.toEqual(['created set returned', 'b=8', 'created a=4', 'host returned'])
		expectTopLevelWriteNotifiesAtOnce()
	})
})
