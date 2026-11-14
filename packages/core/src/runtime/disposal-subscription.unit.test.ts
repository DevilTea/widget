/**
 * Conformance coverage for `WidgetSystemRuntime.subscribeDisposal()`.
 *
 * Scope: each listener runs exactly once, synchronously, inside the first `dispose()` call and with no
 * arguments; by then the Runtime is fully disposed (`isDisposed`, every owned subscription torn down, the
 * post-dispose error surface in force); listeners run in subscription order from a list snapshotted when
 * delivery starts; a throwing listener is isolated like every other external listener and reported
 * asynchronously; subscribing to a disposed Runtime throws; unsubscribe is idempotent and a no-op once the
 * listener has run; the Runtime keeps no reference to a listener that has run.
 *
 * Only the public entry (`../index`) is imported.
 */

import type { WidgetInterfaces } from '../index'
import { afterEach, beforeEach, describe, expect, expectTypeOf, it, vi } from 'vitest'
import { createWidgetPlugin, createWidgetSystem, WidgetSystemRuntimeDisposedError } from '../index'

interface CounterInterfaces extends WidgetInterfaces {
	state: {
		count: number
	}
	properties: {
		doubled: number
	}
	methods: {
		increment: (amount?: number) => number
		bump: () => void
	}
	events: {
		bumped: []
	}
}

function createCounterPlugin() {
	return createWidgetPlugin('counter')
		.description('Test widget')
		.interfaces<CounterInterfaces>()
		.state(section => section
			.count({
				validate: (input): input is number => typeof input === 'number',
				default: () => 0,
			}))
		.properties(section => section
			.doubled({
				registerDeps: ({ dep }) => ({ count: dep.self.state.get('count') }),
				compute: ({ deps }) => {
					const result = deps.count()
					return result.ok ? (result.value ?? 0) * 2 : 0
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
					const next = (current.ok ? current.value ?? 0 : 0) + (args[0] ?? 1)
					deps.setCount(next)
					return next
				},
			})
			.bump({
				registerDeps: ({ dep }) => ({ setCount: dep.self.state.set('count') }),
				validateArgs: (args): args is [] => args.length === 0,
				emits: ['bumped'],
				execute: ({ deps, emit }) => {
					deps.setCount(1)
					emit.bumped()
				},
			}))
		.events(events => events
			.bumped({ description: 'Emitted by bump' }))
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

	return { blueprint, runtime, widget }
}

/** Waits for two macrotask ticks, so an asynchronously reported exception has surfaced whichever seam carried it. */
async function waitForAsyncReporting(): Promise<void> {
	await new Promise<void>(resolve => setTimeout(resolve, 0))
	await new Promise<void>(resolve => setTimeout(resolve, 0))
}

/** Collects the exceptions the host's error boundary receives (the asynchronous reporting path). */
function collectReportedExceptions(): unknown[] {
	const collected: unknown[] = []
	const onUncaughtException = (thrown: unknown): void => {
		collected.push(thrown)
	}

	beforeEach(() => {
		collected.length = 0
		process.on('uncaughtException', onUncaughtException)
	})

	afterEach(async () => {
		await waitForAsyncReporting()
		process.off('uncaughtException', onUncaughtException)
	})

	return collected
}

const reported = collectReportedExceptions()

/** Runs `operation` and returns whether it threw the disposed error, `false` when it threw anything else. */
function throwsDisposedError(operation: () => unknown): boolean | 'returned' {
	try {
		operation()
		return 'returned'
	}
	catch (error) {
		return error instanceof WidgetSystemRuntimeDisposedError
	}
}

