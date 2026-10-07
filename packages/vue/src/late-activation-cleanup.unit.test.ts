// @vitest-environment happy-dom
/**
 * Regression tests — a Runtime subscription lazily activated by the first `.value` read AFTER the
 * owning Vue scope was disposed (e.g. a ref captured in setup and read from a `setTimeout` after
 * unmount) must not leak. The late read still returns the current Runtime value, and every
 * subscription it created is released.
 *
 * Methods and events never subscribe (callable wrapper / lazily-acquired emitter), so they have no
 * activation to leak and are not covered here.
 */

import { describe, expect, it, vi } from 'vitest'
import { CounterPlugin, createFixtureRuntime, getCounterWidget, mountWidgetBridge } from './test-fixtures'

/** Counts subscribe calls and the unsubscribe calls they hand back. */
function trackSubscriptions<T extends object, K extends keyof T>(target: T, key: K) {
	const original = (target[key] as unknown as (...args: unknown[]) => () => void).bind(target)
	const counts = { subscribed: 0, unsubscribed: 0 }
	vi.spyOn(target, key as never)
		.mockImplementation(((...args: unknown[]) => {
			counts.subscribed++
			const unsubscribe = original(...args)
			return () => {
				counts.unsubscribed++
				unsubscribe()
			}
		}) as never)
	return counts
}

describe('late activation after scope disposal', () => {
	it('releases a state subscription first activated after unmount and still returns the current value', () => {
		const runtime = createFixtureRuntime({ id: 'late1', type: 'Counter' })
		const widget = getCounterWidget(runtime, 'late1')
		const counts = trackSubscriptions(widget.state.count, 'subscribe')

		const { wrapper, bridge } = mountWidgetBridge(runtime, 'late1', CounterPlugin)
		const { count } = bridge.useState()
		wrapper.unmount()
		expect(counts.subscribed)
			.toBe(0)

		widget.state.count.set(7)
		expect(count.value)
			.toBe(7)
		expect(counts)
			.toEqual({ subscribed: 1, unsubscribed: 1 })

		// Later reads keep returning the live Runtime value without re-subscribing.
		widget.state.count.set(9)
		expect(count.value)
			.toBe(9)
		expect(counts)
			.toEqual({ subscribed: 1, unsubscribed: 1 })
	})

	it('releases a property subscription first activated after unmount and still returns the current value', () => {
		const runtime = createFixtureRuntime({ id: 'late2', type: 'Counter' })
		const widget = getCounterWidget(runtime, 'late2')
		const counts = trackSubscriptions(widget.properties.doubled, 'subscribe')

		const { wrapper, bridge } = mountWidgetBridge(runtime, 'late2', CounterPlugin)
		const { doubled } = bridge.useProperties()
		wrapper.unmount()

		widget.state.count.set(4)
		expect(doubled.value)
			.toBe(8)
		expect(counts)
			.toEqual({ subscribed: 1, unsubscribed: 1 })
	})

	it('releases state and property diagnostics subscriptions first activated after unmount', () => {
		const runtime = createFixtureRuntime({ id: 'late3', type: 'Counter' })
		const widget = getCounterWidget(runtime, 'late3')
		const stateCounts = trackSubscriptions(widget.state.count, 'subscribeDiagnostics')
		const propertyCounts = trackSubscriptions(widget.properties.doubled, 'subscribeDiagnostics')

		const { wrapper, bridge } = mountWidgetBridge(runtime, 'late3', CounterPlugin)
		const stateDiagnostics = bridge.useStateDiagnostics().count
		const propertyDiagnostics = bridge.usePropertyDiagnostics().doubled
		wrapper.unmount()

		expect(stateDiagnostics.value)
			.toEqual(widget.state.count.getDiagnostics())
		expect(propertyDiagnostics.value)
			.toEqual(widget.properties.doubled.getDiagnostics())
		expect(stateCounts)
			.toEqual({ subscribed: 1, unsubscribed: 1 })
		expect(propertyCounts)
			.toEqual({ subscribed: 1, unsubscribed: 1 })
	})

	it('still reads the current widget-level diagnostics after unmount', () => {
		// `RuntimeWidget` is frozen, so its subscribeDiagnostics cannot be spied on; this pins that the
		// late read returns the live Runtime snapshot (the release itself shares the same code path).
		const runtime = createFixtureRuntime({ id: 'late4', type: 'Counter' })
		const { wrapper, bridge } = mountWidgetBridge(runtime, 'late4', CounterPlugin)
		const diagnostics = bridge.useDiagnostics()
		wrapper.unmount()

		expect(diagnostics.value)
			.toHaveLength(0)
		getCounterWidget(runtime, 'late4').state.count.set(-1)
		expect(diagnostics.value)
			.toHaveLength(1)
	})
})
