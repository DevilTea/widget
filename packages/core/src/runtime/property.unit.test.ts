/**
 * Conformance tests for `RuntimeProperty` — diagnostic #10 COMMENT 26 §8 (Property section).
 *
 * Normative source: consolidated handoff §14 (`RuntimeProperty`), §12 (dependency-failure 1:1
 * wrapping), COMMENT 4 (`ExecutionResult` / Property subscription semantics).
 */

import { describe, expect, it, vi } from 'vitest'
import { createWidgetPlugin, createWidgetSystem } from '../index'

interface CounterInterfaces {
	state: {
		count: number
	}
	properties: {
		doubled: number
		parity: number
		flaky: number
		viaFlaky: number
		viaDoubledRefined: number
	}
}

function createHarness() {
	let doubledComputeCount = 0
	let parityComputeCount = 0
	let flakyComputeCount = 0
	let viaFlakyComputeCount = 0
	let viaDoubledRefinedComputeCount = 0
	let flakyShouldFail = false

	const plugin = createWidgetPlugin('counter')
		.description('Test widget')
		.interfaces<CounterInterfaces>()
		.state(state => state
			.count({
				validate: (input): input is number => typeof input === 'number',
				default: () => 0,
			}))
		.properties(properties => properties
			.doubled({
				registerDeps: ({ dep }) => ({ count: dep.self.state.get('count') }),
				compute: ({ deps }) => {
					doubledComputeCount++
					const result = deps.count()
					return result.ok ? (result.value ?? 0) * 2 : -1
				},
			})
			.parity({
				registerDeps: ({ dep }) => ({ count: dep.self.state.get('count') }),
				compute: ({ deps }) => {
					parityComputeCount++
					const result = deps.count()
					return result.ok ? (result.value ?? 0) % 2 : -1
				},
			})
			.flaky({
				compute: ({ addDiagnostic }) => {
					flakyComputeCount++
					if (flakyShouldFail)
						addDiagnostic({ message: 'flaky failed' })
					return 0
				},
			})
			.viaFlaky({
				registerDeps: ({ dep }) => ({ flaky: dep.self.properties.get('flaky') }),
				compute: ({ deps }) => {
					viaFlakyComputeCount++
					const result = deps.flaky()
					return result.ok ? result.value ?? 0 : -1
				},
			})
			.viaDoubledRefined({
				registerDeps: ({ dep }) => ({
					doubled: dep.self.properties.get('doubled')
						.validate((_value): _value is never => false),
				}),
				compute: ({ deps }) => {
					viaDoubledRefinedComputeCount++
					const result = deps.doubled()
					return result.ok ? 0 : -1
				},
			}))
		.done()

	const system = createWidgetSystem({ plugins: [plugin] })
	const blueprint = system.createBlueprint({ id: 'root', type: 'counter' })

	if (blueprint.status !== 'valid')
		throw new Error(`Expected a valid blueprint, got diagnostics: ${JSON.stringify(blueprint.diagnostics)}`)

	const runtime = blueprint.createRuntime()
	const widget = runtime.getWidget('root')

	if (widget === null)
		throw new Error('Expected the "root" widget to exist.')

	return {
		runtime,
		widget,
		counters: () => ({
			doubledComputeCount,
			parityComputeCount,
			flakyComputeCount,
			viaFlakyComputeCount,
			viaDoubledRefinedComputeCount,
		}),
		setFlakyShouldFail: (value: boolean) => {
			flakyShouldFail = value
		},
	}
}

