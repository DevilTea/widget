/**
 * Conformance regressions (issue #199): a Property that depends on a write-free Method must not perturb value
 * propagation to the other Properties downstream of it.
 *
 * A Property may invoke a transitively read-only Method. When alien-signals' own flush re-evaluates such a
 * Property (a subscription effect's dirty check), the flush runs at batch depth `0`, so the invocation's own
 * batch was the outermost one, and closing it re-entered alien-signals' flush while the Property's computed was
 * still mid-evaluation. That nested flush marked the Property's other pending dependents clean with their old
 * values: their subscribers were not notified and `get()` kept returning the old value. It needed a Method
 * whose diagnostic snapshot did not change (a changed snapshot held the flush back) and at least two
 * subscribed Properties at or downstream of the Method's reader. Every test therefore asserts every
 * subscriber and re-pulls every Property with `get()`.
 */

import type { ExecutionResult } from '../index'
import { describe, expect, it } from 'vitest'
import { createWidgetPlugin, createWidgetSystem } from '../index'

interface NodeConfig {
	/** A Property dependency on the `out` of this widget. */
	readonly prev?: string
	/** A Method dependency on the `peek` (or `peekState`) of this widget. */
	readonly method?: string
	readonly viaState?: boolean
	/** `peek` throws when it would return this value; the reading compute catches it and adds 100. */
	readonly throwAt?: number
	/** The State the `setBoth` Method also writes. */
	readonly partner?: string
}

interface NodeInterfaces {
	config: { raw: NodeConfig, resolved: NodeConfig }
	state: { s: number }
	properties: { out: number }
	methods: {
		peek: () => number
		peekState: () => number
		setBoth: (value: number) => number
	}
}

const isNumber = (input: unknown): input is number => typeof input === 'number'

function numberOf(result: ExecutionResult<unknown, unknown> | null): number {
	return result !== null && result.ok && typeof result.value === 'number' ? result.value : 0
}

