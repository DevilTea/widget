/**
 * Conformance: a callback context's dependency callables (`deps.*`) and `emit` callables share the
 * lifetime of `addDiagnostic` / `hasAnyDiagnostic` (Discussion #12 C0R159 callback-context lifetime,
 * extended to every context member) and the Runtime disposal guard.
 *
 * - called after the callback that received them returned, they throw an implementation `TypeError`
 *   without reading, writing, invoking or emitting anything;
 * - after `dispose()` they throw without performing anything;
 * - a Property `compute` can never write State (or emit) through a callable retained from a Method,
 *   even while that Method is still running further down the stack;
 * - ordinary nested use keeps working: nested Method invocation, Properties reading their own deps,
 *   reentrancy and Method <-> Method recursion.
 */

import type { ExecutionResult } from '../index'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createWidgetPlugin, createWidgetSystem, WidgetSystemRuntimeDisposedError } from '../index'
import { inspectRuntime } from '../inspection'

type Callable = (...args: never[]) => unknown

interface Retained {
	execute?: {
		deps: {
			getN: Callable
			setN: Callable
			twice: Callable
			noop: Callable
			absent: Callable
		}
		emit: { changed: (value: number) => unknown }
	}
	compute?: { deps: { n: Callable } }
}

let retained: Retained = {}
/** A setter smuggled out of a Method context, called later from somewhere else. */
let escapedSetter: ((value: number) => unknown) | null = null
/** An emitter smuggled out of a Method context, called later from somewhere else. */
let escapedEmit: ((value: number) => unknown) | null = null
/** The promise an `async` execute returned, kept so its rejection is observed. */
let asyncTail: Promise<unknown> | undefined
let computeRuns = 0
let noopRuns = 0

afterEach(() => {
	retained = {}
	escapedSetter = null
	escapedEmit = null
})

function valueOf(result: ExecutionResult<unknown, unknown>): unknown {
	return result.ok ? result.value : 'failed'
}

interface HostInterfaces {
	state: {
		n: number
		other: number
	}
	properties: {
		twice: number
		/** Calls `escapedSetter` / `escapedEmit` when armed. */
		leaky: number
		/** Reads the read-only Method `probe`, which calls `escapedSetter` when armed. */
		viaProbe: number
		capturesOwnDeps: number
	}
	methods: {
		capture: () => null
		noop: () => string
		probe: () => number
		callEscaped: () => string
		writeThenReadLeaky: () => number
		writeThenReadViaProbe: () => number
		countdown: (k: number) => number
		emitChanged: (value: number) => null
		setOther: (value: number) => number
		/** Declared synchronous (a PromiseLike return type is rejected at the type level); its execute is async anyway. */
		asyncTail: () => string
	}
	events: {
		changed: [value: number]
	}
}

function numberOf(result: ExecutionResult<number | null, unknown>): number {
	return result.ok ? result.value ?? 0 : 0
}

