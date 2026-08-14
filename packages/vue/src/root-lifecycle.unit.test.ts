// @vitest-environment happy-dom
/**
 * Conformance tests — issue #13 checkpoint G "Root lifecycle conformance", checkpoint E.
 *
 * Exact `WidgetSystem`-instance mismatch rejection, full rendered-subtree remount on Runtime identity
 * replacement (even for structurally identical root id/type), cleanup of every Vue bridge subscription,
 * and the root renderer never owning or auto-disposing the supplied Runtime.
 */

import { mount } from '@vue/test-utils'
import { describe, expect, it, vi } from 'vitest'
import { WidgetVueIntegrationError } from './errors'
import { createWidgetVueRenderer } from './renderer'
import {
	ContainerRenderer,
	CounterRenderer,
	createFixtureRuntime,
	createOtherFixtureRuntime,
	EmptyStateRenderer,
	fixtureSystem,
	getCounterWidget,
	LabelRenderer,
	LeafRenderer,
} from './test-fixtures'

const WidgetRenderer = createWidgetVueRenderer(fixtureSystem, renderers =>
	renderers
		.Counter(CounterRenderer)
		.Label(LabelRenderer)
		.Container(ContainerRenderer)
		.Leaf(LeafRenderer)
		.EmptyState(EmptyStateRenderer))

describe('root renderer lifecycle', () => {
	it('rejects a runtime from a different WidgetSystem instance, even one structurally identical to the bound system', () => {
		const runtime = createOtherFixtureRuntime({ id: 'root', type: 'Counter' })

		expect(() => mount(WidgetRenderer, { props: { runtime } }))
			.toThrow(WidgetVueIntegrationError)
	})

	it('accepts a runtime from the exact bound WidgetSystem instance', () => {
		const runtime = createFixtureRuntime({ id: 'root', type: 'Counter' })

		expect(() => mount(WidgetRenderer, { props: { runtime } })).not.toThrow()
	})

	it('fully unmounts and remounts the internal tree when the runtime prop identity changes, even with an identical root id/type', async () => {
		const runtimeA = createFixtureRuntime({ id: 'root', type: 'Counter' }, { overrideStateDefaults: { root: { count: 1 } } })
		const runtimeB = createFixtureRuntime({ id: 'root', type: 'Counter' }, { overrideStateDefaults: { root: { count: 2 } } })

		const widgetA = getCounterWidget(runtimeA, 'root')
		const originalSubscribe = widgetA.state.count.subscribe.bind(widgetA.state.count)
		const unsubscribeSpy = vi.fn()
		vi.spyOn(widgetA.state.count, 'subscribe')
			.mockImplementation((listener) => {
				const unsubscribe = originalSubscribe(listener)
				return () => {
					unsubscribeSpy()
					unsubscribe()
				}
			})

		const wrapper = mount(WidgetRenderer, { props: { runtime: runtimeA } })
		expect(wrapper.element.getAttribute('data-count'))
			.toBe('1')
		expect(unsubscribeSpy).not.toHaveBeenCalled()

		await wrapper.setProps({ runtime: runtimeB })

		// The old subtree (bound to runtimeA) was fully unmounted, cleaning up its subscription...
		expect(unsubscribeSpy)
			.toHaveBeenCalledTimes(1)
		// ...and a fresh subtree was mounted against runtimeB, not a patched update of the old one.
		expect(wrapper.element.getAttribute('data-count'))
			.toBe('2')
	})

	it('cleans up every Vue bridge subscription activated anywhere in the tree on unmount', () => {
		const runtime = createFixtureRuntime({ id: 'root', type: 'Counter' })
		const widget = getCounterWidget(runtime, 'root')

		const originalSubscribe = widget.properties.doubled.subscribe.bind(widget.properties.doubled)
		const unsubscribeSpy = vi.fn()
		vi.spyOn(widget.properties.doubled, 'subscribe')
			.mockImplementation((listener) => {
				const unsubscribe = originalSubscribe(listener)
				return () => {
					unsubscribeSpy()
					unsubscribe()
				}
			})

		const wrapper = mount(WidgetRenderer, { props: { runtime } })
		expect(unsubscribeSpy).not.toHaveBeenCalled()

		wrapper.unmount()
		expect(unsubscribeSpy)
			.toHaveBeenCalledTimes(1)
	})

	it('never calls runtime.dispose() on unmount', () => {
		const runtime = createFixtureRuntime({ id: 'root', type: 'Counter' })
		const disposeSpy = vi.spyOn(runtime, 'dispose')

		const wrapper = mount(WidgetRenderer, { props: { runtime } })
		wrapper.unmount()

		expect(disposeSpy).not.toHaveBeenCalled()
		expect(runtime.isDisposed)
			.toBe(false)
	})

	it('never calls runtime.dispose() on the old Runtime when the runtime prop is replaced', async () => {
		const runtimeA = createFixtureRuntime({ id: 'root', type: 'Counter' })
		const runtimeB = createFixtureRuntime({ id: 'root', type: 'Counter' })
		const disposeSpyA = vi.spyOn(runtimeA, 'dispose')

		const wrapper = mount(WidgetRenderer, { props: { runtime: runtimeA } })
		await wrapper.setProps({ runtime: runtimeB })

		expect(disposeSpyA).not.toHaveBeenCalled()
		expect(runtimeA.isDisposed)
			.toBe(false)

		wrapper.unmount()
		expect(disposeSpyA).not.toHaveBeenCalled()
	})
})
