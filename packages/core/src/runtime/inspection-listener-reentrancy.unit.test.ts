/**
 * Conformance: Property inspection listeners are notified once the outermost Runtime operation has finished,
 * still before it returns, never while an evaluation, a dirty check or a flush is in progress (issue #198).
 *
 * A listener that reads or writes the Runtime therefore leaves nothing stale and makes no subscriber miss a
 * notification. The completion is the retained fact (`getSnapshot()`) as soon as it happens; listeners receive
 * each completion's own snapshot, in completion order, after the subscribers, diagnostics listeners and State
 * inspection listeners of the same operation. Deliveries still queued when the Runtime is disposed are dropped,
 * and a listener that keeps changing what it observes is stopped after a bounded number of rounds.
 */

import type { ExecutionResult } from '../index'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createWidgetPlugin, createWidgetSystem } from '../index'
import { inspectRuntime } from '../inspection'

interface LinkConfig { readonly me: string, readonly prev: string | null }

interface LinkInterfaces {
	config: { raw: LinkConfig, resolved: LinkConfig }
	state: { n: number }
	properties: { total: number }
	methods: {
		bump: (by: number) => boolean
		/** Reads `total`, writes `n` + 1, reads `total` again: two completions of `total` in one call. */
		rereadAfterWrite: () => readonly number[]
	}
}

const computing: string[] = []
const isNumber = (input: unknown): input is number => typeof input === 'number'
const numberOf = (result: ExecutionResult<unknown, unknown>): number => (result.ok && typeof result.value === 'number' ? result.value : 0)

const linkPlugin = createWidgetPlugin('link')
	.description('One link of a chain')
	.interfaces<LinkInterfaces>()
	.config({ description: 'The previous link', validate: (input): input is LinkConfig => typeof input === 'object' && input !== null, resolve: raw => raw! })
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
			computing.push(config.me)
			try {
				const n = numberOf(deps.n())
				if (n === 0)
					addDiagnostic({ message: 'n is zero' })
				return numberOf(deps.prev()) + n
			}
			finally {
				computing.pop()
			}
		},
	}))
	.methods(methods => methods
		.bump({
			registerDeps: ({ dep }) => ({ n: dep.self.state.get('n'), set: dep.self.state.set('n') }),
			validateArgs: (args): args is [number] => args.length === 1 && isNumber(args[0]),
			execute: ({ deps, args }) => deps.set(numberOf(deps.n()) + args[0]).ok,
		})
		.rereadAfterWrite({
			registerDeps: ({ dep }) => ({ total: dep.self.properties.get('total'), n: dep.self.state.get('n'), set: dep.self.state.set('n') }),
			validateArgs: (args): args is [] => args.length === 0,
			execute: ({ deps }) => {
				const before = numberOf(deps.total())
				deps.set(numberOf(deps.n()) + 1)
				return [before, numberOf(deps.total())]
			},
		}))
	.done()
const listPlugin = createWidgetPlugin('list')
	.description('A list')
	.interfaces<{ slots: 'items' }>()
	.slots({ items: { description: 'Links' } })
	.done()
const system = createWidgetSystem({ plugins: [linkPlugin, listPlugin] })

function createChain(length = 10) {
	const items = Array.from({ length }, (_, i) => ({ id: `l${i}`, type: 'link' as const, config: { me: `l${i}`, prev: i > 0 ? `l${i - 1}` : null } }))
	const blueprint = system.createBlueprint({ id: 'root', type: 'list', slots: { items } })
	if (blueprint.status !== 'valid')
		throw new Error('expected a valid Blueprint')
	const runtime = blueprint.createRuntime()
	const link = (i: number) => {
		const widget = runtime.getWidget(`l${i}`)
		if (widget?.type !== 'link')
			throw new Error('expected a link')
		return widget
	}
	const inspection = inspectRuntime(runtime)
	const widgetInspection = (i: number) => {
		const entry = inspection.blueprint.nodes.find(node => node.resolved && node.node.id === `l${i}`)!
		return inspection.getWidget(entry.nodeId)!
	}
	const inspect = (i: number) => widgetInspection(i)
		.getProperty('total')!
	const inspectState = (i: number) => widgetInspection(i)
		.getState('n')!
	const fresh = () => {
		const reference = blueprint.createRuntime({ overrideStateDefaults: runtime.snapshotState() })
		return (i: number) => {
			const widget = reference.getWidget(`l${i}`)
			if (widget?.type !== 'link')
				throw new Error('expected a link')
			return widget
		}
	}
	return { runtime, link, inspect, inspectState, fresh, length }
}

