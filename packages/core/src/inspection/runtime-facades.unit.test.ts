/**
 * Conformance group 13 (zero semantic execution), group 14 (Property inspection subscribe truth table),
 * group 15 (State inspection passive read + notification truth table) and the runtime half of group 16
 * (no Method runtime inspection surface) from issue #10's inspection amendment "inspection exact API v1
 * (part 2)".
 */

import { effect } from 'alien-signals'
import { describe, expect, it, vi } from 'vitest'
import { createWidgetPlugin, createWidgetSystem } from '../index'
import { inspectBlueprint, inspectRuntime } from './index'

type ControlledMode = 'success' | 'fail' | 'throw' | 'thenable'

interface HarnessInterfaces {
	state: {
		count: number
	}
	properties: {
		controlled: number
	}
}

function createHarness() {
	let computeSpyCount = 0
	let mode: ControlledMode = 'success'
	let controlledValue = 1

	const plugin = createWidgetPlugin('runtime-facade-harness')
		.interfaces<HarnessInterfaces>()
		.state(state => state.count({
			validate: (input): input is number => typeof input === 'number',
			default: () => 0,
		}))
		.properties(properties => properties.controlled({
			registerDeps: ({ dep }) => ({ count: dep.self.state.get('count') }),
			compute: ({ deps, addIssue }) => {
				computeSpyCount++
				// Registers/reads the dependency so state changes actually invalidate this computed; the
				// business output below is independently controlled by test-controlled closure state.
				deps.count()
				if (mode === 'throw')
					throw new Error('boom')
				if (mode === 'thenable')
					return { then: () => {} } as unknown as number
				if (mode === 'fail') {
					addIssue({ message: 'flaky failed' })
					return controlledValue
				}
				return controlledValue
			},
		}))
		.done()

	const system = createWidgetSystem({ plugins: [plugin] })
	const blueprint = system.createBlueprint({ id: 'root', type: 'runtime-facade-harness' })
	if (blueprint.status !== 'valid')
		throw new Error('test fixture: expected a valid blueprint')

	const runtime = blueprint.createRuntime()
	const widget = runtime.getWidget('root')
	if (widget === null)
		throw new Error('test fixture: expected the root widget to exist')

	return {
		blueprint,
		runtime,
		widget,
		getComputeSpyCount: () => computeSpyCount,
		setMode: (next: ControlledMode) => { mode = next },
		setControlledValue: (next: number) => { controlledValue = next },
	}
}

function rootIdOf(runtime: ReturnType<typeof createHarness>['runtime']) {
	return inspectRuntime(runtime).blueprint.rootNodeId
}

describe('zero semantic execution', () => {
	it('reading a full Blueprint inspection triggers zero property evaluation', () => {
		const { blueprint, getComputeSpyCount } = createHarness()
		const inspection = inspectBlueprint(blueprint)

		for (const node of inspection.nodes) {
			if (!node.resolved)
				continue
			for (const property of node.properties)
				void property.dependencies
			for (const method of node.methods)
				void method.dependencies
			void node.capabilities
			void node.semanticSlots
			void node.sourceSlots
		}
		void inspection.invalidCycles
		for (const node of inspection.nodes) {
			expect(inspection.getNode(node.nodeId))
				.toBe(node)
			expect(inspection.getNodeId(node.node))
				.toBe(node.nodeId)
		}

		expect(getComputeSpyCount())
			.toBe(0)
	})

	it('inspectRuntime -> getWidget -> getProperty -> getSnapshot -> subscribe triggers zero evaluation', () => {
		const { runtime, getComputeSpyCount } = createHarness()
		const runtimeInspection = inspectRuntime(runtime)
		const widgetInspection = runtimeInspection.getWidget(rootIdOf(runtime))!
		const propertyInspection = widgetInspection.getProperty('controlled')!

		expect(propertyInspection.getSnapshot())
			.toEqual({ status: 'never-evaluated' })
		const unsubscribe = propertyInspection.subscribe(() => {})

		expect(getComputeSpyCount())
			.toBe(0)
		expect(propertyInspection.getSnapshot())
			.toEqual({ status: 'never-evaluated' })
		unsubscribe()
	})

	it('stays never-evaluated until a real Runtime consumer evaluates, then notifies exactly once', () => {
		const { widget, runtime, setControlledValue } = createHarness()
		setControlledValue(1)
		const propertyInspection = inspectRuntime(runtime)
			.getWidget(rootIdOf(runtime))!.getProperty('controlled')!
		const listener = vi.fn()
		propertyInspection.subscribe(listener)

		expect(propertyInspection.getSnapshot())
			.toEqual({ status: 'never-evaluated' })

		const result = widget.properties.controlled.get()

		expect(listener)
			.toHaveBeenCalledTimes(1)
		expect(propertyInspection.getSnapshot())
			.toEqual({ status: 'completed', result })
		expect(listener.mock.calls[0]![0])
			.toEqual({ status: 'completed', result })
	})
})

