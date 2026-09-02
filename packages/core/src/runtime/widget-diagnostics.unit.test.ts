/**
 * Conformance tests for `RuntimeWidget.getDiagnostics()`/`subscribeDiagnostics()` — diagnostic #10 amendment
 * "RuntimeWidget aggregate diagnostic surface" (discovery context: diagnostic #13 comment "Core gap discovered by
 * Widget Lab — RuntimeWidget diagnostic aggregation").
 *
 * Scope: a `RuntimeWidget` aggregates only the current diagnostics owned by its own primitives — state
 * members -> property members -> method members, plugin declaration order within each capability, each
 * primitive's own local diagnostic order preserved — and never Runtime-level diagnostics, even when a
 * Runtime-level diagnostic's source happens to carry the same `widgetId`. `runtime.getDiagnostics()`
 * composes `runtime.getDiagnostics()` (Runtime-level only) plus each `RuntimeWidget.getDiagnostics()` in Blueprint
 * semantic widget order.
 *
 * Only the public entry (`../index`) is imported; no internal module or `blueprintInternals` access.
 */

import { describe, expect, it, vi } from 'vitest'
import { createWidgetPlugin, createWidgetSystem, EMPTY_DIAGNOSTICS, WidgetSystemRuntimeDisposedError } from '../index'

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
	let propertyTwoDoubleDiagnostic = false
	let propertyOneShouldFail = false
	let methodTwoShouldFail = false
	let methodOneShouldFail = false
	let lazyComputeCount = 0

	const plugin = createWidgetPlugin('order-probe')
		.description('Test widget')
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
				compute: ({ addDiagnostic }) => {
					if (propertyTwoShouldFail)
						addDiagnostic({ message: 'property two failed' })
					if (propertyTwoDoubleDiagnostic)
						addDiagnostic({ message: 'property two failed again' })
					return 0
				},
			})
			.one({
				compute: ({ addDiagnostic }) => {
					if (propertyOneShouldFail)
						addDiagnostic({ message: 'property one failed' })
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
				execute: ({ addDiagnostic }) => {
					if (methodTwoShouldFail)
						addDiagnostic({ message: 'method two failed' })
					return 0
				},
			})
			.one({
				validateArgs: (args): args is [] => args.length === 0,
				execute: ({ addDiagnostic }) => {
					if (methodOneShouldFail)
						addDiagnostic({ message: 'method one failed' })
					return 0
				},
			}))
		.done()

	const system = createWidgetSystem({ plugins: [plugin] })
	const blueprint = system.createBlueprint({ id: 'root', type: 'order-probe' })
	if (blueprint.status !== 'valid')
		throw new Error(`test fixture: expected a valid blueprint, got diagnostics: ${JSON.stringify(blueprint.diagnostics)}`)

	const runtime = blueprint.createRuntime()
	const widget = runtime.getWidget('root')
	if (widget === null)
		throw new Error('test fixture: expected the "root" widget to resolve')

	return {
		runtime,
		widget,
		lazyComputeCount: () => lazyComputeCount,
		setPropertyTwoShouldFail: (value: boolean) => { propertyTwoShouldFail = value },
		setPropertyTwoDoubleDiagnostic: (value: boolean) => { propertyTwoDoubleDiagnostic = value },
		setPropertyOneShouldFail: (value: boolean) => { propertyOneShouldFail = value },
		setMethodTwoShouldFail: (value: boolean) => { methodTwoShouldFail = value },
		setMethodOneShouldFail: (value: boolean) => { methodOneShouldFail = value },
	}
}

describe('runtimeWidget.getDiagnostics() — canonical empty aggregate', () => {
	it('a widget with every primitive currently succeeding aggregates to the canonical EMPTY_DIAGNOSTICS reference', () => {
		const { widget } = createOrderHarness()

		expect(widget.getDiagnostics())
			.toBe(EMPTY_DIAGNOSTICS)
	})
})