describe('runtime.subscribeDisposal(): delivery', () => {
	it('has the documented type', () => {
		const { runtime } = createRuntime()

		expectTypeOf(runtime.subscribeDisposal)
			.toEqualTypeOf<(listener: () => void) => () => void>()
	})

	it('runs the listener synchronously inside the first dispose() call, with no arguments', () => {
		const { runtime } = createRuntime()
		const received: unknown[][] = []
		runtime.subscribeDisposal((...args: unknown[]) => {
			received.push(args)
		})

		expect(received)
			.toEqual([])

		runtime.dispose()

		expect(received)
			.toEqual([[]])
	})

	it('does not run before dispose()', () => {
		const { runtime } = createRuntime()
		const listener = vi.fn()

		runtime.subscribeDisposal(listener)

		expect(listener)
			.not
			.toHaveBeenCalled()
	})

	it('runs each listener exactly once across repeated dispose() calls', () => {
		const { runtime } = createRuntime()
		const listener = vi.fn()
		runtime.subscribeDisposal(listener)

		runtime.dispose()
		runtime.dispose()
		runtime.dispose()

		expect(listener)
			.toHaveBeenCalledTimes(1)
	})

	it('runs listeners in subscription order', () => {
		const { runtime } = createRuntime()
		const order: string[] = []
		runtime.subscribeDisposal(() => order.push('a'))
		runtime.subscribeDisposal(() => order.push('b'))
		runtime.subscribeDisposal(() => order.push('c'))

		runtime.dispose()

		expect(order)
			.toEqual(['a', 'b', 'c'])
	})

	it('keeps duplicate registrations of one function and their unsubscribe handles independent', () => {
		const { runtime } = createRuntime()
		const listener = vi.fn()
		const unsubscribeFirst = runtime.subscribeDisposal(listener)
		runtime.subscribeDisposal(listener)

		unsubscribeFirst()
		runtime.dispose()

		expect(listener)
			.toHaveBeenCalledTimes(1)

		const second = createRuntime()
		const twice = vi.fn()
		second.runtime.subscribeDisposal(twice)
		second.runtime.subscribeDisposal(twice)
		second.runtime.dispose()

		expect(twice)
			.toHaveBeenCalledTimes(2)
	})

	it('keeps dispose() idempotent when no listener is registered', () => {
		const { runtime } = createRuntime()

		expect(() => runtime.dispose())
			.not
			.toThrow()
		expect(() => runtime.dispose())
			.not
			.toThrow()
		expect(runtime.isDisposed)
			.toBe(true)
	})
})