const plugin = createWidgetPlugin('host')
	.description('Test widget')
	.interfaces<HostInterfaces>()
	.state(state => state
		.n({ validate: (input): input is number => typeof input === 'number', default: () => 0 })
		.other({ validate: (input): input is number => typeof input === 'number', default: () => 0 }))
	.properties(properties => properties
		.twice({
			registerDeps: ({ dep }) => ({ n: dep.self.state.get('n') }),
			compute: ({ deps }) => {
				computeRuns++
				return numberOf(deps.n()) * 2
			},
		})
		.leaky({
			registerDeps: ({ dep }) => ({ n: dep.self.state.get('n') }),
			compute: ({ deps }) => {
				const n = numberOf(deps.n())
				escapedSetter?.(n + 100)
				escapedEmit?.(n)
				return n
			},
		})
		.viaProbe({
			registerDeps: ({ dep }) => ({ probe: dep.self.methods.invoke('probe') }),
			compute: ({ deps }) => numberOf(deps.probe()),
		})
		.capturesOwnDeps({
			registerDeps: ({ dep }) => ({ n: dep.self.state.get('n') }),
			compute: (ctx) => {
				retained.compute = ctx as unknown as Retained['compute']
				return numberOf(ctx.deps.n())
			},
		}))
	.methods(methods => methods
		.capture({
			registerDeps: ({ dep }) => ({
				getN: dep.self.state.get('n'),
				setN: dep.self.state.set('n'),
				twice: dep.self.properties.get('twice'),
				noop: dep.self.methods.invoke('noop'),
				absent: dep.widget('missing')
					.optional().state.get('x'),
			}),
			validateArgs: (args): args is [] => args.length === 0,
			execute: (ctx) => {
				retained.execute = ctx as unknown as Retained['execute']
				return null
			},
		})
		.noop({
			validateArgs: (args): args is [] => args.length === 0,
			execute: () => {
				noopRuns++
				return 'noop'
			},
		})
		.probe({
			registerDeps: ({ dep }) => ({ n: dep.self.state.get('n') }),
			validateArgs: (args): args is [] => args.length === 0,
			// Write-free, so a Property may depend on it; it calls a smuggled setter when armed.
			execute: ({ deps }) => {
				escapedSetter?.(7)
				return numberOf(deps.n())
			},
		})
		.callEscaped({
			validateArgs: (args): args is [] => args.length === 0,
			execute: () => {
				escapedSetter?.('not-a-number' as unknown as number)
				return 'called'
			},
		})
		.writeThenReadLeaky({
			registerDeps: ({ dep }) => ({ setOther: dep.self.state.set('other'), leaky: dep.self.properties.get('leaky') }),
			validateArgs: (args): args is [] => args.length === 0,
			execute: ({ deps, emit }) => {
				escapedSetter = deps.setOther
				escapedEmit = emit.changed
				return numberOf(deps.leaky())
			},
		})
		.writeThenReadViaProbe({
			registerDeps: ({ dep }) => ({ setOther: dep.self.state.set('other'), viaProbe: dep.self.properties.get('viaProbe') }),
			validateArgs: (args): args is [] => args.length === 0,
			execute: ({ deps }) => {
				escapedSetter = deps.setOther
				return numberOf(deps.viaProbe())
			},
		})
		.countdown({
			registerDeps: ({ dep }) => ({
				countdown: dep.self.methods.invoke('countdown'),
				setN: dep.self.state.set('n'),
				setOther: dep.self.state.set('other'),
				twice: dep.self.properties.get('twice'),
			}),
			validateArgs: (args): args is [number] => typeof args[0] === 'number',
			execute: ({ args: [k], deps }) => {
				deps.setN(k)
				if (k > 0 && !deps.countdown(k - 1).ok)
					return -1
				// The nested invocation has returned: this invocation's own deps work again.
				const twice = numberOf(deps.twice())
				deps.setOther(k)
				return twice
			},
		})
		.emitChanged({
			validateArgs: (args): args is [number] => typeof args[0] === 'number',
			execute: ({ args: [value], emit }) => {
				emit.changed(value)
				return null
			},
		})
		.setOther({
			registerDeps: ({ dep }) => ({ setOther: dep.self.state.set('other'), twice: dep.self.properties.get('twice') }),
			validateArgs: (args): args is [number] => typeof args[0] === 'number',
			execute: ({ args: [value], deps }) => {
				deps.setOther(value)
				return numberOf(deps.twice())
			},
		})
		.asyncTail({
			registerDeps: ({ dep }) => ({ setN: dep.self.state.set('n') }),
			validateArgs: (args): args is [] => args.length === 0,
			execute: ({ deps }) => {
				const tail = (async () => {
					deps.setN(1)
					await null
					deps.setN(2)
					return 'done'
				})()
				asyncTail = tail
				return tail as unknown as string
			},
		}))
	.events(events => events.changed({ description: 'Changed' }))
	.done()

const system = createWidgetSystem({ plugins: [plugin] })

function createHarness() {
	const blueprint = system.createBlueprint({ id: 'host', type: 'host' })
	if (blueprint.status !== 'valid')
		throw new Error(`expected a valid Blueprint: ${JSON.stringify(blueprint.diagnostics)}`)
	const runtime = blueprint.createRuntime()
	const widget = runtime.getWidget('host')!
	return { runtime, widget }
}

function captureExecuteContext(harness: ReturnType<typeof createHarness>) {
	harness.widget.methods.capture()
	const ctx = retained.execute
	if (ctx === undefined)
		throw new Error('fixture error: execute context was not retained')
	return ctx
}

describe('dependency callables after their callback returned', () => {
	it('throw a TypeError without reading, writing, evaluating or invoking', () => {
		const harness = createHarness()
		const { deps } = captureExecuteContext(harness)
		computeRuns = 0
		noopRuns = 0

		expect(() => deps.getN())
			.toThrow(TypeError)
		expect(() => deps.setN(5 as never))
			.toThrow(TypeError)
		expect(() => deps.twice())
			.toThrow(TypeError)
		expect(() => deps.noop())
			.toThrow(TypeError)
		expect(() => deps.absent())
			.toThrow(TypeError)

		expect(harness.widget.state.n.get())
			.toBe(0)
		expect(computeRuns)
			.toBe(0)
		expect(noopRuns)
			.toBe(0)
	})

	it('a rejected candidate leaves no diagnostic on any primitive', () => {
		const harness = createHarness()
		const { deps } = captureExecuteContext(harness)

		expect(() => deps.setN('bad' as never))
			.toThrow(TypeError)
		expect(harness.runtime.getDiagnostics())
			.toEqual([])
	})

	it('a Property compute\'s own deps also close when the compute returns', () => {
		const harness = createHarness()
		harness.widget.properties.capturesOwnDeps.get()

		expect(() => retained.compute!.deps.n())
			.toThrow(TypeError)
	})

	it('cannot be used from inside an unrelated Method that happens to be executing', () => {
		const harness = createHarness()
		const { deps } = captureExecuteContext(harness)
		escapedSetter = deps.setN as (value: number) => unknown

		expect(() => harness.widget.methods.callEscaped())
			.toThrow(TypeError)
		expect(harness.widget.methods.callEscaped.getDiagnostics())
			.toEqual([])
		expect(harness.widget.state.n.getDiagnostics())
			.toEqual([])
		expect(harness.widget.state.n.get())
			.toBe(0)
	})

	it('a retained emit throws a TypeError without delivering', () => {
		const harness = createHarness()
		const { emit } = captureExecuteContext(harness)
		const listener = vi.fn()
		harness.widget.events.changed.subscribe(listener)

		expect(() => emit.changed(1))
			.toThrow(TypeError)
		expect(listener).not.toHaveBeenCalled()
	})

	it('an async execute tail cannot write after the invocation returned', async () => {
		const harness = createHarness()
		const values: unknown[] = []
		harness.widget.state.n.subscribe(value => values.push(value))

		// The thenable is rejected synchronously by the sync-boundary guard; its synchronous head already ran.
		expect(() => harness.widget.methods.asyncTail())
			.toThrow(TypeError)
		await expect(asyncTail).rejects.toThrow(TypeError)
		expect(harness.widget.state.n.get())
			.toBe(1)
		expect(values)
			.toEqual([1])
	})
})