describe('property inspection subscribe truth table', () => {
	it('subscribe() has no immediate emission', () => {
		const { runtime } = createHarness()
		const propertyInspection = inspectRuntime(runtime)
			.getWidget(rootIdOf(runtime))!.getProperty('controlled')!
		const listener = vi.fn()
		propertyInspection.subscribe(listener)
		expect(listener)
			.not.toHaveBeenCalled()
	})

	it('walks the full retention sequence: success -> invalidation (no notify) -> failure -> throw (no notify) -> thenable violation (no notify) -> equal-value fresh completion (notifies)', () => {
		const { widget, runtime, setMode, setControlledValue } = createHarness()
		const propertyInspection = inspectRuntime(runtime)
			.getWidget(rootIdOf(runtime))!.getProperty('controlled')!
		const listener = vi.fn()
		propertyInspection.subscribe(listener)

		// 1. First natural completion: success A.
		setMode('success')
		setControlledValue(1)
		const resultA = widget.properties.controlled.get()
		expect(listener)
			.toHaveBeenCalledTimes(1)
		expect(propertyInspection.getSnapshot())
			.toEqual({ status: 'completed', result: resultA })

		// 2. Invalidate the dependency without pulling: lazy, so no recompute and no notification yet.
		widget.state.count.set(2)
		expect(listener)
			.toHaveBeenCalledTimes(1)
		expect(propertyInspection.getSnapshot())
			.toEqual({ status: 'completed', result: resultA })

		// 3. A real pull now recomputes, this time a semantic failure: completed snapshot B.
		setMode('fail')
		const resultB = widget.properties.controlled.get()
		expect(resultB.success)
			.toBe(false)
		expect(listener)
			.toHaveBeenCalledTimes(2)
		expect(propertyInspection.getSnapshot())
			.toEqual({ status: 'completed', result: resultB })

		// 4. Invalidate again, then a compute throw: not a completed attempt, snapshot/notify count unchanged.
		widget.state.count.set(3)
		setMode('throw')
		expect(() => widget.properties.controlled.get())
			.toThrow('boom')
		expect(listener)
			.toHaveBeenCalledTimes(2)
		expect(propertyInspection.getSnapshot())
			.toEqual({ status: 'completed', result: resultB })

		// 5. Invalidate again, then a thenable-violation: also not a completed attempt.
		widget.state.count.set(4)
		setMode('thenable')
		expect(() => widget.properties.controlled.get())
			.toThrow()
		expect(listener)
			.toHaveBeenCalledTimes(2)
		expect(propertyInspection.getSnapshot())
			.toEqual({ status: 'completed', result: resultB })

		// 6. Invalidate again, then a fresh success completion whose value equals A's: still notifies,
		// no deep-equality suppression, and it is a distinct snapshot from A.
		widget.state.count.set(5)
		setMode('success')
		setControlledValue(1)
		const resultC = widget.properties.controlled.get()
		expect(resultC)
			.toEqual(resultA)
		expect(listener)
			.toHaveBeenCalledTimes(3)
		expect(propertyInspection.getSnapshot())
			.toEqual({ status: 'completed', result: resultC })
	})

	it('subscribeIssues-style unsubscribe is idempotent and safe to call multiple times', () => {
		const { runtime } = createHarness()
		const propertyInspection = inspectRuntime(runtime)
			.getWidget(rootIdOf(runtime))!.getProperty('controlled')!
		const unsubscribe = propertyInspection.subscribe(() => {})
		expect(() => unsubscribe()).not.toThrow()
		expect(() => unsubscribe()).not.toThrow()
	})
})

describe('state inspection passive read + notification truth table', () => {
	it('getSnapshot() inside an external alien-signals effect creates no tracked dependency', () => {
		const { widget, runtime } = createHarness()
		const stateInspection = inspectRuntime(runtime)
			.getWidget(rootIdOf(runtime))!.getState('count')!

		let effectRuns = 0
		const stop = effect(() => {
			stateInspection.getSnapshot()
			effectRuns++
		})
		expect(effectRuns)
			.toBe(1)

		widget.state.count.set(42)

		// If `getSnapshot()` had been a tracked read, this state change would re-trigger the effect.
		expect(effectRuns)
			.toBe(1)
		stop()
	})

	it('publishes exactly one snapshot per authoritative value change; a rejected write publishes nothing while Issues still update', () => {
		const { widget, runtime } = createHarness()
		const stateInspection = inspectRuntime(runtime)
			.getWidget(rootIdOf(runtime))!.getState('count')!
		const listener = vi.fn()
		stateInspection.subscribe(listener)
		expect(listener).not.toHaveBeenCalled()

		widget.state.count.set(5)
		expect(listener)
			.toHaveBeenCalledTimes(1)
		expect(listener.mock.calls[0]![0])
			.toEqual({ value: 5 })
		expect(stateInspection.getSnapshot())
			.toEqual({ value: 5 })

		const issuesBefore = widget.state.count.getIssues()
		const rejected = widget.state.count.set('not-a-number' as unknown as number)
		expect(rejected.success)
			.toBe(false)
		expect(listener)
			.toHaveBeenCalledTimes(1)
		expect(stateInspection.getSnapshot())
			.toEqual({ value: 5 })
		expect(widget.state.count.getIssues()).not.toBe(issuesBefore)

		// Same-value write: no authoritative change, matching core state signal semantics.
		widget.state.count.set(5)
		expect(listener)
			.toHaveBeenCalledTimes(1)
	})

	it('getSnapshot() before any write reflects the retained default: never a null-vs-uninitialized ambiguity beyond the documented T | null', () => {
		const { runtime } = createHarness()
		const stateInspection = inspectRuntime(runtime)
			.getWidget(rootIdOf(runtime))!.getState('count')!
		// `count` has `default: () => 0`, applied at Runtime creation before any inspector attaches.
		expect(stateInspection.getSnapshot())
			.toEqual({ value: 0 })
	})
})

describe('no Method runtime inspection surface (runtime)', () => {
	it('runtimeWidgetInspection has no getMethod at runtime', () => {
		const { runtime } = createHarness()
		const widgetInspection = inspectRuntime(runtime)
			.getWidget(rootIdOf(runtime))!
		expect((widgetInspection as unknown as Record<string, unknown>).getMethod)
			.toBeUndefined()
	})
})