describe('runtime.subscribeDisposal(): the Runtime is already disposed inside a listener', () => {
	it('reports isDisposed and throws the disposed error for every live operation and new subscription', () => {
		const { runtime, widget } = createRuntime()
		const outcomes: Record<string, unknown> = {}
		runtime.subscribeDisposal(() => {
			outcomes.isDisposed = runtime.isDisposed
			outcomes.getWidget = throwsDisposedError(() => runtime.getWidget('root'))
			outcomes.snapshotState = throwsDisposedError(() => runtime.snapshotState())
			outcomes.resetState = throwsDisposedError(() => runtime.resetState())
			outcomes.getDiagnostics = throwsDisposedError(() => runtime.getDiagnostics())
			outcomes.stateGet = throwsDisposedError(() => widget.state.count.get())
			outcomes.stateSet = throwsDisposedError(() => widget.state.count.set(1))
			outcomes.propertyGet = throwsDisposedError(() => widget.properties.doubled.get())
			outcomes.method = throwsDisposedError(() => widget.methods.increment())
			outcomes.subscribeDiagnostics = throwsDisposedError(() => runtime.subscribeDiagnostics(() => {}))
			outcomes.stateSubscribe = throwsDisposedError(() => widget.state.count.subscribe(() => {}))
			outcomes.eventSubscribe = throwsDisposedError(() => widget.events.bumped.subscribe(() => {}))
			outcomes.subscribeDisposal = throwsDisposedError(() => runtime.subscribeDisposal(() => {}))
		})

		runtime.dispose()

		expect(outcomes)
			.toEqual({
				isDisposed: true,
				getWidget: true,
				snapshotState: true,
				resetState: true,
				getDiagnostics: true,
				stateGet: true,
				stateSet: true,
				propertyGet: true,
				method: true,
				subscribeDiagnostics: true,
				stateSubscribe: true,
				eventSubscribe: true,
				subscribeDisposal: true,
			})
	})

	it('keeps the immutable metadata readable', () => {
		const { blueprint, runtime, widget } = createRuntime()
		let seen: unknown
		runtime.subscribeDisposal(() => {
			seen = {
				blueprint: runtime.blueprint === blueprint,
				id: widget.id,
				type: widget.type,
				blueprintNode: widget.blueprintNode === blueprint.getWidget('root'),
			}
		})

		runtime.dispose()

		expect(seen)
			.toEqual({ blueprint: true, id: 'root', type: 'counter', blueprintNode: true })
	})

	it('treats dispose() called from a listener as a no-op', () => {
		const { runtime } = createRuntime()
		const order: string[] = []
		runtime.subscribeDisposal(() => {
			order.push('first')
			runtime.dispose()
		})
		runtime.subscribeDisposal(() => order.push('second'))

		expect(() => runtime.dispose())
			.not
			.toThrow()

		expect(order)
			.toEqual(['first', 'second'])
		expect(reported)
			.toEqual([])
	})

	it('has already torn down every Runtime-owned subscription', () => {
		const { runtime, widget } = createRuntime()
		const stateValues: unknown[] = []
		const diagnosticsCounts: number[] = []
		const bumps = vi.fn()
		widget.state.count.subscribe(value => stateValues.push(value))
		runtime.subscribeDiagnostics(diagnostics => diagnosticsCounts.push(diagnostics.length))
		widget.events.bumped.subscribe(bumps)
		let writeRefused: unknown
		runtime.subscribeDisposal(() => {
			// A live write could notify the subscriptions above; it is refused instead.
			writeRefused = throwsDisposedError(() => widget.state.count.set(5))
		})

		runtime.dispose()

		expect(writeRefused)
			.toBe(true)
		expect(stateValues)
			.toEqual([])
		expect(diagnosticsCounts)
			.toEqual([])
		expect(bumps)
			.not
			.toHaveBeenCalled()
	})

	it('refuses retained dependency and emit callables of a Method inside a disposal listener', () => {
		// The callables were handed to a Method that has returned; once the Runtime is disposed they throw the
		// disposed error whatever the callback scope says, so this checks the post-dispose surface only.
		const captured: { deps?: { setCount: (value: number) => unknown }, emit?: { done: () => void } } = {}
		const plugin = createWidgetPlugin('host')
			.description('Test widget')
			.interfaces<{ state: { count: number }, methods: { run: () => void }, events: { done: [] } }>()
			.state(section => section
				.count({
					validate: (input): input is number => typeof input === 'number',
					default: () => 0,
				}))
			.methods(section => section
				.run({
					registerDeps: ({ dep }) => ({ setCount: dep.self.state.set('count') }),
					validateArgs: (args): args is [] => args.length === 0,
					emits: ['done'],
					execute: ({ deps, emit }) => {
						captured.deps = deps
						captured.emit = emit
					},
				}))
			.events(events => events
				.done({ description: 'Done' }))
			.done()
		const blueprint = createWidgetSystem({ plugins: [plugin] })
			.createBlueprint({ id: 'root', type: 'host' })
		if (blueprint.status !== 'valid')
			throw new Error('test fixture: expected a valid blueprint')
		const runtime = blueprint.createRuntime()
		runtime.getWidget('root')!.methods.run()

		const outcomes: unknown[] = []
		runtime.subscribeDisposal(() => {
			outcomes.push(throwsDisposedError(() => captured.deps!.setCount(1)))
			outcomes.push(throwsDisposedError(() => captured.emit!.done()))
		})
		runtime.dispose()

		expect(outcomes)
			.toEqual([true, true])
	})
})

