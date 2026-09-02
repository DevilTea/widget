/**
 * Conformance coverage for the `RuntimeState` primitive — diagnostic #10 COMMENT 26 §8 (State), COMMENT 15
 * ("RuntimeState subscription semantics aligned to alien-signals") and consolidated handoff §13.
 */

import { describe, expect, it, vi } from 'vitest'
import { createWidgetPlugin, createWidgetSystem, EMPTY_DIAGNOSTICS } from '../index'

interface CounterInterfaces {
	state: {
		count: number
	}
}

function createCounterRuntime(params: {
	validate?: (input: unknown) => boolean
	default?: () => number
} = {}) {
	const validate = params.validate ?? ((input: unknown): boolean => typeof input === 'number')

	const plugin = createWidgetPlugin('counter')
		.description('Test widget')
		.interfaces<CounterInterfaces>()
		.state(section => section.count({
			validate: (input): input is number => validate(input),
			...(params.default === undefined ? {} : { default: params.default }),
		}))
		.done()

	const system = createWidgetSystem({ plugins: [plugin] })
	const blueprint = system.createBlueprint({ id: 'root', type: 'counter' })

	if (blueprint.status !== 'valid')
		throw new Error('expected a valid blueprint')

	const runtime = blueprint.createRuntime()
	const widget = runtime.getWidget('root') as any

	return { runtime, state: widget.state.count as {
		get: () => number | null
		set: (value: number) => { ok: boolean, value?: number, diagnostics?: readonly unknown[] }
		subscribe: (listener: (value: number | null) => void) => () => void
		getDiagnostics: () => readonly { source: unknown }[]
		subscribeDiagnostics: (listener: (diagnostics: readonly unknown[]) => void) => () => void
	} }
}

describe('runtimeState — valid/invalid set + diagnostic snapshot (diagnostic #10 §8/§13)', () => {
	it('a valid set commits the value and clears diagnostics to the canonical empty snapshot', () => {
		const { state } = createCounterRuntime({ default: () => 0 })

		const result = state.set(5)

		expect(result)
			.toEqual({ ok: true, value: 5 })
		expect(state.get())
			.toBe(5)
		expect(state.getDiagnostics())
			.toBe(EMPTY_DIAGNOSTICS)
	})

	it('an invalid set replaces the latest diagnostic snapshot and reports failure', () => {
		const { state } = createCounterRuntime({ default: () => 0 })

		const result = state.set('not-a-number' as any)

		expect(result.ok)
			.toBe(false)
		expect((result as any).failure.diagnostics)
			.toHaveLength(1)
		expect((result as any).failure.diagnostics[0])
			.toMatchObject({ code: 'invalid-state-value', location: { type: 'state', widgetId: 'root', key: 'count' }, candidate: 'not-a-number' })
		expect(state.getDiagnostics())
			.toEqual((result as any).failure.diagnostics)
	})

	it('a failed write leaves the value signal untouched', () => {
		const { state } = createCounterRuntime({ default: () => 5 })

		expect(state.get())
			.toBe(5)

		const result = state.set('nope' as any)

		expect(result.ok)
			.toBe(false)
		expect(state.get())
			.toBe(5)
	})

	it('two consecutive successful writes both read back the identical canonical empty-diagnostics reference', () => {
		const { state } = createCounterRuntime({ default: () => 0 })

		state.set(1)
		const first = state.getDiagnostics()
		state.set(2)
		const second = state.getDiagnostics()

		expect(first)
			.toBe(EMPTY_DIAGNOSTICS)
		expect(second)
			.toBe(EMPTY_DIAGNOSTICS)
		expect(first)
			.toBe(second)
	})

	it('a same-value write succeeds but does not notify the value subscriber', () => {
		const { state } = createCounterRuntime({ default: () => 3 })
		const listener = vi.fn()
		state.subscribe(listener)

		const result = state.set(3)

		expect(result)
			.toEqual({ ok: true, value: 3 })
		expect(listener).not.toHaveBeenCalled()
	})

	it('regression: NaN -> NaN counts as changed (strict `!==`) and notifies the subscriber', () => {
		const { state } = createCounterRuntime()

		state.set(Number.NaN)
		const listener = vi.fn()
		state.subscribe(listener)

		state.set(Number.NaN)

		expect(listener)
			.toHaveBeenCalledTimes(1)
		expect(listener)
			.toHaveBeenCalledWith(Number.NaN)
	})

	it('regression: +0 -> -0 counts as unchanged and does not notify the subscriber', () => {
		const { state } = createCounterRuntime()

		state.set(0)
		const listener = vi.fn()
		state.subscribe(listener)

		state.set(-0)

		expect(listener).not.toHaveBeenCalled()
		expect(state.get())
			.toBe(0)
	})

	it('subscribe has no immediate emission', () => {
		const { state } = createCounterRuntime({ default: () => 1 })
		const listener = vi.fn()

		state.subscribe(listener)

		expect(listener).not.toHaveBeenCalled()
	})

	it('an diagnostic-only change (failed write) does not notify the value subscriber', () => {
		const { state } = createCounterRuntime({ default: () => 1 })
		const valueListener = vi.fn()
		const diagnosticsListener = vi.fn()
		state.subscribe(valueListener)
		state.subscribeDiagnostics(diagnosticsListener)

		state.set('not-a-number' as any)

		expect(valueListener).not.toHaveBeenCalled()
		expect(diagnosticsListener)
			.toHaveBeenCalledTimes(1)
	})

	it('unsubscribe stops further notifications', () => {
		const { state } = createCounterRuntime({ default: () => 1 })
		const listener = vi.fn()
		const unsubscribe = state.subscribe(listener)

		state.set(2)
		expect(listener)
			.toHaveBeenCalledTimes(1)

		unsubscribe()
		state.set(3)

		expect(listener)
			.toHaveBeenCalledTimes(1)
	})
})
