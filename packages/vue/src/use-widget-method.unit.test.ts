// @vitest-environment happy-dom
/**
 * Conformance tests — diagnostic #13 checkpoint G "Method conformance", checkpoints C addendum and F.
 *
 * `useMethods()` exposes lazy stable callable wrappers (not refs, no subscription); semantic ok
 * projects to the returned value; semantic failure projects to `null`; implementation-contract
 * exceptions propagate unchanged; special JavaScript member names such as `then` receive no
 * Vue-layer special handling.
 */

import { describe, expect, it } from 'vitest'
import { CounterPlugin, createFixtureRuntime, getCounterWidget, mountWidgetBridge } from './test-fixtures'

describe('method conformance', () => {
	it('projects a successful invocation to its returned value', () => {
		const runtime = createFixtureRuntime({ id: 'm1', type: 'Counter' })
		const { bridge } = mountWidgetBridge(runtime, 'm1', CounterPlugin)
		const { increment } = bridge.useMethods()

		expect(increment(5))
			.toBe(5)
		expect(increment(2))
			.toBe(7)
	})

	it('projects a semantic failure to null, never exposing the ExecutionResult shape itself', () => {
		const runtime = createFixtureRuntime({ id: 'm2', type: 'Counter' })
		const { bridge } = mountWidgetBridge(runtime, 'm2', CounterPlugin)
		const { increment } = bridge.useMethods()

		// `validateArgs` requires exactly one numeric argument; this call fails validation.
		// @ts-expect-error deliberately calling with the wrong arity to exercise the failure path
		const result = increment()
		expect(result)
			.toBeNull()
	})

	it('propagates implementation-contract exceptions unchanged instead of converting them to null', () => {
		const runtime = createFixtureRuntime({ id: 'm3', type: 'Counter' })
		const { bridge } = mountWidgetBridge(runtime, 'm3', CounterPlugin)
		const { crash } = bridge.useMethods()

		expect(() => crash())
			.toThrow('crash() always throws — an implementation exception, not an Diagnostic.')
	})

	it('propagates disposed-Runtime exceptions unchanged', () => {
		const runtime = createFixtureRuntime({ id: 'm4', type: 'Counter' })
		const { bridge } = mountWidgetBridge(runtime, 'm4', CounterPlugin)
		const { increment } = bridge.useMethods()

		runtime.dispose()
		expect(() => increment(1))
			.toThrow()
	})

	it('gives special JavaScript member names like `then` no special handling — it is a plain callable wrapper', () => {
		const runtime = createFixtureRuntime({ id: 'm5', type: 'Counter' })
		const { bridge } = mountWidgetBridge(runtime, 'm5', CounterPlugin)
		const { then } = bridge.useMethods()

		expect(typeof then)
			.toBe('function')
		expect(then())
			.toBe('not-a-promise')
	})

	it('exposes stable callable identity within one useWidget() bridge scope, with no subscription created', () => {
		const runtime = createFixtureRuntime({ id: 'm6', type: 'Counter' })
		const widget = getCounterWidget(runtime, 'm6')
		const { bridge } = mountWidgetBridge(runtime, 'm6', CounterPlugin)

		const { increment: incrementA } = bridge.useMethods()
		const { increment: incrementB } = bridge.useMethods()
		expect(incrementA)
			.toBe(incrementB)

		// Methods are plain callables, not refs: nothing about calling them subscribes anything.
		expect('value' in incrementA)
			.toBe(false)
		void widget
	})

	it('projects method diagnostics on a separate reactive channel, independent of the callable itself', () => {
		const runtime = createFixtureRuntime({ id: 'm7', type: 'Counter' })
		const { bridge } = mountWidgetBridge(runtime, 'm7', CounterPlugin)
		const { increment } = bridge.useMethods()
		const { increment: incrementDiagnostics } = bridge.useMethodDiagnostics()

		expect(incrementDiagnostics.value)
			.toEqual([])
		// @ts-expect-error deliberately calling with the wrong arity to produce a method-args diagnostic
		increment()

		expect(incrementDiagnostics.value)
			.toHaveLength(1)
		expect(incrementDiagnostics.value)
			.toEqual(getCounterWidget(runtime, 'm7').methods.increment.getDiagnostics())
	})
})
