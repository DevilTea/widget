// @vitest-environment happy-dom
/**
 * Conformance tests — diagnostic #13 checkpoint G "Diagnostics conformance", checkpoint D.
 *
 * `useStateDiagnostics()`, `usePropertyDiagnostics()`, `useMethodDiagnostics()`, and `useDiagnostics()` preserve core
 * snapshots/order/objects exactly, remain independently lazy, and never reclassify or parse messages.
 * `useDiagnostics()` mirrors `RuntimeWidget.getDiagnostics()`/`subscribeDiagnostics()` — the widget-level aggregate,
 * not the Runtime-wide `getDiagnostics()`.
 */

import type { WidgetInterfaces } from '@deviltea/widget-core'
import { createWidgetPlugin, createWidgetSystem } from '@deviltea/widget-core'
import { describe, expect, it, vi } from 'vitest'
import { nextTick, watchEffect } from 'vue'
import { WidgetVueIntegrationError } from './errors'
import { CounterPlugin, createFixtureRuntime, getCounterWidget, getLabelWidget, LabelPlugin, mountWidgetBridge } from './test-fixtures'

/**
 * The shared `LabelPlugin` intentionally has only Properties so the absent-capability tests can use it
 * as a real comparison fixture. This separate real Core plugin keeps the same failing Label Property
 * while declaring State and Method too, allowing one RuntimeWidget aggregate to prove all three slices
 * and their canonical order without changing that existing fixture contract.
 */
interface AggregateLabelInterfaces extends WidgetInterfaces {
	state: {
		count: number
	}
	properties: {
		failing: string
	}
	methods: {
		increment: (step: number) => number
	}
}

const AggregateLabelPlugin = createWidgetPlugin('Label')
	.description('All-capability Label aggregate fixture')
	.interfaces<AggregateLabelInterfaces>()
	.state(state => state.count({
		validate: (input): input is number => typeof input === 'number' && input >= 0,
		default: () => 0,
	}))
	.properties(properties => properties.failing({
		compute: ({ addDiagnostic }) => {
			addDiagnostic({ message: 'aggregate Label property failed' })
			return ''
		},
	}))
	.methods(methods => methods.increment({
		validateArgs: (args): args is [number] => args.length === 1 && typeof args[0] === 'number',
		execute: ({ args: [step] }) => step,
	}))
	.done()

const aggregateLabelSystem = createWidgetSystem({ plugins: [AggregateLabelPlugin] as const })