describe('runtime.subscribeDisposal(): membership changes during delivery', () => {
	it('refuses a listener added during delivery, because the Runtime is already disposed', () => {
		const { runtime } = createRuntime()
		const late = vi.fn()
		let addRefused: unknown
		runtime.subscribeDisposal(() => {
			addRefused = throwsDisposedError(() => runtime.subscribeDisposal(late))
		})

		runtime.dispose()
		runtime.dispose()

		expect(addRefused)
			.toBe(true)
		expect(late)
			.not
			.toHaveBeenCalled()
	})

	it('snapshots the list at delivery start: a listener removed during delivery still runs', () => {
		const { runtime } = createRuntime()
		const order: string[] = []
		let unsubscribeB: () => void = () => {}
		runtime.subscribeDisposal(() => {
			order.push('a')
			unsubscribeB()
		})
		unsubscribeB = runtime.subscribeDisposal(() => order.push('b'))
		runtime.subscribeDisposal(() => order.push('c'))

		runtime.dispose()

		expect(order)
			.toEqual(['a', 'b', 'c'])
	})
})

describe('runtime.subscribeDisposal(): listener exceptions', () => {
	it('never reaches the dispose() caller, never stops the remaining listeners, and is reported asynchronously', async () => {
		const { runtime } = createRuntime()
		const error = new Error('disposal listener failed')
		const order: string[] = []
		runtime.subscribeDisposal(() => {
			order.push('first')
			throw error
		})
		runtime.subscribeDisposal(() => order.push('second'))

		expect(() => runtime.dispose())
			.not
			.toThrow()

		expect(order)
			.toEqual(['first', 'second'])
		expect(runtime.isDisposed)
			.toBe(true)
		// Reported outside the dispose() call, like every other isolated listener exception.
		expect(reported)
			.toEqual([])

		await waitForAsyncReporting()

		expect(reported)
			.toEqual([error])
	})

	it('reports each failing listener, in order', async () => {
		const { runtime } = createRuntime()
		const first = new Error('first')
		const second = new Error('second')
		runtime.subscribeDisposal(() => {
			throw first
		})
		runtime.subscribeDisposal(() => {
			throw second
		})

		runtime.dispose()
		await waitForAsyncReporting()

		expect(reported)
			.toEqual([first, second])
	})

	it('isolates a thrown non-Error value', async () => {
		const { runtime } = createRuntime()
		runtime.subscribeDisposal(() => {
			// eslint-disable-next-line no-throw-literal
			throw 'plain string'
		})

		expect(() => runtime.dispose())
			.not
			.toThrow()
		await waitForAsyncReporting()

		expect(reported)
			.toEqual(['plain string'])
	})

	it('isolates and reports a disposed error a listener lets escape', async () => {
		const { runtime } = createRuntime()
		runtime.subscribeDisposal(() => {
			runtime.snapshotState()
		})

		expect(() => runtime.dispose())
			.not
			.toThrow()
		await waitForAsyncReporting()

		expect(reported)
			.toHaveLength(1)
		expect(reported[0])
			.toBeInstanceOf(WidgetSystemRuntimeDisposedError)
	})
})

describe('runtime.subscribeDisposal(): subscribing', () => {
	it('throws the disposed error on an already disposed Runtime, without invoking the listener', () => {
		const { runtime } = createRuntime()
		const listener = vi.fn()
		runtime.dispose()

		expect(() => runtime.subscribeDisposal(listener))
			.toThrow(WidgetSystemRuntimeDisposedError)
		expect(listener)
			.not
			.toHaveBeenCalled()
	})

	it('accepts a non-function like subscribeDiagnostics does: no throw at subscription, the failure is reported when it would run', async () => {
		const { runtime } = createRuntime()

		expect(() => runtime.subscribeDiagnostics(undefined as unknown as () => void))
			.not
			.toThrow()
		expect(() => runtime.subscribeDisposal(undefined as unknown as () => void))
			.not
			.toThrow()
		const after = vi.fn()
		runtime.subscribeDisposal(after)

		expect(() => runtime.dispose())
			.not
			.toThrow()
		expect(after)
			.toHaveBeenCalledTimes(1)
		await waitForAsyncReporting()

		expect(reported)
			.toHaveLength(1)
		expect(reported[0])
			.toBeInstanceOf(TypeError)
	})
})

