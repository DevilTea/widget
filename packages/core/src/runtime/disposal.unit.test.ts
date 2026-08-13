/**
 * Conformance: issue #10 COMMENT 26 §12 (disposal), cross-checked against COMMENT 20 and consolidated
 * handoff §19.
 *
 * Scope: `runtime.dispose()` is idempotent, marks the Runtime disposed before tearing anything down,
 * emits no final value/issue notification, and leaves a small set of immutable metadata readable
 * (`runtime.isDisposed`, `runtime.blueprint`, held `RuntimeWidget.id`/`.type`/`.blueprint`) while every
 * other live Runtime/State/Property/Method operation and every *new* subscription throws the exact,
 * stable `WidgetSystemRuntimeDisposedError` (checked via `instanceof` and `.name`, never message text).
 * Unsubscribe handles obtained before dispose remain safe idempotent no-ops afterward.
 *
 * Only the public entry (`../index`) is imported; no internal module or `blueprintInternals` access.
 */

import { describe, expect, it } from 'vitest'
import { createWidgetPlugin, createWidgetSystem, WidgetSystemRuntimeDisposedError } from '../index'

interface CounterInterfaces {
	state: {
		count: number
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

/** Asserts `action` throws exactly the stable disposed-runtime error, by discriminator and name only. */
function expectDisposedError(action: () => unknown): void {
	let caught: unknown
	try {
		action()
	}
	catch (error) {
		caught = error
	}

	expect(caught)
		.toBeInstanceOf(WidgetSystemRuntimeDisposedError)
	expect((caught as Error).name)
		.toBe('WidgetSystemRuntimeDisposedError')
}

describe('dispose() idempotency', () => {
	it('is safe to call twice and leaves isDisposed true', () => {
		const { runtime } = createRuntime()

		expect(runtime.isDisposed)
			.toBe(false)

		expect(() => runtime.dispose()).not.toThrow()
		expect(runtime.isDisposed)
			.toBe(true)

		expect(() => runtime.dispose()).not.toThrow()
		expect(runtime.isDisposed)
			.toBe(true)
	})
})

describe('post-dispose readable metadata', () => {
	it('runtime.isDisposed and runtime.blueprint stay readable and stable', () => {
		const { runtime } = createRuntime()
		const blueprintBeforeDispose = runtime.blueprint

		runtime.dispose()

		expect(runtime.isDisposed)
			.toBe(true)
		expect(runtime.blueprint)
			.toBe(blueprintBeforeDispose)
	})

	it('an already-held RuntimeWidget keeps readable id/type/blueprint', () => {
		const { runtime, widget } = createRuntime()
		const idBeforeDispose = widget.id
		const typeBeforeDispose = widget.type
		const blueprintNodeBeforeDispose = widget.blueprint

		runtime.dispose()

		expect(widget.id)
			.toBe(idBeforeDispose)
		expect(widget.type)
			.toBe(typeBeforeDispose)
		expect(widget.blueprint)
			.toBe(blueprintNodeBeforeDispose)
	})
})

describe('post-dispose live Runtime surface throws WidgetSystemRuntimeDisposedError', () => {
	it('runtime.getWidget', () => {
		const { runtime } = createRuntime()
		runtime.dispose()
		expectDisposedError(() => runtime.getWidget('root'))
	})

	it('runtime.getIssues', () => {
		const { runtime } = createRuntime()
		runtime.dispose()
		expectDisposedError(() => runtime.getIssues())
	})

	it('runtime.getCollectedIssues', () => {
		const { runtime } = createRuntime()
		runtime.dispose()
		expectDisposedError(() => runtime.getCollectedIssues())
	})

	it('runtime.subscribeCollectedIssues (new subscription)', () => {
		const { runtime } = createRuntime()
		runtime.dispose()
		expectDisposedError(() => runtime.subscribeCollectedIssues(() => {}))
	})
})

describe('post-dispose State surface throws WidgetSystemRuntimeDisposedError', () => {
	it('get', () => {
		const { runtime, widget } = createRuntime()
		runtime.dispose()
		expectDisposedError(() => widget.state.count.get())
	})

	it('set', () => {
		const { runtime, widget } = createRuntime()
		runtime.dispose()
		expectDisposedError(() => widget.state.count.set(1))
	})

	it('subscribe (new subscription)', () => {
		const { runtime, widget } = createRuntime()
		runtime.dispose()
		expectDisposedError(() => widget.state.count.subscribe(() => {}))
	})

	it('getIssues', () => {
		const { runtime, widget } = createRuntime()
		runtime.dispose()
		expectDisposedError(() => widget.state.count.getIssues())
	})

	it('subscribeIssues (new subscription)', () => {
		const { runtime, widget } = createRuntime()
		runtime.dispose()
		expectDisposedError(() => widget.state.count.subscribeIssues(() => {}))
	})
})

describe('post-dispose Property surface throws WidgetSystemRuntimeDisposedError', () => {
	it('get', () => {
		const { runtime, widget } = createRuntime()
		runtime.dispose()
		expectDisposedError(() => widget.properties.doubled.get())
	})

	it('subscribe (new subscription)', () => {
		const { runtime, widget } = createRuntime()
		runtime.dispose()
		expectDisposedError(() => widget.properties.doubled.subscribe(() => {}))
	})

	it('getIssues', () => {
		const { runtime, widget } = createRuntime()
		runtime.dispose()
		expectDisposedError(() => widget.properties.doubled.getIssues())
	})

	it('subscribeIssues (new subscription)', () => {
		const { runtime, widget } = createRuntime()
		runtime.dispose()
		expectDisposedError(() => widget.properties.doubled.subscribeIssues(() => {}))
	})
})

describe('post-dispose Method surface throws WidgetSystemRuntimeDisposedError', () => {
	it('invocation', () => {
		const { runtime, widget } = createRuntime()
		runtime.dispose()
		expectDisposedError(() => widget.methods.increment(1))
	})

	it('getIssues', () => {
		const { runtime, widget } = createRuntime()
		runtime.dispose()
		expectDisposedError(() => widget.methods.increment.getIssues())
	})

	it('subscribeIssues (new subscription)', () => {
		const { runtime, widget } = createRuntime()
		runtime.dispose()
		expectDisposedError(() => widget.methods.increment.subscribeIssues(() => {}))
	})
})

describe('pre-existing unsubscribe handles remain safe idempotent no-ops after dispose', () => {
	it('a state.subscribe handle obtained before dispose does not throw when called after dispose, even repeatedly', () => {
		const { runtime, widget } = createRuntime()
		const unsubscribe = widget.state.count.subscribe(() => {})

		runtime.dispose()

		expect(() => unsubscribe()).not.toThrow()
		expect(() => unsubscribe()).not.toThrow()
	})

	it('a property.subscribe handle obtained before dispose does not throw when called after dispose', () => {
		const { runtime, widget } = createRuntime()
		const unsubscribe = widget.properties.doubled.subscribe(() => {})

		runtime.dispose()

		expect(() => unsubscribe()).not.toThrow()
	})

	it('a runtime.subscribeCollectedIssues handle obtained before dispose does not throw when called after dispose', () => {
		const { runtime } = createRuntime()
		const unsubscribe = runtime.subscribeCollectedIssues(() => {})

		runtime.dispose()

		expect(() => unsubscribe()).not.toThrow()
	})

	it('an unsubscribe handle called before dispose, then again after dispose, stays a no-op', () => {
		const { runtime, widget } = createRuntime()
		const unsubscribe = widget.state.count.subscribe(() => {})

		expect(() => unsubscribe()).not.toThrow()
		runtime.dispose()
		expect(() => unsubscribe()).not.toThrow()
	})
})

describe('dispose() emits no final value/issue notification', () => {
	it('a state subscriber count observed before dispose does not change because of dispose() itself', () => {
		const { runtime, widget } = createRuntime()
		const calls: Array<number | null> = []
		widget.state.count.subscribe(value => calls.push(value))

		widget.state.count.set(5)
		expect(calls)
			.toEqual([5])

		runtime.dispose()

		// dispose() must not fire a final notification to a previously-registered subscriber.
		expect(calls)
			.toEqual([5])
	})

	it('a state issue subscriber count observed before dispose does not change because of dispose() itself', () => {
		const { runtime, widget } = createRuntime()
		const issueSnapshots: number[] = []
		widget.state.count.subscribeIssues(issues => issueSnapshots.push(issues.length))

		widget.state.count.set('not-a-number' as unknown as number)
		expect(issueSnapshots)
			.toEqual([1])

		runtime.dispose()

		expect(issueSnapshots)
			.toEqual([1])
	})

	it('a runtime.subscribeCollectedIssues subscriber observed before dispose does not change because of dispose() itself', () => {
		const { runtime, widget } = createRuntime()
		const snapshotLengths: number[] = []
		runtime.subscribeCollectedIssues(issues => snapshotLengths.push(issues.length))

		widget.state.count.set('not-a-number' as unknown as number)
		expect(snapshotLengths)
			.toEqual([1])

		runtime.dispose()

		expect(snapshotLengths)
			.toEqual([1])
	})

	it('a property subscriber observed before dispose is never invoked again after dispose', () => {
		const { runtime, widget } = createRuntime()
		const results: number[] = []
		widget.properties.doubled.subscribe((result) => {
			if (result.success && result.value !== null)
				results.push(result.value)
		})

		widget.state.count.set(3)
		expect(results)
			.toEqual([6])

		runtime.dispose()

		expect(results)
			.toEqual([6])
	})
})
