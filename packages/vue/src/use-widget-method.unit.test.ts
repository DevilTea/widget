// @vitest-environment happy-dom
/**
 * Conformance tests — diagnostic #13 checkpoint G "Method conformance", checkpoints C addendum and F.
 *
 * `useMethods()` exposes lazy stable callable wrappers (not refs, no subscription); semantic ok
 * projects to the returned value; semantic failure projects to `null`; implementation-contract
 * exceptions propagate unchanged; special JavaScript member names such as `then` receive no
 * Vue-layer special handling.
 */

import { createWidgetPlugin, createWidgetSystem, WidgetSystemRuntimeDisposedError } from '@deviltea/widget-core'
import { describe, expect, it, vi } from 'vitest'
import { COUNTER_CRASH_ERROR, CounterPlugin, createFixtureRuntime, getCounterWidget, mountWidgetBridge } from './test-fixtures'

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

		let thrown: unknown
		try {
			crash()
		}
		catch (error) {
			thrown = error
		}

		expect(thrown)
			.toBe(COUNTER_CRASH_ERROR)
	})

	it('propagates disposed-Runtime exceptions unchanged', () => {
		const runtime = createFixtureRuntime({ id: 'm4', type: 'Counter' })
		const { bridge } = mountWidgetBridge(runtime, 'm4', CounterPlugin)
		const { increment } = bridge.useMethods()

		runtime.dispose()

		let thrown: unknown
		try {
			increment(1)
		}
		catch (error) {
			thrown = error
		}

		expect(thrown)
			.toBeInstanceOf(WidgetSystemRuntimeDisposedError)
		expect(thrown)
			.toMatchObject({
				name: 'WidgetSystemRuntimeDisposedError',
				code: 'runtime-disposed',
			})
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
		const subscribeDiagnosticsSpy = vi.spyOn(widget.methods.increment, 'subscribeDiagnostics')
		const { bridge } = mountWidgetBridge(runtime, 'm6', CounterPlugin)

		const { increment: incrementA } = bridge.useMethods()
		const { increment: incrementB } = bridge.useMethods()
		expect(incrementA)
			.toBe(incrementB)

		// Methods are plain callables, not refs: nothing about calling them subscribes anything.
		expect('value' in incrementA)
			.toBe(false)
		expect(subscribeDiagnosticsSpy).not.toHaveBeenCalled()
		expect(incrementA(1))
			.toBe(1)
		expect(subscribeDiagnosticsSpy).not.toHaveBeenCalled()
	})

	it('materializes method wrappers without invoking, reading, or subscribing to the Runtime primitive', () => {
		const invocationSpy = vi.fn((args: readonly unknown[]) => args.length === 1 && typeof args[0] === 'number')
		const invocationPlugin = createWidgetPlugin('InvocationProbe')
			.description('Runtime method invocation probe')
			.interfaces<{ methods: { increment: (step: number) => number } }>()
			.methods(methods => methods.increment({
				validateArgs: (args): args is [number] => invocationSpy(args),
				execute: ({ args: [step] }) => step,
			}))
			.done()
		const system = createWidgetSystem({ plugins: [invocationPlugin] })
		const blueprint = system.createBlueprint({ id: 'm8', type: 'InvocationProbe' })
		if (blueprint.status !== 'valid')
			throw new Error(`Invalid invocation probe blueprint: ${JSON.stringify(blueprint.diagnostics)}`)
		const runtime = blueprint.createRuntime()
		const widget = runtime.getWidget('m8')
		if (widget === null || widget.methods === undefined)
			throw new Error('Invocation probe fixture did not produce a method surface.')
		const getDiagnosticsSpy = vi.spyOn(widget.methods.increment, 'getDiagnostics')
		const subscribeDiagnosticsSpy = vi.spyOn(widget.methods.increment, 'subscribeDiagnostics')
		const { bridge } = mountWidgetBridge(runtime, 'm8', invocationPlugin)

		const { increment } = bridge.useMethods()
		expect(typeof increment)
			.toBe('function')
		expect(invocationSpy).not.toHaveBeenCalled()
		expect(getDiagnosticsSpy).not.toHaveBeenCalled()
		expect(subscribeDiagnosticsSpy).not.toHaveBeenCalled()

		expect(increment(1))
			.toBe(1)
		expect(invocationSpy)
			.toHaveBeenCalledTimes(1)
		expect(invocationSpy)
			.toHaveBeenCalledWith([1])
		expect(getDiagnosticsSpy).not.toHaveBeenCalled()
		expect(subscribeDiagnosticsSpy).not.toHaveBeenCalled()
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
