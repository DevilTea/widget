/**
 * Conformance: a Property `compute` that throws while a subscription re-evaluates it is isolated exactly
 * like a throwing external listener (Discussion #12 C0R16/C0R20: observers never block unrelated
 * observers or the operation that triggered them).
 *
 * - the write that triggered the re-evaluation (`RuntimeState.set`, a Method invocation, `resetState`)
 *   returns its normal `ExecutionResult`;
 * - every other subscriber is notified exactly as if the throwing Property had no subscriber, for that
 *   write and every later one, whatever the subscription order;
 * - the exception surfaces later through the host error-reporting boundary, outside the flush;
 * - the throwing Property's own subscriber skips that run and resumes on the next completed recompute;
 * - direct pulls (`get()`, a dependency read) still throw the plugin's exception synchronously.
 */

import type { ExecutionResult } from '../index'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createWidgetPlugin, createWidgetSystem } from '../index'

interface HostInterfaces {
	state: {
		n: number
	}
	properties: {
		a: number
		boom: number
		c: number
		downstream: number
	}
	methods: {
		setN: (next: number) => number
	}
}

const BOOM = 13

function numberOf(result: ExecutionResult<number | null, unknown>): number {
	return result.ok ? result.value ?? 0 : 0
}

function createHarness(initial?: number) {
	const plugin = createWidgetPlugin('host')
		.description('Test widget')
		.interfaces<HostInterfaces>()
		.state(state => state.n({
			validate: (input): input is number => typeof input === 'number',
			default: () => 0,
		}))
		.properties(properties => properties
			.a({
				registerDeps: ({ dep }) => ({ n: dep.self.state.get('n') }),
				compute: ({ deps }) => numberOf(deps.n()) * 10,
			})
			.boom({
				registerDeps: ({ dep }) => ({ n: dep.self.state.get('n') }),
				compute: ({ deps }) => {
					const value = numberOf(deps.n())
					if (value === BOOM)
						throw new Error(`boom at ${value}`)
					return value
				},
			})
			.c({
				registerDeps: ({ dep }) => ({ n: dep.self.state.get('n') }),
				compute: ({ deps }) => numberOf(deps.n()) * 100,
			})
			.downstream({
				registerDeps: ({ dep }) => ({ boom: dep.self.properties.get('boom') }),
				compute: ({ deps }) => {
					const boom = deps.boom()
					return boom.ok ? (boom.value ?? 0) + 1 : -1
				},
			}))
		.methods(methods => methods.setN({
			registerDeps: ({ dep }) => ({ setN: dep.self.state.set('n') }),
			validateArgs: (args): args is [number] => typeof args[0] === 'number',
			execute: ({ args, deps }) => {
				deps.setN(args[0])
				return args[0]
			},
		}))
		.done()

	const blueprint = createWidgetSystem({ plugins: [plugin] })
		.createBlueprint({ id: 'host', type: 'host' })
	if (blueprint.status !== 'valid')
		throw new Error('expected a valid Blueprint')
	const runtime = blueprint.createRuntime(initial === undefined ? undefined : { overrideStateDefaults: { host: { n: initial } } })
	const widget = runtime.getWidget('host')!
	return { runtime, widget }
}

type Harness = ReturnType<typeof createHarness>
type Subscription = 'a' | 'boom' | 'c' | 'state'

function subscribeAll(harness: Harness, order: readonly Subscription[]) {
	const log: Array<readonly [Subscription, unknown]> = []
	const { widget } = harness
	const subscribe = {
		a: () => widget.properties.a.subscribe(result => log.push(['a', result.ok ? result.value : 'failed'])),
		boom: () => widget.properties.boom.subscribe(result => log.push(['boom', result.ok ? result.value : 'failed'])),
		c: () => widget.properties.c.subscribe(result => log.push(['c', result.ok ? result.value : 'failed'])),
		state: () => widget.state.n.subscribe(value => log.push(['state', value])),
	}
	for (const name of order)
		subscribe[name]()
	return log
}

/** Waits until every exception reported outside the flush (microtask or later) has surfaced. */
async function waitForAsyncReporting(): Promise<void> {
	await new Promise<void>(resolve => setTimeout(resolve, 0))
	await new Promise<void>(resolve => setTimeout(resolve, 0))
}

let reported: unknown[] = []
function onUncaughtException(error: unknown): void {
	reported.push(error)
}

beforeEach(() => {
	reported = []
	process.on('uncaughtException', onUncaughtException)
})

afterEach(async () => {
	await waitForAsyncReporting()
	process.off('uncaughtException', onUncaughtException)
})

function messagesOf(errors: readonly unknown[]): string[] {
	return errors.map(error => (error as Error).message)
}

describe('a throwing compute under subscription does not break the writer', () => {
	it('state.set returns its ExecutionResult', () => {
		const harness = createHarness()
		subscribeAll(harness, ['boom'])

		expect(harness.widget.state.n.set(BOOM))
			.toEqual({ ok: true, value: BOOM })
		expect(harness.widget.state.n.get())
			.toBe(BOOM)
	})

	it('a Method invocation returns its ExecutionResult', () => {
		const harness = createHarness()
		subscribeAll(harness, ['boom'])

		expect(harness.widget.methods.setN(BOOM))
			.toEqual({ ok: true, value: BOOM })
	})

	it('resetState returns normally', () => {
		const harness = createHarness(BOOM)
		harness.widget.state.n.set(1)
		subscribeAll(harness, ['boom'])

		expect(() => harness.runtime.resetState()).not.toThrow()
		expect(harness.widget.state.n.get())
			.toBe(BOOM)
	})
})

