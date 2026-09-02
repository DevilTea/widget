/**
 * Conformance coverage for `overrideStateDefaults` best-effort recovery granularity — diagnostic #10
 * COMMENT 21 ("overrideStateDefaults is best-effort and never blocks Runtime creation"), COMMENT 27/28
 * (locked `state-override` source union) and consolidated handoff §11.
 *
 * Each row of the granularity table gets its own discriminating test: the whole point is that a
 * plausible-but-wrong implementation collapses distinct granularities (e.g. emitting one diagnostic per
 * nested key for an unknown widget, or duplicating a known-key validation failure as a `state-override`
 * diagnostic too).
 */

import type { WidgetSystemRuntimeDiagnostic } from '../index'
import { describe, expect, it } from 'vitest'
import { createWidgetPlugin, createWidgetSystem } from '../index'

interface CounterInterfaces {
	state: {
		count: number
	}
}

const counterPlugin = createWidgetPlugin('counter')
	.description('Test widget')
	.interfaces<CounterInterfaces>()
	.state(section => section.count({
		validate: (input): input is number => typeof input === 'number',
		default: () => 0,
	}))
	.done()

const statelessPlugin = createWidgetPlugin('stateless')
	.description('Test widget')
	.interfaces<Record<never, never>>()
	.done()

const system = createWidgetSystem({ plugins: [counterPlugin, statelessPlugin] })

function createValidBlueprint(definition: unknown) {
	const blueprint = system.createBlueprint(definition)
	if (blueprint.status !== 'valid')
		throw new Error('expected a valid blueprint')
	return blueprint
}

function stateOverrideDiagnostics(diagnostics: readonly WidgetSystemRuntimeDiagnostic[]) {
	return diagnostics.filter(diagnostic => diagnostic.code === 'invalid-state-overrides'
		|| diagnostic.code === 'unknown-state-override-widget'
		|| diagnostic.code === 'unsupported-state-override-target'
		|| diagnostic.code === 'invalid-state-override-fragment'
		|| diagnostic.code === 'unknown-state-override-member')
}