describe('a Property compute can never write State through a retained callable', () => {
	it('refuses a setter whose Method is not running', () => {
		const harness = createHarness()
		const { deps } = captureExecuteContext(harness)
		escapedSetter = deps.setN as (value: number) => unknown

		expect(() => harness.widget.properties.leaky.get())
			.toThrow(TypeError)
		expect(harness.widget.state.n.get())
			.toBe(0)
	})

	it('refuses a setter whose Method is still running further down the stack', () => {
		const harness = createHarness()
		const emitted = vi.fn()
		harness.widget.events.changed.subscribe(emitted)

		expect(() => harness.widget.methods.writeThenReadLeaky())
			.toThrow(TypeError)
		expect(harness.widget.state.other.get())
			.toBe(0)
		expect(emitted).not.toHaveBeenCalled()
	})

	it('refuses a setter reached through a read-only Method the Property invokes', () => {
		const harness = createHarness()

		expect(() => harness.widget.methods.writeThenReadViaProbe())
			.toThrow(TypeError)
		expect(harness.widget.state.other.get())
			.toBe(0)
	})
})

describe('dependency and emit callables after dispose', () => {
	it('throw without reading, writing, evaluating, invoking or emitting', () => {
		const harness = createHarness()
		const { deps, emit } = captureExecuteContext(harness)
		const inspection = inspectRuntime(harness.runtime)
		const state = inspection.getWidget(inspection.blueprint.rootNodeId)!.getState('n')!
		const listener = vi.fn()
		harness.widget.events.changed.subscribe(listener)
		computeRuns = 0
		noopRuns = 0

		harness.runtime.dispose()

		for (const call of [() => deps.getN(), () => deps.setN(99 as never), () => deps.twice(), () => deps.noop(), () => emit.changed(2)]) {
			expect(call)
				.toThrow(WidgetSystemRuntimeDisposedError)
		}
		expect(state.getSnapshot())
			.toEqual({ value: 0 })
		expect(computeRuns)
			.toBe(0)
		expect(noopRuns)
			.toBe(0)
		expect(listener).not.toHaveBeenCalled()
	})
})

describe('legitimate nested use keeps working', () => {
	it('a Method invoking another Method, reading Properties that read their own deps', () => {
		const harness = createHarness()

		expect(harness.widget.methods.setOther(4))
			.toEqual({ ok: true, value: 0 })
		harness.widget.state.n.set(3)

		expect(harness.widget.methods.setOther(5))
			.toEqual({ ok: true, value: 6 })
		expect(harness.widget.state.other.get())
			.toBe(5)
	})

	it('method recursion uses its own deps before and after each nested invocation', () => {
		const harness = createHarness()

		expect(harness.widget.methods.countdown(3))
			.toEqual({ ok: true, value: 0 })
		expect(harness.widget.state.n.get())
			.toBe(0)
		expect(harness.widget.state.other.get())
			.toBe(3)
		expect(harness.runtime.getDiagnostics())
			.toEqual([])
	})

	it('a Method invoked reentrantly from an event listener uses its deps and emit', () => {
		const harness = createHarness()
		const seen: unknown[] = []
		harness.widget.events.changed.subscribe((value) => {
			seen.push(value)
			if (value === 1) {
				seen.push(valueOf(harness.widget.methods.setOther(10)))
				harness.widget.methods.emitChanged(2)
			}
		})

		expect(harness.widget.methods.emitChanged(1))
			.toEqual({ ok: true, value: null })
		expect(seen)
			.toEqual([1, 0, 2])
		expect(harness.widget.state.other.get())
			.toBe(10)
	})
})
