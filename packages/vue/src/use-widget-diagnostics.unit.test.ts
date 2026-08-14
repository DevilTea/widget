// @vitest-environment happy-dom
/**
 * Conformance tests — issue #13 checkpoint G "Diagnostics conformance", checkpoint D.
 *
 * `useStateIssues()`, `usePropertyIssues()`, `useMethodIssues()`, and `useIssues()` preserve core
 * snapshots/order/objects exactly, remain independently lazy, and never reclassify or parse messages.
 * `useIssues()` mirrors `RuntimeWidget.getIssues()`/`subscribeIssues()` — the widget-level aggregate,
 * not the Runtime-wide `getCollectedIssues()`.
 */

import { describe, expect, it } from 'vitest'
import { nextTick } from 'vue'
import { WidgetVueIntegrationError } from './errors'
import { CounterPlugin, createFixtureRuntime, getCounterWidget, getLabelWidget, LabelPlugin, mountWidgetBridge } from './test-fixtures'

describe('diagnostics conformance', () => {
	it('preserves the exact issue snapshot objects and order returned by the Runtime for a state member', async () => {
		const runtime = createFixtureRuntime({ id: 'd1', type: 'Counter' })
		const widget = getCounterWidget(runtime, 'd1')
		const { bridge } = mountWidgetBridge(runtime, 'd1', CounterPlugin)
		const { count } = bridge.useStateIssues()

		widget.state.count.set(-1)
		await nextTick()

		const coreSnapshot = widget.state.count.getIssues()
		expect(count.value)
			.toBe(coreSnapshot)
		expect(count.value[0]!.source.type)
			.toBe('state-validation')
	})

	it('preserves the exact issue snapshot for a property member', () => {
		const runtime = createFixtureRuntime({ id: 'd2', type: 'Label' })
		const widget = getLabelWidget(runtime, 'd2')
		const { bridge } = mountWidgetBridge(runtime, 'd2', LabelPlugin)

		// Activate evaluation once so the Property's issue signal is actually written.
		void bridge.useProperties().failing.value

		const { failing } = bridge.usePropertyIssues()
		const coreSnapshot = widget.properties.failing.getIssues()
		expect(failing.value)
			.toBe(coreSnapshot)
		expect(failing.value[0]!.source.type)
			.toBe('property-result')
	})

	it('preserves the exact issue snapshot for a method member', async () => {
		const runtime = createFixtureRuntime({ id: 'd3', type: 'Counter' })
		const widget = getCounterWidget(runtime, 'd3')
		const { bridge } = mountWidgetBridge(runtime, 'd3', CounterPlugin)
		const { increment } = bridge.useMethodIssues()

		const incrementCallable = bridge.useMethods().increment
		// @ts-expect-error deliberately calling with the wrong arity to produce a method-args issue
		incrementCallable()
		await nextTick()

		const coreSnapshot = widget.methods.increment.getIssues()
		expect(increment.value)
			.toBe(coreSnapshot)
		expect(increment.value[0]!.source.type)
			.toBe('method-args')
	})

	it('every member issue channel is independently lazy: reading one never populates or activates another', () => {
		const runtime = createFixtureRuntime({ id: 'd4', type: 'Counter' })
		const { bridge } = mountWidgetBridge(runtime, 'd4', CounterPlugin)
		const { count } = bridge.useStateIssues()
		const { increment } = bridge.useMethodIssues()

		expect(count.value)
			.toEqual([])
		// Reading `count`'s issues must not have any bearing on `increment`'s, which was never touched.
		expect(increment.value)
			.toEqual([])
	})

	it('useIssues() mirrors RuntimeWidget.getIssues()/subscribeIssues() — the widget-level aggregate, exactly', async () => {
		const runtime = createFixtureRuntime({ id: 'd5', type: 'Counter' })
		const widget = getCounterWidget(runtime, 'd5')
		const { bridge } = mountWidgetBridge(runtime, 'd5', CounterPlugin)
		const issues = bridge.useIssues()

		expect(issues.value)
			.toEqual([])

		widget.state.count.set(-1)
		await nextTick()

		expect(issues.value)
			.toEqual(widget.getIssues())
		expect(issues.value)
			.toHaveLength(1)
		expect(issues.value[0]!.source.type)
			.toBe('state-validation')
	})

	it('useIssues() aggregates across every capability that owns an issue, in the widget aggregate order state -> properties -> methods', async () => {
		const runtime = createFixtureRuntime({ id: 'd6', type: 'Counter' })
		const widget = getCounterWidget(runtime, 'd6')
		const { bridge } = mountWidgetBridge(runtime, 'd6', CounterPlugin)
		const issues = bridge.useIssues()

		widget.state.count.set(-1)
		// @ts-expect-error deliberately calling with the wrong arity to produce a method-args issue
		widget.methods.increment()
		await nextTick()

		expect(issues.value)
			.toEqual(widget.getIssues())
		expect(issues.value.map(issue => issue.source.type))
			.toEqual(['state-validation', 'method-args'])
	})

	it('never reclassifies or parses issue messages: the message string is forwarded verbatim', () => {
		const runtime = createFixtureRuntime({ id: 'd7', type: 'Counter' })
		const widget = getCounterWidget(runtime, 'd7')
		const { bridge } = mountWidgetBridge(runtime, 'd7', CounterPlugin)
		const { count } = bridge.useStateIssues()

		widget.state.count.set(-1)

		expect(count.value[0]!.message)
			.toBe(widget.state.count.getIssues()[0]!.message)
	})

	it('every issue channel is genuinely read-only at runtime, not just by TypeScript type', () => {
		const runtime = createFixtureRuntime({ id: 'd8', type: 'Counter' })
		const { bridge } = mountWidgetBridge(runtime, 'd8', CounterPlugin)
		const { count } = bridge.useStateIssues()

		expect(() => {
			// @ts-expect-error `count` is publicly typed as `ReadonlyRef<T>`; this exercises the runtime
			// enforcement that backs that type, reached only through an escape hatch like `any`.
			count.value = []
		})
			.toThrow(WidgetVueIntegrationError)
	})

	it('issue refs are plain readonly Refs, not ComputedRefs: no computed-only public surface such as `.effect`', () => {
		const runtime = createFixtureRuntime({ id: 'd9', type: 'Counter' })
		const { bridge } = mountWidgetBridge(runtime, 'd9', CounterPlugin)
		const { count } = bridge.useStateIssues()
		const issues = bridge.useIssues()

		expect('effect' in count)
			.toBe(false)
		expect('effect' in issues)
			.toBe(false)
	})
})
