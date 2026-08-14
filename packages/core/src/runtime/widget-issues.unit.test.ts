/**
 * Conformance tests for `RuntimeWidget.getIssues()`/`subscribeIssues()` — issue #10 amendment
 * "RuntimeWidget aggregate issue surface" (discovery context: issue #13 comment "Core gap discovered by
 * Widget Lab — RuntimeWidget issue aggregation").
 *
 * Scope: a `RuntimeWidget` aggregates only the current issues owned by its own primitives — state
 * members -> property members -> method members, plugin declaration order within each capability, each
 * primitive's own local issue order preserved — and never Runtime-level issues, even when a
 * Runtime-level issue's source happens to carry the same `widgetId`. `runtime.getCollectedIssues()`
 * composes `runtime.getIssues()` (Runtime-level only) plus each `RuntimeWidget.getIssues()` in Blueprint
 * semantic widget order.
 *
 * Only the public entry (`../index`) is imported; no internal module or `blueprintInternals` access.
 */

import { describe, expect, it, vi } from 'vitest'
import { createWidgetPlugin, createWidgetSystem, EMPTY_ISSUES, WidgetSystemRuntimeDisposedError } from '../index'

// -------------------------------------------------------------------------------------------------
// Harness: one widget with two members per capability, declared in reverse-alphabetical order ("two"
// before "one") so a plausible-but-wrong sorted-key implementation would be caught, plus a "lazy"
// Property with a compute spy for the laziness tests.
// -------------------------------------------------------------------------------------------------

interface OrderInterfaces {
	state: {
		two: number
		one: number
	}
	properties: {
		two: number
		one: number
		lazy: number
	}
	methods: {
		two: () => number
		one: () => number
	}
}

function createOrderHarness() {
	let propertyTwoShouldFail = false
	let propertyTwoDoubleIssue = false
	let propertyOneShouldFail = false
	let methodTwoShouldFail = false
	let methodOneShouldFail = false
	let lazyComputeCount = 0

	const plugin = createWidgetPlugin('order-probe')
		.interfaces<OrderInterfaces>()
		.state(state => state
			.two({
				validate: (input): input is number => typeof input === 'number',
				default: () => 0,
			})
			.one({
				validate: (input): input is number => typeof input === 'number',
				default: () => 0,
			}))
		.properties(properties => properties
			.two({
				compute: ({ addIssue }) => {
					if (propertyTwoShouldFail)
						addIssue({ message: 'property two failed' })
					if (propertyTwoDoubleIssue)
						addIssue({ message: 'property two failed again' })
					return 0
				},
			})
			.one({
				compute: ({ addIssue }) => {
					if (propertyOneShouldFail)
						addIssue({ message: 'property one failed' })
					return 0
				},
			})
			.lazy({
				compute: () => {
					lazyComputeCount++
					return 0
				},
			}))
		.methods(methods => methods
			.two({
				validateArgs: (args): args is [] => args.length === 0,
				execute: ({ addIssue }) => {
					if (methodTwoShouldFail)
						addIssue({ message: 'method two failed' })
					return 0
				},
			})
			.one({
				validateArgs: (args): args is [] => args.length === 0,
				execute: ({ addIssue }) => {
					if (methodOneShouldFail)
						addIssue({ message: 'method one failed' })
					return 0
				},
			}))
		.done()

	const system = createWidgetSystem({ plugins: [plugin] })
	const blueprint = system.createBlueprint({ id: 'root', type: 'order-probe' })
	if (blueprint.status !== 'valid')
		throw new Error(`test fixture: expected a valid blueprint, got issues: ${JSON.stringify(blueprint.getCollectedIssues())}`)

	const runtime = blueprint.createRuntime()
	const widget = runtime.getWidget('root')
	if (widget === null)
		throw new Error('test fixture: expected the "root" widget to resolve')

	return {
		runtime,
		widget,
		lazyComputeCount: () => lazyComputeCount,
		setPropertyTwoShouldFail: (value: boolean) => { propertyTwoShouldFail = value },
		setPropertyTwoDoubleIssue: (value: boolean) => { propertyTwoDoubleIssue = value },
		setPropertyOneShouldFail: (value: boolean) => { propertyOneShouldFail = value },
		setMethodTwoShouldFail: (value: boolean) => { methodTwoShouldFail = value },
		setMethodOneShouldFail: (value: boolean) => { methodOneShouldFail = value },
	}
}