describe('runtime.subscribeDisposal(): unsubscribe', () => {
	it('before disposal prevents the call', () => {
		const { runtime } = createRuntime()
		const removed = vi.fn()
		const kept = vi.fn()
		const unsubscribe = runtime.subscribeDisposal(removed)
		runtime.subscribeDisposal(kept)

		unsubscribe()
		runtime.dispose()

		expect(removed)
			.not
			.toHaveBeenCalled()
		expect(kept)
			.toHaveBeenCalledTimes(1)
	})

	it('is idempotent', () => {
		const { runtime } = createRuntime()
		const listener = vi.fn()
		const unsubscribe = runtime.subscribeDisposal(listener)

		expect(() => {
			unsubscribe()
			unsubscribe()
			unsubscribe()
		})
			.not
			.toThrow()
		runtime.dispose()

		expect(listener)
			.not
			.toHaveBeenCalled()
	})

	it('is a no-op after the listener has run', () => {
		const { runtime } = createRuntime()
		const listener = vi.fn()
		const unsubscribe = runtime.subscribeDisposal(listener)
		runtime.dispose()

		expect(() => unsubscribe())
			.not
			.toThrow()
		expect(() => unsubscribe())
			.not
			.toThrow()
		expect(listener)
			.toHaveBeenCalledTimes(1)
	})

	it('is a no-op after disposal when the listener was removed before it', () => {
		const { runtime } = createRuntime()
		const unsubscribe = runtime.subscribeDisposal(() => {})
		unsubscribe()
		runtime.dispose()

		expect(() => unsubscribe())
			.not
			.toThrow()
	})

	it('can be called from inside the delivered listener itself', () => {
		const { runtime } = createRuntime()
		let unsubscribe: () => void = () => {}
		const listener = vi.fn(() => unsubscribe())
		unsubscribe = runtime.subscribeDisposal(listener)

		expect(() => runtime.dispose())
			.not
			.toThrow()
		expect(listener)
			.toHaveBeenCalledTimes(1)
		expect(reported)
			.toEqual([])
	})
})

describe('runtime.subscribeDisposal(): references', () => {
	// Needs `node --expose-gc`; without a collector there is nothing observable to assert.
	const gc = (globalThis as { gc?: () => void }).gc

	it.skipIf(gc === undefined)('releases a listener once it has run', async () => {
		const { runtime } = createRuntime()
		let listener: (() => void) | null = () => {}
		const weak = new WeakRef(listener)
		runtime.subscribeDisposal(listener)
		runtime.dispose()
		listener = null
		await new Promise<void>(resolve => setTimeout(resolve, 0))
		gc!()

		expect(weak.deref())
			.toBeUndefined()
	})

	it.skipIf(gc === undefined)('releases a listener that was unsubscribed before disposal', async () => {
		const { runtime } = createRuntime()
		let listener: (() => void) | null = () => {}
		const weak = new WeakRef(listener)
		runtime.subscribeDisposal(listener)()
		listener = null
		await new Promise<void>(resolve => setTimeout(resolve, 0))
		gc!()

		expect(weak.deref())
			.toBeUndefined()
	})

	it.skipIf(gc === undefined)('releases a listener from a kept unsubscribe handle once it has run', async () => {
		const { runtime } = createRuntime()
		let listener: (() => void) | null = () => {}
		const weak = new WeakRef(listener)
		const unsubscribe = runtime.subscribeDisposal(listener)
		runtime.dispose()
		listener = null
		await new Promise<void>(resolve => setTimeout(resolve, 0))
		gc!()

		expect(weak.deref())
			.toBeUndefined()
		expect(unsubscribe)
			.toBeTypeOf('function')
	})

	it.skipIf(gc === undefined)('releases a listener from a kept unsubscribe handle once it was called', async () => {
		const { runtime } = createRuntime()
		let listener: (() => void) | null = () => {}
		const weak = new WeakRef(listener)
		const unsubscribe = runtime.subscribeDisposal(listener)
		unsubscribe()
		listener = null
		await new Promise<void>(resolve => setTimeout(resolve, 0))
		gc!()

		expect(weak.deref())
			.toBeUndefined()
		expect(unsubscribe)
			.toBeTypeOf('function')
	})
})