function staleLinks(chain: ReturnType<typeof createChain>): string[] {
	const reference = chain.fresh()
	const stale: string[] = []
	for (let i = 0; i < chain.length; i++) {
		const own = chain.link(i).properties.total.get()
		const truth = reference(i).properties.total.get()
		if (JSON.stringify(own) !== JSON.stringify(truth))
			stale.push(`l${i}`)
	}
	return stale
}

function valueOf(snapshot: { status: string, result?: ExecutionResult<unknown, unknown> }): unknown {
	return snapshot.result === undefined ? snapshot.status : snapshot.result.ok ? snapshot.result.value : 'failed'
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

describe('a Property inspection listener that reads another live Property (the issue #198 reproduction)', () => {
	for (const [label, warm] of [
		['every link read first', (chain: ReturnType<typeof createChain>) => {
			for (let i = 0; i < 10; i++) chain.link(i).properties.total.get()
		}],
		['only l9 read first', (chain: ReturnType<typeof createChain>) => {
			chain.link(9).properties.total.get()
		}],
		['nothing read first', () => {}],
	] as const) {
		it(`reads the current value and leaves nothing stale (${label})`, () => {
			const chain = createChain()
			warm(chain)
			const seen: unknown[] = []
			const unsubscribe = chain.inspect(5)
				.subscribe(() => {
					seen.push({ value: numberOf(chain.link(9).properties.total.get()), computing: [...computing] })
				})
			chain.link(6).properties.total.get()
			chain.link(0).state.n.set(5)
			chain.link(8).properties.total.get()
			unsubscribe()

			expect(chain.link(9).properties.total.get())
				.toEqual({ ok: true, value: 14 })
			expect(seen.at(-1))
				.toEqual({ value: 14, computing: [] })
			expect(staleLinks(chain))
				.toEqual([])
		})
	}
})

describe('a Property inspection listener that writes during a write\'s flush', () => {
	for (const how of ['set', 'method'] as const) {
		it(`makes no subscriber miss its last value (${how})`, () => {
			const chain = createChain()
			for (let i = 0; i < 10; i++) chain.link(i).properties.total.get()
			const last: Record<number, unknown> = {}
			const subscriptions = [8, 9].map(i => chain.link(i).properties.total.subscribe((result) => {
				last[i] = numberOf(result)
			}))
			let fired = false
			chain.inspect(5)
				.subscribe(() => {
					if (fired)
						return
					fired = true
					if (how === 'set')
						chain.link(0).state.n.set(6)
					else
						chain.link(0).methods.bump(1)
				})
			chain.link(0).state.n.set(5)

			expect(last)
				.toEqual({ 8: 14, 9: 15 })
			for (const unsubscribe of subscriptions) unsubscribe()
			expect(staleLinks(chain))
				.toEqual([])
		})
	}

	it('of a subscribed Property, whose completion its subscription published, makes that subscriber get the value written', () => {
		const chain = createChain()
		const last: number[] = []
		chain.link(9).properties.total.subscribe(result => last.push(numberOf(result)))
		let fired = false
		chain.inspect(9)
			.subscribe(() => {
				if (fired)
					return
				fired = true
				chain.link(0).state.n.set(6)
			})
		chain.link(0).state.n.set(5)

		expect(last)
			.toEqual([14, 15])
	})
})

describe('delivery timing', () => {
	it('runs after the outermost read has finished every evaluation, before it returns, and in completion order', () => {
		const chain = createChain()
		const order: string[] = []
		for (const i of [3, 7, 9]) {
			chain.inspect(i)
				.subscribe(snapshot => order.push(`l${i}=${valueOf(snapshot)} [${computing.join(',')}]`))
		}
		order.push(`get l9 = ${numberOf(chain.link(9).properties.total.get())}`)

		expect(order)
			.toEqual(['l3=4 []', 'l7=8 []', 'l9=10 []', 'get l9 = 10'])
	})

	it('runs after the subscribers, the diagnostics listeners and the State inspection listener of the same write, before it returns', () => {
		const chain = createChain()
		for (let i = 0; i < 10; i++) chain.link(i).properties.total.get()
		const order: string[] = []
		chain.link(9).properties.total.subscribe(result => order.push(`subscriber l9=${numberOf(result)}`))
		chain.link(0).state.n.subscribe(value => order.push(`subscriber l0.n=${value}`))
		chain.link(0).properties.total.subscribeDiagnostics(diagnostics => order.push(`diagnostics l0=${diagnostics.length}`))
		chain.inspectState(0)
			.subscribe(snapshot => order.push(`inspection l0.n=${snapshot.value}`))
		for (const i of [9, 0]) {
			chain.inspect(i)
				.subscribe(snapshot => order.push(`inspection l${i}=${valueOf(snapshot)}`))
		}
		chain.link(0).state.n.set(0)
		order.push('set returned')

		expect(order)
			.toEqual([
				'subscriber l9=0',
				'subscriber l0.n=0',
				'diagnostics l0=1',
				'inspection l0.n=0',
				'inspection l0=failed',
				'inspection l9=failed',
				'set returned',
			])
	})

	it('skips a listener unsubscribed before the delivery and gives a listener subscribed meanwhile only later completions', () => {
		const chain = createChain()
		const calls: string[] = []
		let subscribedLate = false
		const unsubscribeEarly = chain.inspect(7)
			.subscribe(() => calls.push('early l7'))
		chain.inspect(3)
			.subscribe(() => {
				calls.push('l3')
				unsubscribeEarly()
				if (!subscribedLate) {
					subscribedLate = true
					chain.inspect(7)
						.subscribe(() => calls.push('late l7'))
				}
			})
		// l3 and l7 both complete during this read; l3's delivery runs first, after l7 had completed.
		chain.link(9).properties.total.get()
		chain.link(0).state.n.set(2)
		chain.link(9).properties.total.get()

		expect(calls)
			.toEqual(['l3', 'l3', 'late l7'])
	})

	it('commits the completion as the retained fact at once; two completions in one call are delivered one by one, each with its own snapshot', () => {
		const chain = createChain()
		const total = chain.inspect(0)
		const seen: unknown[] = []
		total.subscribe(snapshot => seen.push({ delivered: valueOf(snapshot), current: valueOf(total.getSnapshot()) }))

		expect(chain.link(0).methods.rereadAfterWrite())
			.toEqual({ ok: true, value: [1, 2] })
		expect(seen)
			.toEqual([{ delivered: 1, current: 2 }, { delivered: 2, current: 2 }])
	})

	it('drops the deliveries still queued when the Runtime is disposed in the same call; the retained fact stays readable', () => {
		const chain = createChain()
		for (let i = 0; i < 10; i++) chain.link(i).properties.total.get()
		const delivered: unknown[] = []
		chain.inspect(5)
			.subscribe(snapshot => delivered.push(valueOf(snapshot)))
		chain.link(9).properties.total.subscribe(() => chain.runtime.dispose())
		chain.link(0).state.n.set(5)

		expect(chain.runtime.isDisposed)
			.toBe(true)
		expect(delivered)
			.toEqual([])
		expect(valueOf(chain.inspect(5)
			.getSnapshot()))
			.toBe(10)
	})
})

describe('a feedback loop', () => {
	it('of a listener that keeps writing what its own Property depends on ends after a bounded number of rounds and is reported', async () => {
		const chain = createChain(3)
		// The subscription makes every write evaluate l1 again, so each write completes l1 again.
		chain.link(2).properties.total.subscribe(() => {})
		let calls = 0
		chain.inspect(1)
			.subscribe(() => {
				calls++
				chain.link(0).state.n.set(calls + 1)
			})
		chain.link(0).state.n.set(100)
		await new Promise<void>(resolve => setTimeout(resolve, 0))

		expect(calls)
			.toBeGreaterThan(1)
		expect(calls)
			.toBeLessThan(1_000)
		expect(reported)
			.toHaveLength(1)
		expect(reported[0])
			.toBeInstanceOf(RangeError)
	})
})