describe('diagnostics conformance', () => {
	it('preserves the exact diagnostic snapshot objects and order returned by the Runtime for a state member', async () => {
		const runtime = createFixtureRuntime({ id: 'd1', type: 'Counter' })
		const widget = getCounterWidget(runtime, 'd1')
		const { bridge } = mountWidgetBridge(runtime, 'd1', CounterPlugin)
		const { count } = bridge.useStateDiagnostics()

		widget.state.count.set(-1)
		await nextTick()

		const coreSnapshot = widget.state.count.getDiagnostics()
		expect(count.value)
			.toBe(coreSnapshot)
		expect(count.value[0]!.code)
			.toBe('invalid-state-value')
	})

	it('preserves the exact diagnostic snapshot for a property member', () => {
		const runtime = createFixtureRuntime({ id: 'd2', type: 'Label' })
		const widget = getLabelWidget(runtime, 'd2')
		const { bridge } = mountWidgetBridge(runtime, 'd2', LabelPlugin)

		// Activate evaluation once so the Property's diagnostic signal is actually written.
		void bridge.useProperties().failing.value

		const { failing } = bridge.usePropertyDiagnostics()
		const coreSnapshot = widget.properties.failing.getDiagnostics()
		expect(failing.value)
			.toBe(coreSnapshot)
		expect(failing.value[0]!.code)
			.toBe('invalid-property-result')
	})

	it('subscribes property diagnostics lazily on first read, reactively invalidates on diagnostic changes, and unsubscribes on unmount', async () => {
		const runtime = createFixtureRuntime({ id: 'd-prop-lifecycle', type: 'Label' })
		const widget = getLabelWidget(runtime, 'd-prop-lifecycle')
		const originalSubscribe = widget.properties.failing.subscribeDiagnostics.bind(widget.properties.failing)
		const unsubscribeSpy = vi.fn()
		const subscribeSpy = vi.spyOn(widget.properties.failing, 'subscribeDiagnostics')
			.mockImplementation((listener) => {
				const unsubscribe = originalSubscribe(listener)
				return () => {
					unsubscribeSpy()
					unsubscribe()
				}
			})

		const { wrapper, bridge } = mountWidgetBridge(runtime, 'd-prop-lifecycle', LabelPlugin)
		const { failing: failingDiagnostics } = bridge.usePropertyDiagnostics()

		// Obtaining the channel must NOT subscribe
		expect(subscribeSpy).not.toHaveBeenCalled()

		// Set up reactive watcher
		const seenDiagnosticLengths: number[] = []
		const stop = watchEffect(() => {
			seenDiagnosticLengths.push(failingDiagnostics.value.length)
		})
		await nextTick()

		// First read inside the watcher activates lazy subscription
		expect(subscribeSpy)
			.toHaveBeenCalledTimes(1)
		expect(unsubscribeSpy).not.toHaveBeenCalled()
		expect(seenDiagnosticLengths)
			.toEqual([0])

		// Activating the property evaluation adds a real diagnostic in Core,
		// which notifies property.subscribeDiagnostics and triggers reactive invalidation of failingDiagnostics
		expect(bridge.useProperties().failing.value)
			.toBeNull()
		await nextTick()

		expect(seenDiagnosticLengths)
			.toEqual([0, 1])
		expect(failingDiagnostics.value[0]?.code)
			.toBe('invalid-property-result')

		stop()
		wrapper.unmount()
		expect(unsubscribeSpy)
			.toHaveBeenCalledTimes(1)
	})

	it('preserves the exact diagnostic snapshot for a method member', async () => {
		const runtime = createFixtureRuntime({ id: 'd3', type: 'Counter' })
		const widget = getCounterWidget(runtime, 'd3')
		const { bridge } = mountWidgetBridge(runtime, 'd3', CounterPlugin)
		const { increment } = bridge.useMethodDiagnostics()

		const incrementCallable = bridge.useMethods().increment
		// @ts-expect-error deliberately calling with the wrong arity to produce a method-args diagnostic
		incrementCallable()
		await nextTick()

		const coreSnapshot = widget.methods.increment.getDiagnostics()
		expect(increment.value)
			.toBe(coreSnapshot)
		expect(increment.value[0]!.code)
			.toBe('invalid-method-arguments')
	})

	it('keeps State and Method diagnostic channels independently lazy with distinct snapshots and cleanup', () => {
		const runtime = createFixtureRuntime({ id: 'd4', type: 'Counter' })
		const widget = getCounterWidget(runtime, 'd4')
		const originalStateSubscribe = widget.state.count.subscribeDiagnostics.bind(widget.state.count)
		const originalMethodSubscribe = widget.methods.increment.subscribeDiagnostics.bind(widget.methods.increment)
		const stateUnsubscribeSpy = vi.fn()
		const methodUnsubscribeSpy = vi.fn()
		const stateSubscribeSpy = vi.spyOn(widget.state.count, 'subscribeDiagnostics')
			.mockImplementation((listener) => {
				const unsubscribe = originalStateSubscribe(listener)
				return () => {
					stateUnsubscribeSpy()
					unsubscribe()
				}
			})
		const methodSubscribeSpy = vi.spyOn(widget.methods.increment, 'subscribeDiagnostics')
			.mockImplementation((listener) => {
				const unsubscribe = originalMethodSubscribe(listener)
				return () => {
					methodUnsubscribeSpy()
					unsubscribe()
				}
			})

		const { wrapper, bridge } = mountWidgetBridge(runtime, 'd4', CounterPlugin)
		const { count: stateDiagnostics } = bridge.useStateDiagnostics()
		const { increment: methodDiagnostics } = bridge.useMethodDiagnostics()

		// Produce two different real Core diagnostics before either Vue channel is read.
		widget.state.count.set(-1)
		// @ts-expect-error deliberately calling with the wrong arity to produce a method-args diagnostic
		widget.methods.increment()

		expect(stateSubscribeSpy).not.toHaveBeenCalled()
		expect(methodSubscribeSpy).not.toHaveBeenCalled()
		expect(stateDiagnostics.value.map(diagnostic => diagnostic.code))
			.toEqual(['invalid-state-value'])
		expect(stateSubscribeSpy)
			.toHaveBeenCalledTimes(1)
		expect(methodSubscribeSpy).not.toHaveBeenCalled()
		expect(methodDiagnostics.value.map(diagnostic => diagnostic.code))
			.toEqual(['invalid-method-arguments'])
		expect(methodSubscribeSpy)
			.toHaveBeenCalledTimes(1)

		wrapper.unmount()
		expect(stateUnsubscribeSpy)
			.toHaveBeenCalledTimes(1)
		expect(methodUnsubscribeSpy)
			.toHaveBeenCalledTimes(1)
	})

	it('useDiagnostics() mirrors RuntimeWidget.getDiagnostics()/subscribeDiagnostics() — the widget-level aggregate, exactly', async () => {
		const runtime = createFixtureRuntime({ id: 'd5', type: 'Counter' })
		const widget = getCounterWidget(runtime, 'd5')
		const { bridge } = mountWidgetBridge(runtime, 'd5', CounterPlugin)
		const diagnostics = bridge.useDiagnostics()

		expect(diagnostics.value)
			.toEqual([])

		widget.state.count.set(-1)
		await nextTick()

		expect(diagnostics.value)
			.toEqual(widget.getDiagnostics())
		expect(diagnostics.value)
			.toHaveLength(1)
		expect(diagnostics.value[0]!.code)
			.toBe('invalid-state-value')
	})

	it('useDiagnostics() includes a real failing Label Property between State and Method diagnostics in canonical order', async () => {
		const blueprint = aggregateLabelSystem.createBlueprint({ id: 'd6', type: 'Label' })
		if (blueprint.status !== 'valid')
			throw new Error(`test fixture: expected a valid aggregate Label blueprint, got ${JSON.stringify(blueprint.diagnostics)}`)

		const runtime = blueprint.createRuntime()
		const widget = runtime.getWidget('d6')
		if (widget === null)
			throw new Error('test fixture: expected the aggregate Label widget to resolve')

		const { bridge } = mountWidgetBridge(runtime, 'd6', AggregateLabelPlugin)
		const diagnostics = bridge.useDiagnostics()

		// Activate the actual failing Label Property so its diagnostic enters the RuntimeWidget aggregate.
		expect(bridge.useProperties().failing.value)
			.toBeNull()
		bridge.useState().count.value = -1
		const { increment } = bridge.useMethods()
		// @ts-expect-error deliberately calling with the wrong arity to produce a method-args diagnostic
		increment()
		await nextTick()

		const coreSnapshot = widget.getDiagnostics()
		expect(coreSnapshot.map(diagnostic => diagnostic.code))
			.toEqual(['invalid-state-value', 'invalid-property-result', 'invalid-method-arguments'])
		expect(diagnostics.value)
			.toBe(coreSnapshot)
	})

	it('never reclassifies or parses diagnostic messages: the message string is forwarded verbatim', () => {
		const runtime = createFixtureRuntime({ id: 'd7', type: 'Counter' })
		const widget = getCounterWidget(runtime, 'd7')
		const { bridge } = mountWidgetBridge(runtime, 'd7', CounterPlugin)
		const { count } = bridge.useStateDiagnostics()

		widget.state.count.set(-1)

		expect(count.value[0]!.message)
			.toBe(widget.state.count.getDiagnostics()[0]!.message)
	})

	it('every diagnostic channel is genuinely read-only at runtime, not just by TypeScript type', () => {
		const runtime = createFixtureRuntime({ id: 'd8', type: 'Counter' })
		const { bridge } = mountWidgetBridge(runtime, 'd8', CounterPlugin)
		const { count } = bridge.useStateDiagnostics()

		expect(() => {
			// @ts-expect-error `count` is publicly typed as `ReadonlyRef<T>`; this exercises the runtime
			// enforcement that backs that type, reached only through an escape hatch like `any`.
			count.value = []
		})
			.toThrow(WidgetVueIntegrationError)
	})

	it('diagnostic refs are plain readonly Refs, not ComputedRefs: no computed-only public surface such as `.effect`', () => {
		const runtime = createFixtureRuntime({ id: 'd9', type: 'Counter' })
		const { bridge } = mountWidgetBridge(runtime, 'd9', CounterPlugin)
		const { count } = bridge.useStateDiagnostics()
		const diagnostics = bridge.useDiagnostics()

		expect('effect' in count)
			.toBe(false)
		expect('effect' in diagnostics)
			.toBe(false)
	})
})