describe('runtimeWidget.getDiagnostics() — deterministic aggregate order', () => {
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

		const diagnostics = widget.getDiagnostics()

		expect(diagnostics.map(diagnostic => diagnostic.code))
			.toEqual([
				'invalid-state-value',
				'invalid-state-value',
				'invalid-property-result',
				'invalid-property-result',
				'invalid-method-result',
				'invalid-method-result',
			])

		// "two" was declared before "one" in every capability; the aggregate must not silently sort by
		// key/name.
		const memberOf = (diagnostic: (typeof diagnostics)[number]) => diagnostic.location.type === 'state' ? diagnostic.location.key : diagnostic.location.name
		expect(diagnostics.map(memberOf))
			.toEqual(['two', 'one', 'two', 'one', 'two', 'one'])

		// Every aggregated diagnostic is the exact same frozen object the owning primitive itself reports —
		// aggregation reuses references, it never copies.
		expect(diagnostics[0])
			.toBe(widget.state.two.getDiagnostics()[0])
		expect(diagnostics[2])
			.toBe(widget.properties.two.getDiagnostics()[0])
		expect(diagnostics[4])
			.toBe(widget.methods.two.getDiagnostics()[0])
	})

	it('preserves one primitive\'s own local diagnostic order inside the widget aggregate', () => {
		const { widget, setPropertyTwoShouldFail, setPropertyTwoDoubleDiagnostic } = createOrderHarness()

		setPropertyTwoShouldFail(true)
		setPropertyTwoDoubleDiagnostic(true)
		widget.properties.two.get()

		const localDiagnostics = widget.properties.two.getDiagnostics()
		expect(localDiagnostics.map(diagnostic => diagnostic.message))
			.toEqual(['property two failed', 'property two failed again'])

		expect(widget.getDiagnostics()
			.map(diagnostic => diagnostic.message))
			.toEqual(['property two failed', 'property two failed again'])
	})
})

