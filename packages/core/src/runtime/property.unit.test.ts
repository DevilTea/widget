/**
 * Conformance tests for `RuntimeProperty` — issue #10 COMMENT 26 §8 (Property section).
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
					return result.success ? (result.value ?? 0) * 2 : -1
				},
			})
			.parity({
				registerDeps: ({ dep }) => ({ count: dep.self.state.get('count') }),
				compute: ({ deps }) => {
					parityComputeCount++
					const result = deps.count()
					return result.success ? (result.value ?? 0) % 2 : -1
				},
			})
			.flaky({
				compute: ({ addIssue }) => {
					flakyComputeCount++
					if (flakyShouldFail)
						addIssue({ message: 'flaky failed' })
					return 0
				},
			})
			.viaFlaky({
				registerDeps: ({ dep }) => ({ flaky: dep.self.properties.get('flaky') }),
				compute: ({ deps }) => {
					viaFlakyComputeCount++
					const result = deps.flaky()
					return result.success ? result.value ?? 0 : -1
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
					return result.success ? 0 : -1
				},
			}))
		.done()

	const system = createWidgetSystem({ plugins: [plugin] })
	const blueprint = system.createBlueprint({ id: 'root', type: 'counter' })

	if (blueprint.status !== 'valid')
		throw new Error(`Expected a valid blueprint, got issues: ${JSON.stringify(blueprint.getCollectedIssues())}`)

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
			.toEqual({ success: true, value: 0 })
	})

	it('recomputes after the dependency state changes and reflects the new value', () => {
		const { widget, counters } = createHarness()

		expect(widget.properties.doubled.get())
			.toEqual({ success: true, value: 0 })

		widget.state.count.set(5)

		expect(widget.properties.doubled.get())
			.toEqual({ success: true, value: 10 })
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
			.toEqual({ success: true, value: 0 })

		// Same value: the state signal itself does not change, so the Property never recomputes.
		widget.state.count.set(2)
		expect(listener)
			.toHaveBeenCalledTimes(1)

		widget.state.count.set(1)
		expect(listener)
			.toHaveBeenCalledTimes(2)
		expect(listener.mock.calls[1]![0])
			.toEqual({ success: true, value: 1 })

		// Different state (1 -> 3), but the raw property output repeats (parity 1 again): the actual
		// recompute still notifies once, and the emitted result is a fresh object each time.
		widget.state.count.set(3)
		expect(listener)
			.toHaveBeenCalledTimes(3)
		expect(listener.mock.calls[2]![0])
			.toEqual({ success: true, value: 1 })
		expect(listener.mock.calls[2]![0])
			.not.toBe(listener.mock.calls[1]![0])
	})

	it('subscribeIssues() does not activate the Property computation', () => {
		const { widget, counters } = createHarness()
		const listener = vi.fn()

		widget.properties.doubled.subscribeIssues(listener)

		expect(counters().doubledComputeCount)
			.toBe(0)
		expect(listener)
			.not.toHaveBeenCalled()
	})

	it('a compute failure produces an ExecutionResult.failure with a matching committed issue snapshot', () => {
		const { widget, setFlakyShouldFail } = createHarness()
		setFlakyShouldFail(true)

		const result = widget.properties.flaky.get()

		expect(result.success)
			.toBe(false)
		if (result.success)
			throw new Error('Expected a failure result.')

		expect(result.issues)
			.toHaveLength(1)
		const issue = result.issues[0]
		expect(issue.source.type)
			.toBe('property-result')
		if (issue.source.type !== 'property-result')
			throw new Error('Expected a property-result issue.')

		expect(issue.source.widgetId)
			.toBe('root')
		expect(issue.source.name)
			.toBe('flaky')
		expect(issue.source.result)
			.toBe(0)
		expect(issue.message)
			.toBe('flaky failed')
		expect(widget.properties.flaky.getIssues())
			.toBe(result.issues)
	})

	it('wraps a dependency target failure 1:1 as a property-dependency issue pointing only at the direct target', () => {
		const { widget, setFlakyShouldFail } = createHarness()
		setFlakyShouldFail(true)

		const result = widget.properties.viaFlaky.get()

		expect(result.success)
			.toBe(false)
		if (result.success)
			throw new Error('Expected a failure result.')

		expect(result.issues)
			.toHaveLength(1)
		const issue = result.issues[0]
		expect(issue.source.type)
			.toBe('property-dependency')
		if (issue.source.type !== 'property-dependency')
			throw new Error('Expected a property-dependency issue.')

		expect(issue.source.widgetId)
			.toBe('root')
		expect(issue.source.name)
			.toBe('viaFlaky')
		expect(issue.source.dependency)
			.toEqual({
				target: { type: 'self' },
				operation: { type: 'property-get', name: 'flaky' },
			})
		expect(issue.source.received)
			.toBeUndefined()
		expect(issue.source.related)
			.toEqual([{ type: 'property', widgetId: 'root', name: 'flaky' }])
		// Message is preserved from the wrapped target failure, not replaced by a generic string.
		expect(issue.message)
			.toBe('flaky failed')
		// No recursive copy of the target's own issue tree: only the documented dependency fields exist.
		expect(Object.keys(issue.source)
			.sort())
			.toEqual(['dependency', 'name', 'related', 'type', 'widgetId'])
	})

	it('a .validate() refinement rejection becomes a dependency issue carrying the rejected value as received', () => {
		const { widget } = createHarness()

		const result = widget.properties.viaDoubledRefined.get()

		expect(result.success)
			.toBe(false)
		if (result.success)
			throw new Error('Expected a failure result.')

		expect(result.issues)
			.toHaveLength(1)
		const issue = result.issues[0]
		expect(issue.source.type)
			.toBe('property-dependency')
		if (issue.source.type !== 'property-dependency')
			throw new Error('Expected a property-dependency issue.')

		// doubled === count(0) * 2 at this point; the refinement rejected that raw success value.
		expect(issue.source.received)
			.toBe(0)
		expect(issue.source.related)
			.toEqual([{ type: 'property', widgetId: 'root', name: 'doubled' }])
	})
})
