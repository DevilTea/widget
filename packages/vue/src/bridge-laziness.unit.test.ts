// @vitest-environment happy-dom
/**
 * Conformance tests — issue #13 checkpoint G "Lazy bridge invariants" and checkpoint F.
 *
 * `useXxx()` never reads/subscribes; member access materializes/caches only that member's Vue
 * wrapper without activating it; the first `.value` read activates exactly one Runtime subscription;
 * subsequent reads reuse it; capability-surface and member identity are stable within one
 * `useWidget()` bridge scope; every activated subscription is cleaned up with the owning Vue scope.
 *
 * `useWidget(Plugin)` requires Vue's component injection (`inject()`), which in turn requires an
 * active component instance — a bare `effectScope()` is not enough; `mountWidgetBridge` (from
 * `test-fixtures.ts`) mounts a throwaway component to provide that context directly, bypassing the
 * full recursive renderer/registry, which `renderer-mounted.unit.test.ts` covers separately.
 */

import { describe, expect, it, vi } from 'vitest'
import { nextTick, watchEffect } from 'vue'
import { CounterPlugin, createFixtureRuntime, getCounterWidget, mountWidgetBridge } from './test-fixtures'

describe('lazy bridge invariants', () => {
	it('does not read or subscribe the Runtime merely by calling useState()/useProperties()/useMethods()', () => {
		const runtime = createFixtureRuntime({ id: 'w1', type: 'Counter' })
		const widget = getCounterWidget(runtime, 'w1')
		const getSpy = vi.spyOn(widget.state.count, 'get')
		const subscribeSpy = vi.spyOn(widget.state.count, 'subscribe')
		const propertyGetSpy = vi.spyOn(widget.properties.doubled, 'get')
		const propertySubscribeSpy = vi.spyOn(widget.properties.doubled, 'subscribe')

		const { bridge } = mountWidgetBridge(runtime, 'w1', CounterPlugin)
		bridge.useState()
		bridge.useProperties()
		bridge.useMethods()

		expect(getSpy).not.toHaveBeenCalled()
		expect(subscribeSpy).not.toHaveBeenCalled()
		expect(propertyGetSpy).not.toHaveBeenCalled()
		expect(propertySubscribeSpy).not.toHaveBeenCalled()
	})

	it('does not read or subscribe merely by accessing a member off the keyed surface', () => {
		const runtime = createFixtureRuntime({ id: 'w2', type: 'Counter' })
		const widget = getCounterWidget(runtime, 'w2')
		const subscribeSpy = vi.spyOn(widget.state.count, 'subscribe')

		const { bridge } = mountWidgetBridge(runtime, 'w2', CounterPlugin)
		const { count } = bridge.useState()
		expect(count)
			.toBeDefined()

		expect(subscribeSpy).not.toHaveBeenCalled()
	})

	it('activates exactly one Runtime subscription on the first `.value` read, and reuses it on subsequent reads', () => {
		const runtime = createFixtureRuntime({ id: 'w3', type: 'Counter' })
		const widget = getCounterWidget(runtime, 'w3')
		const subscribeSpy = vi.spyOn(widget.state.count, 'subscribe')

		const { bridge } = mountWidgetBridge(runtime, 'w3', CounterPlugin)
		const { count } = bridge.useState()

		expect(subscribeSpy).not.toHaveBeenCalled()
		void count.value
		expect(subscribeSpy)
			.toHaveBeenCalledTimes(1)
		void count.value
		void count.value
		expect(subscribeSpy)
			.toHaveBeenCalledTimes(1)
	})

	it('activates exactly one Runtime subscription per Property on first `.value` read', () => {
		const runtime = createFixtureRuntime({ id: 'w4', type: 'Counter' })
		const widget = getCounterWidget(runtime, 'w4')
		const subscribeSpy = vi.spyOn(widget.properties.doubled, 'subscribe')

		const { bridge } = mountWidgetBridge(runtime, 'w4', CounterPlugin)
		const { doubled } = bridge.useProperties()

		expect(subscribeSpy).not.toHaveBeenCalled()
		void doubled.value
		void doubled.value
		expect(subscribeSpy)
			.toHaveBeenCalledTimes(1)
	})

	it('activates exactly one Runtime issues-subscription for a state-member issue channel on first `.value` read, independently of the value channel', () => {
		const runtime = createFixtureRuntime({ id: 'w5', type: 'Counter' })
		const widget = getCounterWidget(runtime, 'w5')
		const stateSubscribeSpy = vi.spyOn(widget.state.count, 'subscribe')
		const subscribeIssuesSpy = vi.spyOn(widget.state.count, 'subscribeIssues')

		const { bridge } = mountWidgetBridge(runtime, 'w5', CounterPlugin)
		const { count } = bridge.useStateIssues()

		expect(subscribeIssuesSpy).not.toHaveBeenCalled()
		void count.value
		expect(subscribeIssuesSpy)
			.toHaveBeenCalledTimes(1)
		// Reading the issues channel never activates the unrelated value channel.
		expect(stateSubscribeSpy).not.toHaveBeenCalled()
		void count.value
		expect(subscribeIssuesSpy)
			.toHaveBeenCalledTimes(1)
	})

	it('activates the widget-level aggregate (`useIssues()`) lazily: no updates before first `.value` read, exactly one per issue-producing event once activated', async () => {
		// `RuntimeWidget` is a frozen object (per @deviltea/widget-core's contract), so its
		// `subscribeIssues` call count cannot be spied on directly; instead this asserts the
		// user-observable contract — exactly one notification per actual issue-producing event, no
		// missed updates and no duplicate over-firing — via a `watchEffect` over the projected ref.
		const runtime = createFixtureRuntime({ id: 'w5b', type: 'Counter' })
		const { bridge } = mountWidgetBridge(runtime, 'w5b', CounterPlugin)
		const issues = bridge.useIssues()

		const seenLengths: number[] = []
		const stop = watchEffect(() => {
			seenLengths.push(issues.value.length)
		})
		await nextTick()
		expect(seenLengths)
			.toEqual([0])

		// A rejected write produces exactly one state-validation issue owned by this widget.
		getCounterWidget(runtime, 'w5b').state.count.set(-1)
		await nextTick()
		expect(seenLengths)
			.toEqual([0, 1])

		stop()
	})

	it('keeps capability-surface identity and member identity stable within one useWidget() bridge scope', () => {
		const runtime = createFixtureRuntime({ id: 'w6', type: 'Counter' })
		const { bridge } = mountWidgetBridge(runtime, 'w6', CounterPlugin)

		expect(bridge.useState())
			.toBe(bridge.useState())
		expect(bridge.useProperties())
			.toBe(bridge.useProperties())
		expect(bridge.useMethods())
			.toBe(bridge.useMethods())

		const { count: countA } = bridge.useState()
		const { count: countB } = bridge.useState()
		expect(countA)
			.toBe(countB)

		const { doubled: doubledA } = bridge.useProperties()
		const { doubled: doubledB } = bridge.useProperties()
		expect(doubledA)
			.toBe(doubledB)

		const { increment: incrementA } = bridge.useMethods()
		const { increment: incrementB } = bridge.useMethods()
		expect(incrementA)
			.toBe(incrementB)

		expect(bridge.useStateIssues())
			.toBe(bridge.useStateIssues())
		expect(bridge.usePropertyIssues())
			.toBe(bridge.usePropertyIssues())
		expect(bridge.useMethodIssues())
			.toBe(bridge.useMethodIssues())
		expect(bridge.useIssues())
			.toBe(bridge.useIssues())
	})

	it('cleans up every activated subscription when the owning Vue component unmounts', () => {
		const runtime = createFixtureRuntime({ id: 'w7', type: 'Counter' })
		const widget = getCounterWidget(runtime, 'w7')

		const originalSubscribe = widget.state.count.subscribe.bind(widget.state.count)
		const unsubscribeSpy = vi.fn()
		vi.spyOn(widget.state.count, 'subscribe')
			.mockImplementation((listener) => {
				const unsubscribe = originalSubscribe(listener)
				return () => {
					unsubscribeSpy()
					unsubscribe()
				}
			})

		const { wrapper, bridge } = mountWidgetBridge(runtime, 'w7', CounterPlugin)
		void bridge.useState().count.value

		expect(unsubscribeSpy).not.toHaveBeenCalled()
		wrapper.unmount()
		expect(unsubscribeSpy)
			.toHaveBeenCalledTimes(1)
	})

	it('cleans up subscriptions activated across every member/channel touched in the scope, not just the first one', () => {
		const runtime = createFixtureRuntime({ id: 'w8', type: 'Counter' })
		const widget = getCounterWidget(runtime, 'w8')

		const spies = [
			wrapUnsubscribe(widget.state.count, 'subscribe'),
			wrapUnsubscribe(widget.properties.doubled, 'subscribe'),
			wrapUnsubscribe(widget.state.count, 'subscribeIssues'),
		]

		const { wrapper, bridge } = mountWidgetBridge(runtime, 'w8', CounterPlugin)
		void bridge.useState().count.value
		void bridge.useProperties().doubled.value
		void bridge.useStateIssues().count.value

		for (const spy of spies) expect(spy).not.toHaveBeenCalled()
		wrapper.unmount()
		for (const spy of spies) {
			expect(spy)
				.toHaveBeenCalledTimes(1)
		}

		function wrapUnsubscribe<T extends object, K extends keyof T>(target: T, key: K): ReturnType<typeof vi.fn> {
			const original = (target[key] as unknown as (...args: unknown[]) => () => void).bind(target)
			const unsubscribeSpy = vi.fn()
			vi.spyOn(target, key as never)
				.mockImplementation(((...args: unknown[]) => {
					const unsubscribe = original(...args)
					return () => {
						unsubscribeSpy()
						unsubscribe()
					}
				}) as never)
			return unsubscribeSpy
		}
	})
})
