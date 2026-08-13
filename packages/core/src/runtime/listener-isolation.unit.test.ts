/**
 * Conformance: issue #10 COMMENT 26 §11 (subscriber exception isolation), cross-checked against
 * COMMENT 16/19/20 and consolidated handoff §17-§18.
 *
 * Scope: a synchronous throw from an external subscription listener (`state.subscribe`,
 * `property.subscribe`, `method.subscribeIssues`, `runtime.subscribeCollectedIssues`) must not:
 * - prevent another queued listener on the same propagation from observing it,
 * - change the `ExecutionResult` of the triggering Runtime operation,
 * - become a `RuntimeIssue`,
 * - escape synchronously into the caller.
 *
 * It must surface later through some host error-reporting boundary outside the current reactive
 * flush. Per the matrix, the exact mechanism (`queueMicrotask` in the baseline implementation) is not
 * locked; only the "operation completes synchronously, exception surfaces asynchronously" contract is
 * asserted.
 *
 * A listener must also be untracked (reading another Runtime primitive from inside a listener must not
 * extend the reactive graph), and a rejected Promise returned from a listener must be left unmanaged by
 * core.
 *
 * Only the public entry (`../index`) is imported; no internal module or `blueprintInternals` access.
 */

import type { ExecutionResult } from '../index'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createWidgetPlugin, createWidgetSystem, EMPTY_ISSUES } from '../index'

interface CounterInterfaces {
	state: {
		count: number
		flag: boolean
	}
	properties: {
		doubled: number
	}
	methods: {
		increment: (amount?: number) => number
	}
}

function createCounterPlugin() {
	return createWidgetPlugin('counter')
		.interfaces<CounterInterfaces>()
		.state(section => section
			.count({
				validate: (input): input is number => typeof input === 'number',
				default: () => 0,
			})
			.flag({
				validate: (input): input is boolean => typeof input === 'boolean',
				default: () => false,
			}))
		.properties(section => section
			.doubled({
				registerDeps: ({ dep }) => ({ count: dep.self.state.get('count') }),
				compute: ({ deps }) => {
					const result = deps.count()
					return result.success ? (result.value ?? 0) * 2 : 0
				},
			}))
		.methods(section => section
			.increment({
				registerDeps: ({ dep }) => ({
					count: dep.self.state.get('count'),
					setCount: dep.self.state.set('count'),
				}),
				validateArgs: (args): args is [number?] => args.length <= 1 && (args[0] === undefined || typeof args[0] === 'number'),
				execute: ({ args, deps }) => {
					const current = deps.count()
					const amount = args[0] ?? 1
					const next = (current.success ? current.value ?? 0 : 0) + amount
					deps.setCount(next)
					return next
				},
			}))
		.done()
}

function createRuntime() {
	const plugin = createCounterPlugin()
	const system = createWidgetSystem({ plugins: [plugin] })
	const blueprint = system.createBlueprint({ id: 'root', type: 'counter' })

	if (blueprint.status !== 'valid')
		throw new Error('test fixture: expected a valid blueprint')

	const runtime = blueprint.createRuntime()
	const widget = runtime.getWidget('root')

	if (widget === null)
		throw new Error('test fixture: expected the root widget to resolve')

	return { runtime, widget }
}

/** Casts a `RuntimeMethod` to accept intentionally invalid runtime arguments for negative testing. */
function asUnsafeCallable(method: unknown): (...args: unknown[]) => ExecutionResult<unknown, unknown> {
	return method as (...args: unknown[]) => ExecutionResult<unknown, unknown>
}

/**
 * Waits for two macrotask ticks. A macrotask runs only after every microtask queued before it, so this
 * observes an asynchronously-reported error regardless of whether the implementation reports through a
 * microtask, a task, or another asynchronous seam — without locking the test to any one of them.
 */
async function waitForAsyncReporting(): Promise<void> {
	await new Promise<void>(resolve => setTimeout(resolve, 0))
	await new Promise<void>(resolve => setTimeout(resolve, 0))
}

/**
 * Almost every test in this file deliberately makes an external listener throw, which the baseline
 * implementation reports asynchronously outside the current flush (see module doc). Left unhandled,
 * that later, deferred throw reaches the Node process as an uncaught exception *after* its owning test
 * has already finished, which the test runner would otherwise report as a process-level unhandled
 * error and fail the run despite every assertion having passed. This hook drains that deferred report
 * after every test so it is observed and discarded here instead of leaking into the runner — it is test
 * infrastructure, not part of the behavior under test (that behavior is asserted explicitly in the
 * "surfaces outside the current reactive flush" test below).
 */
function swallowDeferredAsyncExceptions(): void {
	const onUncaughtException = (): void => {}

	beforeEach(() => {
		process.on('uncaughtException', onUncaughtException)
	})

	afterEach(async () => {
		await waitForAsyncReporting()
		process.off('uncaughtException', onUncaughtException)
	})
}

swallowDeferredAsyncExceptions()