describe('runtimeProperty', () => {
	it('never computes without a get() or a subscribe() (lazy)', () => {
		const { counters } = createHarness()

		expect(counters().doubledComputeCount)
			.toBe(0)
	})

	it('computes once and reuses the cached ExecutionResult for repeated get() calls with no dependency change', () => {
		const { widget, counters } = createHarness()

		const first = widget.properties.doubled.get()
		const second = widget.properties.doubled.get()

		expect(counters().doubledComputeCount)
			.toBe(1)
		expect(second)
			.toBe(first)
		expect(first)
			.toEqual({ ok: true, value: 0 })
	})

	it('recomputes after the dependency state changes and reflects the new value', () => {
		const { widget, counters } = createHarness()

		expect(widget.properties.doubled.get())
			.toEqual({ ok: true, value: 0 })

		widget.state.count.set(5)

		expect(widget.properties.doubled.get())
			.toEqual({ ok: true, value: 10 })
		expect(counters().doubledComputeCount)
			.toBe(2)
	})

	it('subscribe() does not emit immediately upon subscription', () => {
		const { widget } = createHarness()
		const listener = vi.fn()

		widget.properties.doubled.subscribe(listener)

		expect(listener)
			.not.toHaveBeenCalled()
	})

	it('notifies exactly once per actual recompute — even when the raw value repeats — and not at all when the dependency does not change', () => {
		const { widget } = createHarness()

		widget.state.count.set(1)
		const listener = vi.fn()
		widget.properties.parity.subscribe(listener)
		expect(listener)
			.not.toHaveBeenCalled()

		widget.state.count.set(2)
		expect(listener)
			.toHaveBeenCalledTimes(1)
		expect(listener.mock.calls[0]![0])
			.toEqual({ ok: true, value: 0 })

		// Same value: the state signal itself does not change, so the Property never recomputes.
		widget.state.count.set(2)
		expect(listener)
			.toHaveBeenCalledTimes(1)

		widget.state.count.set(1)
		expect(listener)
			.toHaveBeenCalledTimes(2)
		expect(listener.mock.calls[1]![0])
			.toEqual({ ok: true, value: 1 })

		// Different state (1 -> 3), but the raw property output repeats (parity 1 again): the actual
		// recompute still notifies once, and the emitted result is a fresh object each time.
		widget.state.count.set(3)
		expect(listener)
			.toHaveBeenCalledTimes(3)
		expect(listener.mock.calls[2]![0])
			.toEqual({ ok: true, value: 1 })
		expect(listener.mock.calls[2]![0])
			.not.toBe(listener.mock.calls[1]![0])
	})

	it('subscribeDiagnostics() does not activate the Property computation', () => {
		const { widget, counters } = createHarness()
		const listener = vi.fn()

		widget.properties.doubled.subscribeDiagnostics(listener)

		expect(counters().doubledComputeCount)
			.toBe(0)
		expect(listener)
			.not.toHaveBeenCalled()
	})

	it('a compute failure produces an ExecutionResult.failure with a matching committed diagnostic snapshot', () => {
		const { widget, setFlakyShouldFail } = createHarness()
		setFlakyShouldFail(true)

		const result = widget.properties.flaky.get()

		expect(result.ok)
			.toBe(false)
		if (result.ok)
			throw new Error('Expected a failure result.')

		expect(result.failure.diagnostics)
			.toHaveLength(1)
		const diagnostic = result.failure.diagnostics[0]
		expect(diagnostic.code)
			.toBe('invalid-property-result')
		if (diagnostic.code !== 'invalid-property-result')
			throw new Error('Expected a property-result diagnostic.')

		expect(diagnostic.location.widgetId)
			.toBe('root')
		expect(diagnostic.location.name)
			.toBe('flaky')
		expect(diagnostic.result)
			.toBe(0)
		expect(diagnostic.message)
			.toBe('flaky failed')
		expect(widget.properties.flaky.getDiagnostics())
			.toBe(result.failure.diagnostics)
	})

	it('wraps a dependency target failure 1:1 as a property-dependency diagnostic pointing only at the direct target', () => {
		const { widget, setFlakyShouldFail } = createHarness()
		setFlakyShouldFail(true)

		const result = widget.properties.viaFlaky.get()

		expect(result.ok)
			.toBe(false)
		if (result.ok)
			throw new Error('Expected a failure result.')

		expect(result.failure.diagnostics)
			.toHaveLength(1)
		const diagnostic = result.failure.diagnostics[0]
		expect(diagnostic.code)
			.toBe('dependency-target-failed')
		if (!('dependency' in diagnostic))
			throw new Error('Expected a property-dependency diagnostic.')

		expect(diagnostic.location.widgetId)
			.toBe('root')
		expect(diagnostic.location.name)
			.toBe('viaFlaky')
		expect(diagnostic.dependency)
			.toEqual({
				target: { type: 'self' },
				operation: { type: 'property-get', name: 'flaky' },
			})
		expect('received' in diagnostic)
			.toBe(false)
		expect(diagnostic.related)
			.toEqual([{ type: 'property', widgetId: 'root', name: 'flaky' }])
		// Message is preserved from the wrapped target failure, not replaced by a generic string.
		expect(diagnostic.message)
			.toBe('flaky failed')
		// No recursive copy of the target's own diagnostic tree: only the documented dependency fields exist.
		expect(Object.keys(diagnostic)
			.sort())
			.toEqual(['cause', 'code', 'dependency', 'location', 'message', 'related'])
	})

	it('a .validate() refinement rejection becomes a dependency diagnostic carrying the rejected value as received', () => {
		const { widget } = createHarness()

		const result = widget.properties.viaDoubledRefined.get()

		expect(result.ok)
			.toBe(false)
		if (result.ok)
			throw new Error('Expected a failure result.')

		expect(result.failure.diagnostics)
			.toHaveLength(1)
		const diagnostic = result.failure.diagnostics[0]
		expect(diagnostic.code)
			.toBe('dependency-value-rejected')
		if (!('dependency' in diagnostic))
			throw new Error('Expected a property-dependency diagnostic.')

		// doubled === count(0) * 2 at this point; the refinement rejected that raw ok value.
		if (!('received' in diagnostic))
			throw new Error('Expected a dependency-value-rejected diagnostic.')
		expect(diagnostic.received)
			.toBe(0)
		expect(diagnostic.related)
			.toEqual([{ type: 'property', widgetId: 'root', name: 'doubled' }])
	})
})