describe('runtimeWidget.getDiagnostics() — widgets without every capability', () => {
	it('a widget declaring only properties aggregates just its property diagnostics', () => {
		interface PropsOnlyInterfaces {
			properties: {
				flaky: number
			}
		}

		let shouldFail = false
		const plugin = createWidgetPlugin('props-only-probe')
			.description('Test widget')
			.interfaces<PropsOnlyInterfaces>()
			.properties(properties => properties.flaky({
				compute: ({ addDiagnostic }) => {
					if (shouldFail)
						addDiagnostic({ message: 'flaky failed' })
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

		expect(widget.getDiagnostics())
			.toBe(EMPTY_DIAGNOSTICS)

		shouldFail = true
		widget.properties.flaky.get()

		expect(widget.getDiagnostics()
			.map(diagnostic => diagnostic.code))
			.toEqual(['invalid-property-result'])
	})

	it('a widget declaring no capabilities at all still exposes getDiagnostics()/subscribeDiagnostics(), aggregating to the canonical empty array', () => {
		const plugin = createWidgetPlugin('capability-less-probe')
			.description('Test widget')
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

		expect(widget.getDiagnostics())
			.toBe(EMPTY_DIAGNOSTICS)
		expect(() => widget.subscribeDiagnostics(() => {})())
			.not.toThrow()
	})
})

describe('runtimeWidget.getDiagnostics()/subscribeDiagnostics() laziness', () => {
	it('never activates a lazy Property evaluation', () => {
		const { widget, lazyComputeCount } = createOrderHarness()

		widget.getDiagnostics()
		expect(lazyComputeCount())
			.toBe(0)

		const listener = vi.fn()
		const unsubscribe = widget.subscribeDiagnostics(listener)
		expect(lazyComputeCount())
			.toBe(0)
		expect(listener)
			.not.toHaveBeenCalled()

		unsubscribe()
	})
})

describe('runtimeWidget.subscribeDiagnostics()', () => {
	it('does not emit immediately on subscribe', () => {
		const { widget } = createOrderHarness()
		const listener = vi.fn()

		widget.subscribeDiagnostics(listener)

		expect(listener)
			.not.toHaveBeenCalled()
	})

	it('emits on a state diagnostic change, a property diagnostic change produced by natural evaluation, and a method invocation diagnostic change, then stops after unsubscribe', () => {
		const { widget, setPropertyTwoShouldFail, setMethodTwoShouldFail } = createOrderHarness()
		const snapshotLengths: number[] = []
		const unsubscribe = widget.subscribeDiagnostics(diagnostics => snapshotLengths.push(diagnostics.length))

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

describe('runtimeWidget.getDiagnostics() / runtime.getDiagnostics() — aggregate snapshot immutability', () => {
	it('a non-empty widget aggregate array is itself frozen and rejects an external push', () => {
		const { widget, setPropertyTwoShouldFail } = createOrderHarness()
		setPropertyTwoShouldFail(true)
		widget.properties.two.get()

		const diagnostics = widget.getDiagnostics()
		expect(Object.isFrozen(diagnostics))
			.toBe(true)
		expect(() => (diagnostics as unknown as unknown[]).push({ source: { type: 'forged' }, message: 'forged' }))
			.toThrow(TypeError)
	})

	it('a non-empty runtime.getDiagnostics() array is itself frozen and rejects an external push', () => {
		const { runtime, widget, setPropertyTwoShouldFail } = createOrderHarness()
		setPropertyTwoShouldFail(true)
		widget.properties.two.get()

		const collected = runtime.getDiagnostics()
		expect(Object.isFrozen(collected))
			.toBe(true)
		expect(() => (collected as unknown as unknown[]).push({ source: { type: 'forged' }, message: 'forged' }))
			.toThrow(TypeError)
	})

	it('a caller mutation attempt (rejected by the freeze above) never leaks a forged diagnostic into a later widget or runtime read', () => {
		const { runtime, widget, setPropertyTwoShouldFail } = createOrderHarness()
		setPropertyTwoShouldFail(true)
		widget.properties.two.get()

		const diagnostics = widget.getDiagnostics()
		const fake = { source: { type: 'forged' }, message: 'forged' }
		expect(() => (diagnostics as unknown as unknown[]).push(fake))
			.toThrow(TypeError)

		expect(widget.getDiagnostics())
			.not.toContain(fake)
		expect(runtime.getDiagnostics())
			.not.toContain(fake)
	})

	it('each aggregated diagnostic stays frozen — inherited from the owning primitive\'s own immutable snapshot', () => {
		const { widget } = createOrderHarness()
		widget.state.two.set('nope' as unknown as number)

		const diagnostic = widget.getDiagnostics()[0]!
		expect(Object.isFrozen(diagnostic))
			.toBe(true)
		expect(() => {
			(diagnostic as unknown as Record<string, unknown>).message = 'forged'
		})
			.toThrow(TypeError)
	})
})

describe('runtimeWidget.getDiagnostics()/subscribeDiagnostics() post-dispose contract', () => {
	it('getDiagnostics() throws WidgetSystemRuntimeDisposedError after dispose', () => {
		const { runtime, widget } = createOrderHarness()
		runtime.dispose()

		expect(() => widget.getDiagnostics())
			.toThrow(WidgetSystemRuntimeDisposedError)
	})

	it('subscribeDiagnostics() (new subscription) throws WidgetSystemRuntimeDisposedError after dispose', () => {
		const { runtime, widget } = createOrderHarness()
		runtime.dispose()

		expect(() => widget.subscribeDiagnostics(() => {}))
			.toThrow(WidgetSystemRuntimeDisposedError)
	})

	it('an unsubscribe handle obtained before dispose stays a safe idempotent no-op afterward', () => {
		const { runtime, widget } = createOrderHarness()
		const unsubscribe = widget.subscribeDiagnostics(() => {})

		runtime.dispose()

		expect(() => unsubscribe()).not.toThrow()
		expect(() => unsubscribe()).not.toThrow()
	})
})

describe('runtimeWidget.subscribeDiagnostics() external listener exception isolation', () => {
	it('a throwing listener does not block another listener on the same propagation, and its throw surfaces outside the current flush', async () => {
		const { widget } = createOrderHarness()
		const secondSnapshotLengths: number[] = []
		const captured: unknown[] = []
		const onUncaughtException = (error: unknown): void => {
			captured.push(error)
		}

		widget.subscribeDiagnostics(() => {
			throw new Error('first listener boom')
		})
		widget.subscribeDiagnostics(diagnostics => secondSnapshotLengths.push(diagnostics.length))

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
// Runtime-wide composition: runtime-level diagnostics + widget aggregates in Blueprint semantic order.
// -------------------------------------------------------------------------------------------------

describe('runtime.getDiagnostics() composes runtime-level diagnostics + each RuntimeWidget.getDiagnostics()', () => {
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
		.description('Test widget')
		.interfaces<LeafInterfaces>()
		.properties(properties => properties.flaky({
			compute: ({ addDiagnostic }) => {
				addDiagnostic({ message: 'leaf-a-probe flaky failed' })
				return 0
			},
		}))
		.done()

	const leafBPlugin = createWidgetPlugin('leaf-b-probe')
		.description('Test widget')
		.interfaces<LeafInterfaces>()
		.properties(properties => properties.flaky({
			compute: ({ addDiagnostic }) => {
				addDiagnostic({ message: 'leaf-b-probe flaky failed' })
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
		.description('Test widget')
		.interfaces<ContainerInterfaces>()
		.slots({ children: { description: 'Test slot' } })
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
			throw new Error(`test fixture: expected a valid blueprint, got diagnostics: ${JSON.stringify(blueprint.diagnostics)}`)

		// An unknown state key on the known "root" widget produces a Runtime-level diagnostic whose location
		// stays at the Runtime boundary — the same id as a real widget with its own
		// primitive-owned diagnostics below — regression-testing that it is never absorbed into that widget's
		// own aggregate merely because the widgetId matches.
		const runtime = blueprint.createRuntime({ overrideStateDefaults: { root: { doesNotExist: 1 } } })

		return { runtime }
	}

	it('a Runtime-level state-override diagnostic never appears in the same-widgetId widget\'s own aggregate', () => {
		const { runtime } = createMultiWidgetHarness()
		const rootWidget = runtime.getWidget('root')
		if (rootWidget === null)
			throw new Error('test fixture: expected the "root" widget to resolve')

		expect(rootWidget.getDiagnostics())
			.toEqual([])
		expect(runtime.getDiagnostics())
			.toHaveLength(1)
		expect(runtime.getDiagnostics()[0]!)
			.toMatchObject({ code: 'unknown-state-override-member', location: { type: 'runtime' }, path: ['root', 'doesNotExist'] })
	})

	it('collected order is Runtime-level diagnostics first, then each widget in Blueprint semantic (pre-order) widget order', () => {
		const { runtime } = createMultiWidgetHarness()
		const widgetA = runtime.getWidget('a')
		const widgetB = runtime.getWidget('b')
		if (widgetA === null || widgetA.type !== 'leaf-a-probe' || widgetB === null || widgetB.type !== 'leaf-b-probe')
			throw new Error('test fixture: expected widgets "a" and "b" to resolve as their declared types')

		// Force both leaves to actually evaluate; a Property diagnostic only exists after evaluation.
		widgetA.properties.flaky.get()
		widgetB.properties.flaky.get()

		const collected = runtime.getDiagnostics()
		const runtimeLevel = runtime.getDiagnostics()
			.filter(diagnostic => diagnostic.location.type === 'runtime')
		const aDiagnostics = widgetA.getDiagnostics()
		const bDiagnostics = widgetB.getDiagnostics()

		expect(runtimeLevel)
			.toHaveLength(1)
		expect(aDiagnostics)
			.toHaveLength(1)
		expect(bDiagnostics)
			.toHaveLength(1)

		expect(collected)
			.toEqual([...runtimeLevel, ...aDiagnostics, ...bDiagnostics])
		expect(collected[0])
			.toBe(runtimeLevel[0])
		expect(collected[1])
			.toBe(aDiagnostics[0])
		expect(collected[2])
			.toBe(bDiagnostics[0])
	})
})
