/**
 * Conformance coverage for `overrideStateDefaults` best-effort recovery granularity — issue #10
 * COMMENT 21 ("overrideStateDefaults is best-effort and never blocks Runtime creation"), COMMENT 27/28
 * (locked `state-override` source union) and consolidated handoff §11.
 *
 * Each row of the granularity table gets its own discriminating test: the whole point is that a
 * plausible-but-wrong implementation collapses distinct granularities (e.g. emitting one issue per
 * nested key for an unknown widget, or duplicating a known-key validation failure as a `state-override`
 * issue too).
 */

import { describe, expect, it } from 'vitest'
import { createWidgetPlugin, createWidgetSystem } from '../index'

interface CounterInterfaces {
	state: {
		count: number
	}
}

const counterPlugin = createWidgetPlugin('counter')
	.interfaces<CounterInterfaces>()
	.state(section => section.count({
		validate: (input): input is number => typeof input === 'number',
		default: () => 0,
	}))
	.done()

const statelessPlugin = createWidgetPlugin('stateless')
	.interfaces<Record<never, never>>()
	.done()

const system = createWidgetSystem({ plugins: [counterPlugin, statelessPlugin] })

function createValidBlueprint(definition: unknown) {
	const blueprint = system.createBlueprint(definition)
	if (blueprint.status !== 'valid')
		throw new Error('expected a valid blueprint')
	return blueprint
}

function stateOverrideIssues(issues: readonly { source: unknown }[]) {
	return issues.filter(issue => (issue.source as { type?: string }).type === 'state-override')
}

describe('overrideStateDefaults best-effort granularity (issue #10 COMMENT 21/27/28)', () => {
	it('malformed top-level payload => exactly one top-level state-override issue (no widgetId)', () => {
		const blueprint = createValidBlueprint({ id: 'root', type: 'counter' })

		const runtime = blueprint.createRuntime({ overrideStateDefaults: 'not-a-record' as any })

		const issues = runtime.getIssues()
		expect(issues)
			.toHaveLength(1)
		expect(issues[0]!.source)
			.toEqual({ type: 'state-override' })

		// Regression: Runtime is still created successfully, and the unrelated default still initializes.
		expect(runtime.isDisposed)
			.toBe(false)
		const widget = runtime.getWidget('root') as any
		expect(widget.state.count.get())
			.toBe(0)
	})

	it('unknown widget id => exactly one widget-level state-override issue (widgetId, no key)', () => {
		const blueprint = createValidBlueprint({ id: 'root', type: 'counter' })

		const runtime = blueprint.createRuntime({ overrideStateDefaults: { ghost: { count: 5 } } })

		const issues = runtime.getIssues()
		expect(issues)
			.toHaveLength(1)
		expect(issues[0]!.source)
			.toEqual({ type: 'state-override', widgetId: 'ghost' })

		expect(runtime.isDisposed)
			.toBe(false)
		const widget = runtime.getWidget('root') as any
		expect(widget.state.count.get())
			.toBe(0)
	})

	it('widget without state capability => exactly one widget-level state-override issue', () => {
		const blueprint = createValidBlueprint({ id: 'root', type: 'stateless' })

		const runtime = blueprint.createRuntime({ overrideStateDefaults: { root: { count: 5 } } })

		const issues = runtime.getIssues()
		expect(issues)
			.toHaveLength(1)
		expect(issues[0]!.source)
			.toEqual({ type: 'state-override', widgetId: 'root' })

		expect(runtime.isDisposed)
			.toBe(false)
	})

	it('malformed per-widget fragment => exactly one widget-level state-override issue', () => {
		const blueprint = createValidBlueprint({ id: 'root', type: 'counter' })

		const runtime = blueprint.createRuntime({ overrideStateDefaults: { root: 'not-a-record' as any } })

		const issues = runtime.getIssues()
		expect(issues)
			.toHaveLength(1)
		expect(issues[0]!.source)
			.toEqual({ type: 'state-override', widgetId: 'root' })

		// The fragment is discarded wholesale; the state falls back to its default rather than being left
		// uninitialized by the malformed fragment.
		expect(runtime.isDisposed)
			.toBe(false)
		const widget = runtime.getWidget('root') as any
		expect(widget.state.count.get())
			.toBe(0)
	})

	it('unknown state key => one issue per unknown key (widgetId + key), known keys still initialize', () => {
		const blueprint = createValidBlueprint({ id: 'root', type: 'counter' })

		const runtime = blueprint.createRuntime({ overrideStateDefaults: { root: { count: 5, mystery: 1, another: 2 } } })

		const issues = stateOverrideIssues(runtime.getIssues())
		expect(issues)
			.toHaveLength(2)
		expect(issues.map(issue => issue.source))
			.toEqual(
				expect.arrayContaining([
					{ type: 'state-override', widgetId: 'root', key: 'mystery' },
					{ type: 'state-override', widgetId: 'root', key: 'another' },
				]),
			)

		// The known key is unaffected and initializes from the valid override candidate.
		const widget = runtime.getWidget('root') as any
		expect(widget.state.count.get())
			.toBe(5)
		expect(widget.state.count.getIssues())
			.toHaveLength(0)
	})

	it('known key + invalid candidate => only a primitive state-validation issue, never state-override', () => {
		const blueprint = createValidBlueprint({ id: 'root', type: 'counter' })

		const runtime = blueprint.createRuntime({ overrideStateDefaults: { root: { count: 'not-a-number' } } })

		expect(stateOverrideIssues(runtime.getIssues()))
			.toHaveLength(0)

		const widget = runtime.getWidget('root') as any
		expect(widget.state.count.get())
			.toBeNull()

		const stateIssues = widget.state.count.getIssues()
		expect(stateIssues)
			.toHaveLength(1)
		expect(stateIssues[0].source)
			.toMatchObject({ type: 'state-validation', widgetId: 'root', key: 'count', candidate: 'not-a-number' })
	})

	it('regression: every malformed/unusable override shape still yields a successfully created Runtime', () => {
		const cases: unknown[] = [
			'not-a-record',
			{ ghost: { count: 1 } },
			{ root: 'not-a-record' },
			{ root: { mystery: 1 } },
			{ root: { count: 'not-a-number' } },
		]

		for (const overrideStateDefaults of cases) {
			const blueprint = createValidBlueprint({ id: 'root', type: 'counter' })
			expect(() => blueprint.createRuntime({ overrideStateDefaults: overrideStateDefaults as any })).not.toThrow()

			const runtime = blueprint.createRuntime({ overrideStateDefaults: overrideStateDefaults as any })
			expect(runtime.isDisposed)
				.toBe(false)
			expect(runtime.getWidget('root')).not.toBeNull()
		}
	})

	it('these override issues participate in the runtime aggregate (getCollectedIssues)', () => {
		const blueprint = createValidBlueprint({ id: 'root', type: 'counter' })

		const runtime = blueprint.createRuntime({ overrideStateDefaults: { ghost: { count: 5 } } })

		const collected = runtime.getCollectedIssues()
		const overrideIssuesInAggregate = stateOverrideIssues(collected)
		expect(overrideIssuesInAggregate)
			.toHaveLength(1)
		expect(overrideIssuesInAggregate[0]!.source)
			.toEqual({ type: 'state-override', widgetId: 'ghost' })

		// The runtime-level issue set is exactly `getIssues()`, and it appears first in the aggregate.
		expect(runtime.getIssues())
			.toEqual([overrideIssuesInAggregate[0]])
		expect(collected[0])
			.toBe(runtime.getIssues()[0])
	})
})