describe('runtimeWidget.getIssues() — canonical empty aggregate', () => {
	it('a widget with every primitive currently succeeding aggregates to the canonical EMPTY_ISSUES reference', () => {
		const { widget } = createOrderHarness()

		expect(widget.getIssues())
			.toBe(EMPTY_ISSUES)
	})
})

describe('runtimeWidget.getIssues() — deterministic aggregate order', () => {
	it('orders state -> properties -> methods and preserves declaration order within each capability', () => {
		const { widget, setPropertyTwoShouldFail, setPropertyOneShouldFail, setMethodTwoShouldFail, setMethodOneShouldFail } = createOrderHarness()

		widget.state.two.set('nope' as unknown as number)
		widget.state.one.set('nope' as unknown as number)
		setPropertyTwoShouldFail(true)
		setPropertyOneShouldFail(true)
		widget.properties.two.get()
		widget.properties.one.get()
		setMethodTwoShouldFail(true)
		setMethodOneShouldFail(true)
		widget.methods.two()
		widget.methods.one()

		const issues = widget.getIssues()

		expect(issues.map(issue => issue.source.type))
			.toEqual([
				'state-validation',
				'state-validation',
				'property-result',
				'property-result',
				'method-result',
				'method-result',
			])

		// "two" was declared before "one" in every capability; the aggregate must not silently sort by
		// key/name.
		const memberOf = (issue: (typeof issues)[number]) => (issue.source as { key?: string, name?: string }).key ?? (issue.source as { key?: string, name?: string }).name
		expect(issues.map(memberOf))
			.toEqual(['two', 'one', 'two', 'one', 'two', 'one'])

		// Every aggregated issue is the exact same frozen object the owning primitive itself reports —
		// aggregation reuses references, it never copies.
		expect(issues[0])
			.toBe(widget.state.two.getIssues()[0])
		expect(issues[2])
			.toBe(widget.properties.two.getIssues()[0])
		expect(issues[4])
			.toBe(widget.methods.two.getIssues()[0])
	})

	it('preserves one primitive\'s own local issue order inside the widget aggregate', () => {
		const { widget, setPropertyTwoShouldFail, setPropertyTwoDoubleIssue } = createOrderHarness()

		setPropertyTwoShouldFail(true)
		setPropertyTwoDoubleIssue(true)
		widget.properties.two.get()

		const localIssues = widget.properties.two.getIssues()
		expect(localIssues.map(issue => issue.message))
			.toEqual(['property two failed', 'property two failed again'])

		expect(widget.getIssues()
			.map(issue => issue.message))
			.toEqual(['property two failed', 'property two failed again'])
	})
})

