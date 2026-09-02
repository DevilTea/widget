// @vitest-environment happy-dom
/**
 * Conformance tests — diagnostic #13 checkpoint G "Diagnostics conformance", checkpoint D.
 *
 * `useStateDiagnostics()`, `usePropertyDiagnostics()`, `useMethodDiagnostics()`, and `useDiagnostics()` preserve core
 * snapshots/order/objects exactly, remain independently lazy, and never reclassify or parse messages.
 * `useDiagnostics()` mirrors `RuntimeWidget.getDiagnostics()`/`subscribeDiagnostics()` — the widget-level aggregate,
 * not the Runtime-wide `getDiagnostics()`.
 */

import { describe, expect, it } from 'vitest'
import { nextTick } from 'vue'
import { WidgetVueIntegrationError } from './errors'
import { CounterPlugin, createFixtureRuntime, getCounterWidget, getLabelWidget, LabelPlugin, mountWidgetBridge } from './test-fixtures'

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

	it('every member diagnostic channel is independently lazy: reading one never populates or activates another', () => {
		const runtime = createFixtureRuntime({ id: 'd4', type: 'Counter' })
		const { bridge } = mountWidgetBridge(runtime, 'd4', CounterPlugin)
		const { count } = bridge.useStateDiagnostics()
		const { increment } = bridge.useMethodDiagnostics()

		expect(count.value)
			.toEqual([])
		// Reading `count`'s diagnostics must not have any bearing on `increment`'s, which was never touched.
		expect(increment.value)
			.toEqual([])
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

	it('useDiagnostics() aggregates across every capability that owns an diagnostic, in the widget aggregate order state -> properties -> methods', async () => {
		const runtime = createFixtureRuntime({ id: 'd6', type: 'Counter' })
		const widget = getCounterWidget(runtime, 'd6')
		const { bridge } = mountWidgetBridge(runtime, 'd6', CounterPlugin)
		const diagnostics = bridge.useDiagnostics()

		widget.state.count.set(-1)
		// @ts-expect-error deliberately calling with the wrong arity to produce a method-args diagnostic
		widget.methods.increment()
		await nextTick()

		expect(diagnostics.value)
			.toEqual(widget.getDiagnostics())
		expect(diagnostics.value.map(diagnostic => diagnostic.code))
			.toEqual(['invalid-state-value', 'invalid-method-arguments'])
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