describe('overrideStateDefaults best-effort granularity (diagnostic #10 COMMENT 21/27/28)', () => {
	it('malformed top-level payload => exactly one top-level state-override diagnostic (no widgetId)', () => {
		const blueprint = createValidBlueprint({ id: 'root', type: 'counter' })

		const runtime = blueprint.createRuntime({ overrideStateDefaults: 'not-a-record' as any })

		const diagnostics = runtime.getDiagnostics()
		expect(diagnostics)
			.toHaveLength(1)
		expect(diagnostics[0]!)
			.toMatchObject({ code: 'invalid-state-overrides', location: { type: 'runtime' } })

		// Regression: Runtime is still created successfully, and the unrelated default still initializes.
		expect(runtime.isDisposed)
			.toBe(false)
		const widget = runtime.getWidget('root') as any
		expect(widget.state.count.get())
			.toBe(0)
	})

	it('unknown widget id => exactly one widget-level state-override diagnostic (widgetId, no key)', () => {
		const blueprint = createValidBlueprint({ id: 'root', type: 'counter' })

		const runtime = blueprint.createRuntime({ overrideStateDefaults: { ghost: { count: 5 } } })

		const diagnostics = runtime.getDiagnostics()
		expect(diagnostics)
			.toHaveLength(1)
		expect(diagnostics[0]!)
			.toMatchObject({ code: 'unknown-state-override-widget', path: ['ghost'], location: { type: 'runtime' } })

		expect(runtime.isDisposed)
			.toBe(false)
		const widget = runtime.getWidget('root') as any
		expect(widget.state.count.get())
			.toBe(0)
	})

	it('widget without state capability => exactly one widget-level state-override diagnostic', () => {
		const blueprint = createValidBlueprint({ id: 'root', type: 'stateless' })

		const runtime = blueprint.createRuntime({ overrideStateDefaults: { root: { count: 5 } } })

		const diagnostics = runtime.getDiagnostics()
		expect(diagnostics)
			.toHaveLength(1)
		expect(diagnostics[0]!)
			.toMatchObject({ code: 'unsupported-state-override-target', path: ['root'], location: { type: 'runtime' } })

		expect(runtime.isDisposed)
			.toBe(false)
	})

	it('malformed per-widget fragment => exactly one widget-level state-override diagnostic', () => {
		const blueprint = createValidBlueprint({ id: 'root', type: 'counter' })

		const runtime = blueprint.createRuntime({ overrideStateDefaults: { root: 'not-a-record' as any } })

		const diagnostics = runtime.getDiagnostics()
		expect(diagnostics)
			.toHaveLength(1)
		expect(diagnostics[0]!)
			.toMatchObject({ code: 'invalid-state-override-fragment', path: ['root'], location: { type: 'runtime' } })

		// The fragment is discarded wholesale; the state falls back to its default rather than being left
		// uninitialized by the malformed fragment.
		expect(runtime.isDisposed)
			.toBe(false)
		const widget = runtime.getWidget('root') as any
		expect(widget.state.count.get())
			.toBe(0)
	})

	it('unknown state key => one diagnostic per unknown key (widgetId + key), known keys still initialize', () => {
		const blueprint = createValidBlueprint({ id: 'root', type: 'counter' })

		const runtime = blueprint.createRuntime({ overrideStateDefaults: { root: { count: 5, mystery: 1, another: 2 } } })

		const diagnostics = stateOverrideDiagnostics(runtime.getDiagnostics())
		expect(diagnostics)
			.toHaveLength(2)
		expect(diagnostics.map(diagnostic => diagnostic))
			.toEqual(
				expect.arrayContaining([
					expect.objectContaining({ code: 'unknown-state-override-member', path: ['root', 'mystery'], location: { type: 'runtime' } }),
					expect.objectContaining({ code: 'unknown-state-override-member', path: ['root', 'another'], location: { type: 'runtime' } }),
				]),
			)

		// The known key is unaffected and initializes from the valid override candidate.
		const widget = runtime.getWidget('root') as any
		expect(widget.state.count.get())
			.toBe(5)
		expect(widget.state.count.getDiagnostics())
			.toHaveLength(0)
	})

	it('known key + invalid candidate => only a primitive state-validation diagnostic, never state-override', () => {
		const blueprint = createValidBlueprint({ id: 'root', type: 'counter' })

		const runtime = blueprint.createRuntime({ overrideStateDefaults: { root: { count: 'not-a-number' } } })

		expect(stateOverrideDiagnostics(runtime.getDiagnostics()))
			.toHaveLength(0)

		const widget = runtime.getWidget('root') as any
		expect(widget.state.count.get())
			.toBeNull()

		const stateDiagnostics = widget.state.count.getDiagnostics()
		expect(stateDiagnostics)
			.toHaveLength(1)
		expect(stateDiagnostics[0])
			.toMatchObject({ code: 'invalid-state-value', location: { type: 'state', widgetId: 'root', key: 'count' }, candidate: 'not-a-number' })
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

	it('these override diagnostics participate in the runtime aggregate (getDiagnostics)', () => {
		const blueprint = createValidBlueprint({ id: 'root', type: 'counter' })

		const runtime = blueprint.createRuntime({ overrideStateDefaults: { ghost: { count: 5 } } })

		const collected = runtime.getDiagnostics()
		const overrideDiagnosticsInAggregate = stateOverrideDiagnostics(collected)
		expect(overrideDiagnosticsInAggregate)
			.toHaveLength(1)
		expect(overrideDiagnosticsInAggregate[0]!)
			.toMatchObject({ code: 'unknown-state-override-widget', path: ['ghost'], location: { type: 'runtime' } })

		// The runtime-level diagnostic set is exactly `getDiagnostics()`, and it appears first in the aggregate.
		expect(runtime.getDiagnostics())
			.toEqual([overrideDiagnosticsInAggregate[0]])
		expect(collected[0])
			.toBe(runtime.getDiagnostics()[0])
	})
})