describe('runtimeWidget.getIssues() — widgets without every capability', () => {
	it('a widget declaring only properties aggregates just its property issues', () => {
		interface PropsOnlyInterfaces {
			properties: {
				flaky: number
			}
		}

		let shouldFail = false
		const plugin = createWidgetPlugin('props-only-probe')
			.interfaces<PropsOnlyInterfaces>()
			.properties(properties => properties.flaky({
				compute: ({ addIssue }) => {
					if (shouldFail)
						addIssue({ message: 'flaky failed' })
					return 0
				},
			}))
			.done()

		const system = createWidgetSystem({ plugins: [plugin] })
		const blueprint = system.createBlueprint({ id: 'root', type: 'props-only-probe' })
		if (blueprint.status !== 'valid')
			throw new Error('test fixture: expected a valid blueprint')

		const runtime = blueprint.createRuntime()
		const widget = runtime.getWidget('root')
		if (widget === null)
			throw new Error('test fixture: expected the "root" widget to resolve')

		expect(widget.getIssues())
			.toBe(EMPTY_ISSUES)

		shouldFail = true
		widget.properties.flaky.get()

		expect(widget.getIssues()
			.map(issue => issue.source.type))
			.toEqual(['property-result'])
	})

	it('a widget declaring no capabilities at all still exposes getIssues()/subscribeIssues(), aggregating to the canonical empty array', () => {
		const plugin = createWidgetPlugin('capability-less-probe')
			.interfaces<Record<never, never>>()
			.done()

		const system = createWidgetSystem({ plugins: [plugin] })
		const blueprint = system.createBlueprint({ id: 'root', type: 'capability-less-probe' })
		if (blueprint.status !== 'valid')
			throw new Error('test fixture: expected a valid blueprint')

		const runtime = blueprint.createRuntime()
		const widget = runtime.getWidget('root')
		if (widget === null)
			throw new Error('test fixture: expected the "root" widget to resolve')

		expect(widget.getIssues())
			.toBe(EMPTY_ISSUES)
		expect(() => widget.subscribeIssues(() => {})())
			.not.toThrow()
	})
})

describe('runtimeWidget.getIssues()/subscribeIssues() laziness', () => {
	it('never activates a lazy Property evaluation', () => {
		const { widget, lazyComputeCount } = createOrderHarness()

		widget.getIssues()
		expect(lazyComputeCount())
			.toBe(0)

		const listener = vi.fn()
		const unsubscribe = widget.subscribeIssues(listener)
		expect(lazyComputeCount())
			.toBe(0)
		expect(listener)
			.not.toHaveBeenCalled()

		unsubscribe()
	})
})

describe('runtimeWidget.subscribeIssues()', () => {
	it('does not emit immediately on subscribe', () => {
		const { widget } = createOrderHarness()
		const listener = vi.fn()

		widget.subscribeIssues(listener)

		expect(listener)
			.not.toHaveBeenCalled()
	})

	it('emits on a state issue change, a property issue change produced by natural evaluation, and a method invocation issue change, then stops after unsubscribe', () => {
		const { widget, setPropertyTwoShouldFail, setMethodTwoShouldFail } = createOrderHarness()
		const snapshotLengths: number[] = []
		const unsubscribe = widget.subscribeIssues(issues => snapshotLengths.push(issues.length))

		widget.state.two.set('nope' as unknown as number)
		expect(snapshotLengths)
			.toEqual([1])

		setPropertyTwoShouldFail(true)
		widget.properties.two.get()
		expect(snapshotLengths)
			.toEqual([1, 2])

		setMethodTwoShouldFail(true)
		widget.methods.two()
		expect(snapshotLengths)
			.toEqual([1, 2, 3])

		unsubscribe()
		widget.state.two.set(5)
		expect(snapshotLengths)
			.toEqual([1, 2, 3])
	})
})