describe('runtime.subscribeDisposal(): dispose() during a running Method', () => {
	it('delivers once and leaves the Runtime consistent when a State listener disposes', () => {
		const { runtime, widget } = createRuntime()
		const disposals = vi.fn()
		const stateNotifications = vi.fn()
		runtime.subscribeDisposal(disposals)
		widget.state.count.subscribe((value) => {
			stateNotifications(value)
			runtime.dispose()
		})

		widget.methods.bump()

		expect(disposals)
			.toHaveBeenCalledTimes(1)
		expect(runtime.isDisposed)
			.toBe(true)
		expect(stateNotifications)
			.toHaveBeenCalledTimes(1)
		expect(throwsDisposedError(() => widget.state.count.get()))
			.toBe(true)

		runtime.dispose()

		expect(disposals)
			.toHaveBeenCalledTimes(1)
	})

	it('delivers once and leaves the Runtime consistent when an Event listener disposes', () => {
		const { runtime, widget } = createRuntime()
		const disposals = vi.fn()
		runtime.subscribeDisposal(disposals)
		widget.events.bumped.subscribe(() => runtime.dispose())

		widget.methods.bump()

		expect(disposals)
			.toHaveBeenCalledTimes(1)
		expect(runtime.isDisposed)
			.toBe(true)
		expect(throwsDisposedError(() => widget.methods.increment()))
			.toBe(true)

		runtime.dispose()

		expect(disposals)
			.toHaveBeenCalledTimes(1)
	})

	it('keeps a throwing disposal listener from disturbing the running Method', async () => {
		const { runtime, widget } = createRuntime()
		const error = new Error('disposal listener failed')
		const later = vi.fn()
		runtime.subscribeDisposal(() => {
			throw error
		})
		runtime.subscribeDisposal(later)
		widget.events.bumped.subscribe(() => runtime.dispose())

		widget.methods.bump()
		await waitForAsyncReporting()

		expect(later)
			.toHaveBeenCalledTimes(1)
		expect(reported)
			.toEqual([error])
	})
})

describe('runtime.subscribeDisposal(): independence', () => {
	it('keeps two Runtimes of the same Blueprint independent', () => {
		const { blueprint, runtime: first } = createRuntime()
		const second = blueprint.createRuntime()
		const firstListener = vi.fn()
		const secondListener = vi.fn()
		first.subscribeDisposal(firstListener)
		second.subscribeDisposal(secondListener)

		first.dispose()

		expect(firstListener)
			.toHaveBeenCalledTimes(1)
		expect(secondListener)
			.not
			.toHaveBeenCalled()
		expect(second.isDisposed)
			.toBe(false)
		expect(() => second.subscribeDisposal(() => {}))
			.not
			.toThrow()

		second.dispose()

		expect(firstListener)
			.toHaveBeenCalledTimes(1)
		expect(secondListener)
			.toHaveBeenCalledTimes(1)
	})

	it('lets a listener dispose another Runtime', () => {
		const { blueprint, runtime: first } = createRuntime()
		const second = blueprint.createRuntime()
		const order: string[] = []
		second.subscribeDisposal(() => order.push('second'))
		first.subscribeDisposal(() => {
			order.push('first')
			second.dispose()
		})

		first.dispose()

		expect(order)
			.toEqual(['first', 'second'])
		expect(second.isDisposed)
			.toBe(true)
	})
})
