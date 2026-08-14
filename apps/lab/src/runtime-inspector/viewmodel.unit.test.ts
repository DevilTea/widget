/**
 * Runtime Inspector view model tests against a real `@deviltea/widget-core` Runtime (no mocked core —
 * repo testing policy). Covers issue #13 Phase 5 "Runtime Inspector becomes strictly passive": passive
 * rendering from `getSnapshot()`, notification-driven updates, zero Property activation from merely
 * opening/subscribing the inspector, and subscription cleanup.
 */

import type { InspectionObservable } from '@deviltea/widget-core/inspection'
import { createWidgetPlugin, createWidgetSystem } from '@deviltea/widget-core'
import { inspectRuntime } from '@deviltea/widget-core/inspection'
import { describe, expect, it, vi } from 'vitest'
import { createPropertyMemberViewModel, createStateMemberViewModel } from './viewmodel'

interface FixtureInterfaces {
	state: { count: number }
	properties: { computed: number }
}

function createFixture(computeSpy: () => void) {
	const plugin = createWidgetPlugin('viewmodel-fixture')
		.interfaces<FixtureInterfaces>()
		.state(state => state.count({
			validate: (input): input is number => typeof input === 'number',
			default: () => 0,
		}))
		.properties(properties => properties.computed({
			compute: () => {
				computeSpy()
				return 42
			},
		}))
		.done()

	const system = createWidgetSystem({ plugins: [plugin] })
	const blueprint = system.createBlueprint({ id: 'root', type: 'viewmodel-fixture' })
	if (blueprint.status !== 'valid')
		throw new Error('test fixture: expected a valid Blueprint')
	const runtime = blueprint.createRuntime()

	const runtimeInspection = inspectRuntime(runtime)
	const widgetInspection = runtimeInspection.getWidget(runtimeInspection.blueprint.rootNodeId)!

	return { runtime, widgetInspection }
}

/**
 * Counts calls to the *real* core `subscribe()`/its returned unsubscribe function, delegating every
 * call straight through — not a substitute for core behavior, just an observation point on it.
 */
function spyObservable<T>(observable: InspectionObservable<T>) {
	let subscribeCalls = 0
	let unsubscribeCalls = 0
	const wrapped: InspectionObservable<T> = {
		getSnapshot: () => observable.getSnapshot(),
		subscribe: (listener) => {
			subscribeCalls++
			const rawUnsubscribe = observable.subscribe(listener)
			return () => {
				unsubscribeCalls++
				rawUnsubscribe()
			}
		},
	}
	return { wrapped, counts: () => ({ subscribeCalls, unsubscribeCalls }) }
}

describe('createStateMemberViewModel', () => {
	it('renders the passive snapshot from getSnapshot() without any subscription', () => {
		const { widgetInspection } = createFixture(() => {})
		const vm = createStateMemberViewModel(widgetInspection.getState('count')!)
		expect(vm.getSnapshot())
			.toEqual({ value: 0 })
	})

	it('updates via subscribe() notifications when a real Runtime consumer mutates State', () => {
		const { runtime, widgetInspection } = createFixture(() => {})
		const vm = createStateMemberViewModel(widgetInspection.getState('count')!)

		const listener = vi.fn()
		vm.subscribe(listener)
		expect(vm.getSnapshot())
			.toEqual({ value: 0 })

		runtime.getWidget('root')!.state.count.set(5)

		expect(listener)
			.toHaveBeenCalledTimes(1)
		expect(vm.getSnapshot())
			.toEqual({ value: 5 })
	})

	it('shares one underlying subscription across listeners and unsubscribes only once every listener is gone', () => {
		const { runtime, widgetInspection } = createFixture(() => {})
		const { wrapped, counts } = spyObservable(widgetInspection.getState('count')!)
		const vm = createStateMemberViewModel(wrapped)

		const unsubscribeA = vm.subscribe(() => {})
		const unsubscribeB = vm.subscribe(() => {})
		expect(counts())
			.toEqual({ subscribeCalls: 1, unsubscribeCalls: 0 })

		unsubscribeA()
		expect(counts())
			.toEqual({ subscribeCalls: 1, unsubscribeCalls: 0 })

		unsubscribeB()
		expect(counts())
			.toEqual({ subscribeCalls: 1, unsubscribeCalls: 1 })

		// Panel/snapshot-replacement scope disposal must not error when called again.
		runtime.getWidget('root')!.state.count.set(1)
		vm.dispose()
	})

	it('dispose() tears down the subscription and stops delivering further notifications', () => {
		const { runtime, widgetInspection } = createFixture(() => {})
		const { wrapped, counts } = spyObservable(widgetInspection.getState('count')!)
		const vm = createStateMemberViewModel(wrapped)

		const listener = vi.fn()
		vm.subscribe(listener)
		vm.dispose()
		expect(counts())
			.toEqual({ subscribeCalls: 1, unsubscribeCalls: 1 })

		runtime.getWidget('root')!.state.count.set(9)
		expect(listener).not.toHaveBeenCalled()
	})
})

describe('createPropertyMemberViewModel', () => {
	it('renders "never-evaluated" and never activates the Property just by opening/subscribing the inspector', () => {
		const computeSpy = vi.fn()
		const { widgetInspection } = createFixture(computeSpy)
		const vm = createPropertyMemberViewModel(widgetInspection.getProperty('computed')!)

		expect(vm.getSnapshot())
			.toEqual({ status: 'never-evaluated' })
		expect(computeSpy)
			.toHaveBeenCalledTimes(0)

		const listener = vi.fn()
		vm.subscribe(listener)
		expect(vm.getSnapshot())
			.toEqual({ status: 'never-evaluated' })
		expect(computeSpy)
			.toHaveBeenCalledTimes(0)
	})

	it('reflects the latest completed ExecutionResult once a real Runtime consumer evaluates it, via notification', () => {
		const computeSpy = vi.fn()
		const { runtime, widgetInspection } = createFixture(computeSpy)
		const vm = createPropertyMemberViewModel(widgetInspection.getProperty('computed')!)

		const listener = vi.fn()
		vm.subscribe(listener)

		const result = runtime.getWidget('root')!.properties.computed.get()
		expect(result)
			.toEqual({ success: true, value: 42 })
		expect(computeSpy)
			.toHaveBeenCalledTimes(1)

		expect(listener)
			.toHaveBeenCalledTimes(1)
		expect(vm.getSnapshot())
			.toEqual({ status: 'completed', result: { success: true, value: 42 } })
	})
})