describe('runtimeWidget.getIssues() / runtime.getCollectedIssues() — aggregate snapshot immutability', () => {
	it('a non-empty widget aggregate array is itself frozen and rejects an external push', () => {
		const { widget, setPropertyTwoShouldFail } = createOrderHarness()
		setPropertyTwoShouldFail(true)
		widget.properties.two.get()

		const issues = widget.getIssues()
		expect(Object.isFrozen(issues))
			.toBe(true)
		expect(() => (issues as unknown as unknown[]).push({ source: { type: 'forged' }, message: 'forged' }))
			.toThrow(TypeError)
	})

	it('a non-empty runtime.getCollectedIssues() array is itself frozen and rejects an external push', () => {
		const { runtime, widget, setPropertyTwoShouldFail } = createOrderHarness()
		setPropertyTwoShouldFail(true)
		widget.properties.two.get()

		const collected = runtime.getCollectedIssues()
		expect(Object.isFrozen(collected))
			.toBe(true)
		expect(() => (collected as unknown as unknown[]).push({ source: { type: 'forged' }, message: 'forged' }))
			.toThrow(TypeError)
	})

	it('a caller mutation attempt (rejected by the freeze above) never leaks a forged issue into a later widget or runtime read', () => {
		const { runtime, widget, setPropertyTwoShouldFail } = createOrderHarness()
		setPropertyTwoShouldFail(true)
		widget.properties.two.get()

		const issues = widget.getIssues()
		const fake = { source: { type: 'forged' }, message: 'forged' }
		expect(() => (issues as unknown as unknown[]).push(fake))
			.toThrow(TypeError)

		expect(widget.getIssues())
			.not.toContain(fake)
		expect(runtime.getCollectedIssues())
			.not.toContain(fake)
	})

	it('each aggregated issue stays frozen — inherited from the owning primitive\'s own immutable snapshot', () => {
		const { widget } = createOrderHarness()
		widget.state.two.set('nope' as unknown as number)

		const issue = widget.getIssues()[0]!
		expect(Object.isFrozen(issue))
			.toBe(true)
		expect(() => {
			(issue as unknown as Record<string, unknown>).message = 'forged'
		})
			.toThrow(TypeError)
	})
})

describe('runtimeWidget.getIssues()/subscribeIssues() post-dispose contract', () => {
	it('getIssues() throws WidgetSystemRuntimeDisposedError after dispose', () => {
		const { runtime, widget } = createOrderHarness()
		runtime.dispose()

		expect(() => widget.getIssues())
			.toThrow(WidgetSystemRuntimeDisposedError)
	})

	it('subscribeIssues() (new subscription) throws WidgetSystemRuntimeDisposedError after dispose', () => {
		const { runtime, widget } = createOrderHarness()
		runtime.dispose()

		expect(() => widget.subscribeIssues(() => {}))
			.toThrow(WidgetSystemRuntimeDisposedError)
	})

	it('an unsubscribe handle obtained before dispose stays a safe idempotent no-op afterward', () => {
		const { runtime, widget } = createOrderHarness()
		const unsubscribe = widget.subscribeIssues(() => {})

		runtime.dispose()

		expect(() => unsubscribe()).not.toThrow()
		expect(() => unsubscribe()).not.toThrow()
	})
})

describe('runtimeWidget.subscribeIssues() external listener exception isolation', () => {
	it('a throwing listener does not block another listener on the same propagation, and its throw surfaces outside the current flush', async () => {
		const { widget } = createOrderHarness()
		const secondSnapshotLengths: number[] = []
		const captured: unknown[] = []
		const onUncaughtException = (error: unknown): void => {
			captured.push(error)
		}

		widget.subscribeIssues(() => {
			throw new Error('first listener boom')
		})
		widget.subscribeIssues(issues => secondSnapshotLengths.push(issues.length))

		process.on('uncaughtException', onUncaughtException)
		try {
			expect(() => widget.state.two.set('nope' as unknown as number)).not.toThrow()
			expect(secondSnapshotLengths)
				.toEqual([1])
			// The exception must not have escaped synchronously into `set`'s call stack.
			expect(captured)
				.toHaveLength(0)

			await new Promise<void>(resolve => setTimeout(resolve, 0))
			await new Promise<void>(resolve => setTimeout(resolve, 0))

			expect(captured)
				.toHaveLength(1)
		}
		finally {
			process.off('uncaughtException', onUncaughtException)
		}
	})
})

// -------------------------------------------------------------------------------------------------
// Runtime-wide composition: runtime-level issues + widget aggregates in Blueprint semantic order.
// -------------------------------------------------------------------------------------------------

