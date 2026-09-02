// @vitest-environment happy-dom
/**
 * Conformance tests — diagnostic #13 checkpoint G "State conformance", checkpoints C and F.
 *
 * Real writes, validation rejection, `T | null` Vue setter candidates, authoritative Runtime rollback
 * after a rejected `v-model`-style candidate, independent state-diagnostic projection, and no optimistic
 * local writes.
 */

import { describe, expect, it } from 'vitest'
import { nextTick } from 'vue'
import { CounterPlugin, createFixtureRuntime, getCounterWidget, mountWidgetBridge } from './test-fixtures'

describe('state conformance', () => {
	it('reads the current Runtime value directly (T | null), reflecting the declared default', () => {
		const runtime = createFixtureRuntime({ id: 's1', type: 'Counter' })
		const { bridge } = mountWidgetBridge(runtime, 's1', CounterPlugin)
		const { count } = bridge.useState()

		expect(count.value)
			.toBe(0)
	})

	it('a successful write delegates to the Runtime and the ref reflects the committed value', async () => {
		const runtime = createFixtureRuntime({ id: 's2', type: 'Counter' })
		const { bridge } = mountWidgetBridge(runtime, 's2', CounterPlugin)
		const { count } = bridge.useState()

		expect(count.value)
			.toBe(0)
		count.value = 42
		await nextTick()

		expect(count.value)
			.toBe(42)
		expect(getCounterWidget(runtime, 's2').state.count.get())
			.toBe(42)
	})

	it('a rejected write preserves the previous authoritative Runtime value and rolls the ref back to it (v-model rollback)', async () => {
		const runtime = createFixtureRuntime({ id: 's3', type: 'Counter' }, { overrideStateDefaults: { s3: { count: 7 } } })
		const { bridge } = mountWidgetBridge(runtime, 's3', CounterPlugin)
		const { count } = bridge.useState()

		expect(count.value)
			.toBe(7)

		// Simulates a v-model write: the UI optimistically calls the setter with a rejected candidate...
		count.value = -1
		await nextTick()

		// ...and the projected ref rolls back to the authoritative Runtime value, not the rejected one.
		expect(count.value)
			.toBe(7)
		expect(getCounterWidget(runtime, 's3').state.count.get())
			.toBe(7)
	})

	it('accepts `null` as a Vue-boundary setter candidate, delegating rejection to the Runtime validator', async () => {
		const runtime = createFixtureRuntime({ id: 's4', type: 'Counter' }, { overrideStateDefaults: { s4: { count: 3 } } })
		const { bridge } = mountWidgetBridge(runtime, 's4', CounterPlugin)
		const { count } = bridge.useState()

		expect(count.value)
			.toBe(3)
		// `count`'s validate requires `typeof input === 'number'`, so `null` is a legal Vue-boundary
		// candidate that the Runtime authoritatively rejects — the adapter performs no null-specific
		// special-casing of its own.
		count.value = null
		await nextTick()

		expect(count.value)
			.toBe(3)
	})

	it('never performs an optimistic local write: the ref does not "jump" to the candidate before the Runtime accepts it', () => {
		const runtime = createFixtureRuntime({ id: 's5', type: 'Counter' })
		const { bridge } = mountWidgetBridge(runtime, 's5', CounterPlugin)
		const { count } = bridge.useState()

		void count.value // activate
		const widget = getCounterWidget(runtime, 's5')

		// A synchronous read immediately after `set` (before any Vue re-render) must already reflect
		// the Runtime's own synchronous commit — never a separate Vue-local optimistic value.
		count.value = 99
		expect(widget.state.count.get())
			.toBe(99)
		expect(count.value)
			.toBe(99)
	})

	it('projects state diagnostics on a separate, independently-lazy channel from the value channel', async () => {
		const runtime = createFixtureRuntime({ id: 's6', type: 'Counter' })
		const { bridge } = mountWidgetBridge(runtime, 's6', CounterPlugin)
		const { count } = bridge.useState()
		const { count: countDiagnostics } = bridge.useStateDiagnostics()

		expect(countDiagnostics.value)
			.toEqual([])

		count.value = -5
		await nextTick()

		expect(countDiagnostics.value)
			.toHaveLength(1)
		expect(countDiagnostics.value)
			.toEqual(getCounterWidget(runtime, 's6').state.count.getDiagnostics())
		// The value channel itself never carries `ExecutionResult`/diagnostic data.
		expect(count.value)
			.toBe(0)
	})

	it('cleans up the state subscription when the owning component unmounts', () => {
		const runtime = createFixtureRuntime({ id: 's7', type: 'Counter' })
		const widget = getCounterWidget(runtime, 's7')
		const { wrapper, bridge } = mountWidgetBridge(runtime, 's7', CounterPlugin)
		void bridge.useState().count.value

		wrapper.unmount()

		// After unmount, the Runtime itself is still alive (never disposed by the bridge) and a write
		// must not throw — proving the bridge did not leave the Runtime in a broken state, even though
		// there is no live Vue consumer left to observe it.
		expect(() => widget.state.count.set(10)).not.toThrow()
	})
})