const nodePlugin = createWidgetPlugin('node')
	.description('Test widget')
	.interfaces<NodeInterfaces>()
	.config({
		description: 'Where the node reads from',
		validate: (input): input is NodeConfig => typeof input === 'object' && input !== null,
		resolve: raw => raw!,
	})
	.state(state => state.s({ validate: isNumber, default: () => 1 }))
	.properties(properties => properties.out({
		registerDeps: ({ dep, config }) => ({
			s: dep.self.state.get('s'),
			prev: dep.widget(config.prev ?? 'absent')
				.optional()
				.properties
				.get('out'),
			peek: dep.widget(config.method ?? 'absent')
				.optional()
				.methods
				.invoke(config.viaState ? 'peekState' : 'peek'),
		}),
		compute: ({ deps, config }) => {
			let sum = numberOf(deps.s()) + numberOf(deps.prev())
			if (config.method !== undefined) {
				try {
					sum += numberOf(deps.peek())
				}
				catch {
					sum += 100
				}
			}
			return sum
		},
	}))
	.methods(methods => methods
		.peek({
			registerDeps: ({ dep }) => ({ out: dep.self.properties.get('out') }),
			validateArgs: (args): args is [] => args.length === 0,
			execute: ({ deps, config }) => {
				const value = numberOf(deps.out())
				if (value === config.throwAt)
					throw new Error('peek failed')
				return value
			},
		})
		.peekState({
			registerDeps: ({ dep }) => ({ s: dep.self.state.get('s') }),
			validateArgs: (args): args is [] => args.length === 0,
			execute: ({ deps }) => numberOf(deps.s()),
		})
		.setBoth({
			registerDeps: ({ dep, config }) => ({
				own: dep.self.state.set('s'),
				partner: dep.widget(config.partner ?? 'absent')
					.optional()
					.state
					.set('s'),
			}),
			validateArgs: (args): args is [number] => isNumber(args[0]),
			execute: ({ args, deps }) => {
				deps.own(args[0])
				deps.partner(args[0] + 1)
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

/**
 * `a`, `m` reading `a` through `a.peek()` (or `a.peekState()`), `t0` reading `m`, `t1` reading `t0`. Every
 * `out` is the widget's own State (1) plus what it reads: initially `a = 1, m = 2, t0 = 3, t1 = 4`.
 */
function createChain(m: NodeConfig = { method: 'a' }, a: NodeConfig = {}, extra: Array<{ id: string, config: NodeConfig }> = []) {
	const runtime = system.createBlueprint({
		id: 'g',
		type: 'graph',
		slots: {
			nodes: [
				{ id: 'a', type: 'node', config: a },
				{ id: 'm', type: 'node', config: m },
				{ id: 't0', type: 'node', config: { prev: 'm' } },
				{ id: 't1', type: 'node', config: { prev: 't0' } },
				...extra.map(({ id, config }) => ({ id, type: 'node', config })),
			],
		},
	})
		.createRuntime()
	const widget = (id: string) => {
		const found = runtime.getWidget(id)
		if (found?.type !== 'node')
			throw new Error(`missing node ${id}`)
		return found
	}
	const notified: string[] = []
	const subscribe = (ids: readonly string[]) => {
		for (const id of ids) {
			widget(id).properties.out.subscribe(result => notified.push(`${id}=${numberOf(result)}`))
		}
	}
	const values = (ids: readonly string[] = ['m', 't0', 't1']) => Object.fromEntries(ids.map(id => [id, numberOf(widget(id).properties.out.get())]))
	return { runtime, widget, notified, subscribe, values }
}

const SUBSCRIPTION_ORDERS: ReadonlyArray<readonly string[]> = [
	['m', 't0', 't1'],
	['t0', 't1'],
	['t1', 't0'],
	['t0'],
	['t1'],
]

describe('a Property depending on a write-free Method', () => {
	for (const order of SUBSCRIPTION_ORDERS) {
		it(`notifies every subscriber and keeps every value fresh when ${order.join(', ')} are subscribed`, () => {
			const { widget, notified, subscribe, values } = createChain()
			subscribe(order)

			widget('a').state.s.set(5)

			const expected: Record<string, number> = { m: 6, t0: 7, t1: 8 }
			expect([...notified].sort())
				.toEqual(order.map(id => `${id}=${expected[id]}`)
					.sort())
			expect(values())
				.toEqual(expected)
		})
	}

	it('keeps the values fresh when nothing is subscribed', () => {
		const { widget, values } = createChain()
		expect(values())
			.toEqual({ m: 2, t0: 3, t1: 4 })

		widget('a').state.s.set(5)

		expect(values())
			.toEqual({ m: 6, t0: 7, t1: 8 })
	})

	it('does the same when the Method reads State directly', () => {
		const { widget, notified, subscribe, values } = createChain({ method: 'a', viaState: true })
		subscribe(['m', 't0', 't1'])

		widget('a').state.s.set(5)

		expect([...notified].sort())
			.toEqual(['m=6', 't0=7', 't1=8'])
		expect(values())
			.toEqual({ m: 6, t0: 7, t1: 8 })
	})

	it('does the same for sibling dependents of the Method\'s reader', () => {
		const { widget, notified, subscribe, values } = createChain({ method: 'a' }, {}, [{ id: 'u0', config: { prev: 'm' } }])
		subscribe(['t0', 'u0'])

		widget('a').state.s.set(5)

		expect([...notified].sort())
			.toEqual(['t0=7', 'u0=7'])
		expect(values(['m', 't0', 'u0']))
			.toEqual({ m: 6, t0: 7, u0: 7 })
	})

	it('does the same when the Method throws and the reading compute catches it', () => {
		const { widget, notified, subscribe, values } = createChain({ method: 'a' }, { throwAt: 5 })
		subscribe(['m', 't0', 't1'])

		widget('a').state.s.set(5)

		expect([...notified].sort())
			.toEqual(['m=101', 't0=102', 't1=103'])
		expect(values())
			.toEqual({ m: 101, t0: 102, t1: 103 })
	})

	it('does the same for the writes of one Method invocation', () => {
		const { widget, notified, subscribe, values } = createChain({ method: 'a' }, { partner: 'z' }, [{ id: 'z', config: {} }])
		subscribe(['m', 't0', 't1'])

		widget('a').methods.setBoth(5)

		expect([...notified].sort())
			.toEqual(['m=6', 't0=7', 't1=8'])
		expect(values())
			.toEqual({ m: 6, t0: 7, t1: 8 })
	})

	it('does the same for resetState()', () => {
		const { runtime, widget, notified, subscribe, values } = createChain()
		widget('a').state.s.set(5)
		subscribe(['m', 't0', 't1'])
		expect(values())
			.toEqual({ m: 6, t0: 7, t1: 8 })

		runtime.resetState()

		expect([...notified].sort())
			.toEqual(['m=2', 't0=3', 't1=4'])
		expect(values())
			.toEqual({ m: 2, t0: 3, t1: 4 })
	})
})