describe('runtime.getCollectedIssues() composes runtime-level issues + each RuntimeWidget.getIssues()', () => {
	interface LeafInterfaces {
		properties: {
			flaky: number
		}
	}

	// Defined as two distinct plugin declarations (rather than one function parameterized by a runtime
	// `type: string`) so each plugin's `type` stays a narrow string literal — `RuntimeWidget<Plugins>`
	// is a union keyed by literal `type`, and a widened `string` type would collapse `getWidget()`'s
	// return narrowing.
	const leafAPlugin = createWidgetPlugin('leaf-a-probe')
		.interfaces<LeafInterfaces>()
		.properties(properties => properties.flaky({
			compute: ({ addIssue }) => {
				addIssue({ message: 'leaf-a-probe flaky failed' })
				return 0
			},
		}))
		.done()

	const leafBPlugin = createWidgetPlugin('leaf-b-probe')
		.interfaces<LeafInterfaces>()
		.properties(properties => properties.flaky({
			compute: ({ addIssue }) => {
				addIssue({ message: 'leaf-b-probe flaky failed' })
				return 0
			},
		}))
		.done()

	interface ContainerInterfaces {
		slots: 'children'
		state: {
			count: number
		}
	}

	const containerPlugin = createWidgetPlugin('container-probe')
		.interfaces<ContainerInterfaces>()
		.slots({ children: {} })
		.state(state => state.count({
			validate: (input): input is number => typeof input === 'number',
			default: () => 0,
		}))
		.done()

	function createMultiWidgetHarness() {
		const system = createWidgetSystem({ plugins: [containerPlugin, leafAPlugin, leafBPlugin] })
		const blueprint = system.createBlueprint({
			id: 'root',
			type: 'container-probe',
			slots: {
				children: [
					{ id: 'a', type: 'leaf-a-probe' },
					{ id: 'b', type: 'leaf-b-probe' },
				],
			},
		})
		if (blueprint.status !== 'valid')
			throw new Error(`test fixture: expected a valid blueprint, got issues: ${JSON.stringify(blueprint.getCollectedIssues())}`)

		// An unknown state key on the known "root" widget produces a widget-level `state-override`
		// Runtime-level issue that carries `widgetId: 'root'` — the same id as a real widget with its own
		// primitive-owned issues below — regression-testing that it is never absorbed into that widget's
		// own aggregate merely because the widgetId matches.
		const runtime = blueprint.createRuntime({ overrideStateDefaults: { root: { doesNotExist: 1 } } })

		return { runtime }
	}

	it('a Runtime-level state-override issue never appears in the same-widgetId widget\'s own aggregate', () => {
		const { runtime } = createMultiWidgetHarness()
		const rootWidget = runtime.getWidget('root')
		if (rootWidget === null)
			throw new Error('test fixture: expected the "root" widget to resolve')

		expect(rootWidget.getIssues())
			.toEqual([])
		expect(runtime.getIssues())
			.toHaveLength(1)
		expect(runtime.getIssues()[0]!.source)
			.toEqual({ type: 'state-override', widgetId: 'root', key: 'doesNotExist' })
	})

	it('collected order is Runtime-level issues first, then each widget in Blueprint semantic (pre-order) widget order', () => {
		const { runtime } = createMultiWidgetHarness()
		const widgetA = runtime.getWidget('a')
		const widgetB = runtime.getWidget('b')
		if (widgetA === null || widgetA.type !== 'leaf-a-probe' || widgetB === null || widgetB.type !== 'leaf-b-probe')
			throw new Error('test fixture: expected widgets "a" and "b" to resolve as their declared types')

		// Force both leaves to actually evaluate; a Property issue only exists after evaluation.
		widgetA.properties.flaky.get()
		widgetB.properties.flaky.get()

		const collected = runtime.getCollectedIssues()
		const runtimeLevel = runtime.getIssues()
		const aIssues = widgetA.getIssues()
		const bIssues = widgetB.getIssues()

		expect(runtimeLevel)
			.toHaveLength(1)
		expect(aIssues)
			.toHaveLength(1)
		expect(bIssues)
			.toHaveLength(1)

		expect(collected)
			.toEqual([...runtimeLevel, ...aIssues, ...bIssues])
		expect(collected[0])
			.toBe(runtimeLevel[0])
		expect(collected[1])
			.toBe(aIssues[0])
		expect(collected[2])
			.toBe(bIssues[0])
	})
})