describe('a throwing compute under subscription does not affect other subscribers', () => {
	function expectedWithoutBoom(): Array<Array<readonly [Subscription, unknown]>> {
		const harness = createHarness()
		const log = subscribeAll(harness, ['a', 'c', 'state'])
		const rounds: Array<Array<readonly [Subscription, unknown]>> = []
		for (const next of [BOOM, 14, 15]) {
			log.length = 0
			harness.widget.state.n.set(next)
			rounds.push([...log])
		}
		return rounds
	}

	for (const order of [['boom', 'a', 'c', 'state'], ['a', 'c', 'state', 'boom'], ['a', 'boom', 'c', 'state']] as const) {
		it(`notifies every other subscriber for this write and later writes (order: ${order.join(', ')})`, () => {
			const expected = expectedWithoutBoom()
			const harness = createHarness()
			const log = subscribeAll(harness, order)

			const rounds: Array<Array<readonly [Subscription, unknown]>> = []
			for (const next of [BOOM, 14, 15]) {
				log.length = 0
				harness.widget.state.n.set(next)
				rounds.push(log.filter(([name]) => name !== 'boom'))
			}

			expect(rounds)
				.toEqual(expected)
		})
	}

	it('keeps notifying other subscribers when the write is a Method invocation', () => {
		const harness = createHarness()
		const log = subscribeAll(harness, ['boom', 'a', 'state'])

		harness.widget.methods.setN(BOOM)

		expect(log)
			.toEqual([['a', 130], ['state', BOOM]])

		log.length = 0
		harness.widget.methods.setN(14)

		expect(log)
			.toEqual([['boom', 14], ['a', 140], ['state', 14]])
	})
})

describe('the compute exception is reported outside the flush', () => {
	it('surfaces the plugin exception asynchronously, never synchronously into the writer', async () => {
		const harness = createHarness()
		subscribeAll(harness, ['boom'])

		harness.widget.state.n.set(BOOM)

		expect(reported)
			.toEqual([])

		await waitForAsyncReporting()

		expect(messagesOf(reported))
			.toEqual([`boom at ${BOOM}`])
	})

	it('skips the throwing Property\'s own subscriber for that run and resumes on the next completed recompute', () => {
		const harness = createHarness()
		const log = subscribeAll(harness, ['boom'])

		harness.widget.state.n.set(BOOM)

		expect(log)
			.toEqual([])

		harness.widget.state.n.set(14)
		harness.widget.state.n.set(15)

		expect(log)
			.toEqual([['boom', 14], ['boom', 15]])
	})

	it('isolates a subscription whose first evaluation throws and notifies it on the next completed recompute', async () => {
		const harness = createHarness(BOOM)
		const results: Array<ExecutionResult<number | null, unknown>> = []

		let unsubscribe: (() => void) | undefined
		expect(() => {
			unsubscribe = harness.widget.properties.boom.subscribe(result => results.push(result))
		}).not.toThrow()

		await waitForAsyncReporting()

		expect(messagesOf(reported))
			.toEqual([`boom at ${BOOM}`])

		harness.widget.state.n.set(1)

		expect(results)
			.toEqual([{ ok: true, value: 1 }])

		unsubscribe!()
		harness.widget.state.n.set(2)

		expect(results)
			.toHaveLength(1)
	})
})

describe('direct pulls still throw synchronously', () => {
	it('property.get() throws the plugin exception on every pull until a recompute completes', () => {
		const harness = createHarness(BOOM)

		expect(() => harness.widget.properties.boom.get())
			.toThrow(`boom at ${BOOM}`)
		expect(() => harness.widget.properties.boom.get())
			.toThrow(`boom at ${BOOM}`)

		harness.widget.state.n.set(1)

		expect(harness.widget.properties.boom.get())
			.toEqual({ ok: true, value: 1 })

		harness.widget.state.n.set(BOOM)

		expect(() => harness.widget.properties.boom.get())
			.toThrow(`boom at ${BOOM}`)
		expect(() => harness.widget.properties.boom.get())
			.toThrow(`boom at ${BOOM}`)
	})

	it('a dependency read of the throwing Property throws synchronously inside the consumer', () => {
		const harness = createHarness()
		harness.widget.state.n.set(BOOM)

		expect(() => harness.widget.properties.downstream.get())
			.toThrow(`boom at ${BOOM}`)

		harness.widget.state.n.set(2)

		expect(harness.widget.properties.downstream.get())
			.toEqual({ ok: true, value: 3 })
	})

	it('pulls the same exception while a subscriber is attached', () => {
		const harness = createHarness()
		subscribeAll(harness, ['boom'])
		harness.widget.state.n.set(BOOM)

		expect(() => harness.widget.properties.boom.get())
			.toThrow(`boom at ${BOOM}`)
	})
})