describe('external listener throw does not block other listeners on the same propagation', () => {
	it('state.subscribe', () => {
		const { widget } = createRuntime()
		const secondCalls: Array<number | null> = []

		widget.state.count.subscribe(() => {
			throw new Error('first listener boom')
		})
		widget.state.count.subscribe(value => secondCalls.push(value))

		expect(() => widget.state.count.set(5)).not.toThrow()
		expect(secondCalls)
			.toEqual([5])
	})

	it('property.subscribe', () => {
		const { widget } = createRuntime()
		const secondResults: Array<ExecutionResult<number | null, unknown>> = []

		widget.properties.doubled.subscribe(() => {
			throw new Error('first listener boom')
		})
		widget.properties.doubled.subscribe(result => secondResults.push(result))

		expect(() => widget.state.count.set(5)).not.toThrow()
		expect(secondResults)
			.toEqual([{ success: true, value: 10 }])
	})

	it('method.subscribeIssues', () => {
		const { widget } = createRuntime()
		const secondIssueCounts: number[] = []

		widget.methods.increment.subscribeIssues(() => {
			throw new Error('first listener boom')
		})
		widget.methods.increment.subscribeIssues(issues => secondIssueCounts.push(issues.length))

		const invalidIncrement = asUnsafeCallable(widget.methods.increment)
		expect(() => invalidIncrement('not-a-number')).not.toThrow()
		expect(secondIssueCounts)
			.toEqual([1])
	})

	it('runtime.subscribeCollectedIssues', () => {
		const { runtime, widget } = createRuntime()
		const secondSnapshots: number[] = []

		runtime.subscribeCollectedIssues(() => {
			throw new Error('first listener boom')
		})
		runtime.subscribeCollectedIssues(issues => secondSnapshots.push(issues.length))

		expect(() => widget.state.count.set('not-a-number' as unknown as number)).not.toThrow()
		expect(secondSnapshots)
			.toEqual([1])
	})
})

describe('external listener throw does not affect the triggering operation result', () => {
	it('a throwing state.subscribe listener does not change the ExecutionResult of state.set', () => {
		const { widget } = createRuntime()

		widget.state.count.subscribe(() => {
			throw new Error('listener boom')
		})

		const result = widget.state.count.set(9)

		expect(result)
			.toEqual({ success: true, value: 9 })
		expect(widget.state.count.get())
			.toBe(9)
	})

	it('a throwing method.subscribeIssues listener does not change the ExecutionResult of the invocation', () => {
		const { widget } = createRuntime()

		widget.methods.increment.subscribeIssues(() => {
			throw new Error('listener boom')
		})

		const result = widget.methods.increment(4)

		expect(result)
			.toEqual({ success: true, value: 4 })
	})

	it('a throwing property.subscribe listener does not change the ExecutionResult of property.get', () => {
		const { widget } = createRuntime()

		widget.properties.doubled.subscribe(() => {
			throw new Error('listener boom')
		})

		widget.state.count.set(3)

		expect(widget.properties.doubled.get())
			.toEqual({ success: true, value: 6 })
	})
})

describe('external listener throw never becomes a RuntimeIssue', () => {
	it('state issue snapshot stays the canonical EMPTY_ISSUES identity after a successful write with a throwing subscriber', () => {
		const { widget } = createRuntime()

		widget.state.count.subscribe(() => {
			throw new Error('listener boom')
		})

		widget.state.count.set(11)

		expect(widget.state.count.getIssues())
			.toBe(EMPTY_ISSUES)
	})

	it('runtime.getCollectedIssues() does not gain an entry caused by a throwing subscriber', () => {
		const { runtime, widget } = createRuntime()

		runtime.subscribeCollectedIssues(() => {
			throw new Error('listener boom')
		})

		widget.state.count.set(11)

		expect(runtime.getCollectedIssues())
			.toEqual([])
	})
})

describe('external listener throw surfaces outside the current reactive flush', () => {
	it('does not escape synchronously from the triggering operation and is later observable through a host error-reporting boundary', async () => {
		const { widget } = createRuntime()
		const thrown = new Error('listener boom - async surface')
		const captured: unknown[] = []
		const onUncaughtException = (error: unknown): void => {
			captured.push(error)
		}

		widget.state.count.subscribe(() => {
			throw thrown
		})

		process.on('uncaughtException', onUncaughtException)
		try {
			expect(() => widget.state.count.set(21)).not.toThrow()
			// The exception must not have escaped synchronously into `set`'s call stack.
			expect(captured)
				.toHaveLength(0)

			await waitForAsyncReporting()

			expect(captured)
				.toEqual([thrown])
		}
		finally {
			process.off('uncaughtException', onUncaughtException)
		}
	})
})

describe('external listener is untracked', () => {
	it('reading another Runtime primitive from inside a listener does not extend the reactive graph of that subscription', () => {
		const { widget } = createRuntime()
		const calls: Array<number | null> = []

		widget.state.count.subscribe((value) => {
			calls.push(value)
			// Reading `flag` from inside a `count` listener must not make this subscription depend on
			// `flag` — it is untracked observer code, not a semantic callback.
			widget.state.flag.get()
		})

		widget.state.flag.set(true)
		expect(calls)
			.toEqual([])

		widget.state.count.set(1)
		expect(calls)
			.toEqual([1])

		widget.state.flag.set(false)
		expect(calls)
			.toEqual([1])
	})
})

describe('external listener returned Promise is unmanaged', () => {
	it('a listener returning a rejected Promise is not awaited/caught and does not disrupt subsequent listener dispatch or the operation result', () => {
		const { widget } = createRuntime()
		const order: string[] = []

		const rejectingListener = (value: number | null): void => {
			order.push(`first:${String(value)}`)
			const rejected = Promise.reject(new Error('unmanaged rejection'))
			// Test hygiene only: silences this deliberately-unmanaged rejection so it cannot be reported
			// as an unhandled rejection by the test process. This attachment happens in test code, after
			// core has already returned control to the caller below — it is not part of the behavior
			// under test and core never sees or touches this promise.
			rejected.catch(() => {})
			return rejected as unknown as void
		}

		widget.state.count.subscribe(rejectingListener)
		widget.state.count.subscribe(value => order.push(`second:${String(value)}`))

		const result = widget.state.count.set(7)

		expect(result)
			.toEqual({ success: true, value: 7 })
		expect(order)
			.toEqual(['first:7', 'second:7'])
	})
})
