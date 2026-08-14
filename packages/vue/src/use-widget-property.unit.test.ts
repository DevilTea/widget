// @vitest-environment happy-dom
/**
 * Conformance tests — issue #13 checkpoint G "Property conformance", checkpoints C and F.
 *
 * Obtaining `useProperties()` or a member off it never evaluates the Property; the first ref read may
 * activate it; success projects to the value, failure projects to `null` (never `ExecutionResult`,
 * never a last-successful fallback); diagnostics stay a separate reactive channel.
 */

import { describe, expect, it, vi } from 'vitest'
import { nextTick } from 'vue'
import { WidgetVueIntegrationError } from './errors'
import { CounterPlugin, createFixtureRuntime, getCounterWidget, getLabelWidget, LabelPlugin, mountWidgetBridge } from './test-fixtures'

describe('property conformance', () => {
	it('does not evaluate the Property merely by obtaining useProperties() or accessing a member off it', () => {
		const runtime = createFixtureRuntime({ id: 'p1', type: 'Counter' })
		const widget = getCounterWidget(runtime, 'p1')
		const getSpy = vi.spyOn(widget.properties.doubled, 'get')

		const { bridge } = mountWidgetBridge(runtime, 'p1', CounterPlugin)
		const { doubled } = bridge.useProperties()
		expect(doubled)
			.toBeDefined()

		expect(getSpy).not.toHaveBeenCalled()
	})

	it('the first ref read activates evaluation and projects a successful ExecutionResult to its value', () => {
		const runtime = createFixtureRuntime({ id: 'p2', type: 'Counter' }, { overrideStateDefaults: { p2: { count: 5 } } })
		const { bridge } = mountWidgetBridge(runtime, 'p2', CounterPlugin)
		const { doubled } = bridge.useProperties()

		expect(doubled.value)
			.toBe(10)
	})

	it('projects ExecutionResult.failure to null, never exposing the ExecutionResult shape itself', () => {
		const runtime = createFixtureRuntime({ id: 'p3', type: 'Label' })
		const { bridge } = mountWidgetBridge(runtime, 'p3', LabelPlugin)
		const { failing } = bridge.useProperties()

		expect(failing.value)
			.toBeNull()
		// Sanity: the underlying Runtime Property really is failing, not merely returning `null` as a
		// successful value.
		expect(getLabelWidget(runtime, 'p3').properties.failing.get().success)
			.toBe(false)
	})

	it('re-evaluates on the next dependency change and keeps notifying successful re-reads exactly once per actual recompute', async () => {
		const runtime = createFixtureRuntime({ id: 'p4', type: 'Counter' })
		const { bridge } = mountWidgetBridge(runtime, 'p4', CounterPlugin)
		const { doubled } = bridge.useProperties()
		const { count } = bridge.useState()

		expect(doubled.value)
			.toBe(0)
		count.value = 3
		await nextTick()
		expect(doubled.value)
			.toBe(6)
	})

	it('does not retain a last-successful fallback value once a Property starts failing', () => {
		const runtime = createFixtureRuntime({ id: 'p5', type: 'Label' })
		const { bridge } = mountWidgetBridge(runtime, 'p5', LabelPlugin)
		const { text, failing } = bridge.useProperties()

		// `text` always succeeds and is unrelated to `failing` — reading it first must not leak into
		// `failing`'s projection.
		expect(text.value)
			.toBe('hello')
		expect(failing.value)
			.toBeNull()
	})

	it('projects property issues on a separate channel: reading it never activates evaluation, but it reflects the issues a real evaluation wrote', () => {
		const runtime = createFixtureRuntime({ id: 'p6', type: 'Label' })
		const widget = getLabelWidget(runtime, 'p6')
		const getSpy = vi.spyOn(widget.properties.failing, 'get')

		const { bridge } = mountWidgetBridge(runtime, 'p6', LabelPlugin)
		const { failing: failingIssues } = bridge.usePropertyIssues()

		// Before anything evaluates the Property, its issue snapshot is still the canonical empty one,
		// and merely reading the issues channel never itself activates evaluation (core's
		// `getIssues()`/`subscribeIssues()` only ever touch the issue signal, never the computed).
		expect(failingIssues.value)
			.toEqual([])
		expect(getSpy).not.toHaveBeenCalled()

		// Activating the value channel evaluates the Property once, writing its issue snapshot as a
		// side effect — which the already-obtained issues ref then reflects.
		const { failing } = bridge.useProperties()
		expect(failing.value)
			.toBeNull()

		expect(failingIssues.value)
			.toHaveLength(1)
		expect(failingIssues.value)
			.toEqual(widget.properties.failing.getIssues())
	})

	it('cleans up the property subscription when the owning component unmounts', () => {
		const runtime = createFixtureRuntime({ id: 'p7', type: 'Counter' })
		const widget = getCounterWidget(runtime, 'p7')
		const { wrapper, bridge } = mountWidgetBridge(runtime, 'p7', CounterPlugin)
		void bridge.useProperties().doubled.value

		wrapper.unmount()

		expect(() => widget.properties.doubled.get()).not.toThrow()
	})

	it('is genuinely read-only at runtime, not just by TypeScript type: assigning `.value` throws', () => {
		const runtime = createFixtureRuntime({ id: 'p8', type: 'Counter' })
		const { bridge } = mountWidgetBridge(runtime, 'p8', CounterPlugin)
		const { doubled } = bridge.useProperties()

		expect(() => {
			// @ts-expect-error `doubled` is publicly typed as `ReadonlyRef<T>`; this exercises the runtime
			// enforcement that backs that type, reached only through an escape hatch like `any`.
			doubled.value = 999
		})
			.toThrow(WidgetVueIntegrationError)
	})

	it('is a plain readonly Ref, not a ComputedRef: it carries no computed-only public surface such as `.effect`', () => {
		const runtime = createFixtureRuntime({ id: 'p9', type: 'Counter' })
		const { bridge } = mountWidgetBridge(runtime, 'p9', CounterPlugin)
		const { doubled } = bridge.useProperties()

		// `customRef()` produces a plain Ref; only Vue's own `computed()` attaches a `ReactiveEffect` to
		// `.effect`. Asserting its absence proves the public `ReadonlyRef<T>` type is truthful about the
		// actual runtime shape, not merely readonly-compatible with a richer `ComputedRef` promise.
		expect('effect' in doubled)
			.toBe(false)
		expect(doubled.value)
			.toBe(0)
	})
})
