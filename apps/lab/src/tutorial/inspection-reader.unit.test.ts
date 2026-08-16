import type { RuntimeWidgetFor, WidgetSystemRuntime } from '@deviltea/widget-core'
import type { CounterPlugin, SandboxPlugins } from '../sandbox/plugins'
import { inspectBlueprint } from '@deviltea/widget-core/inspection'
import { describe, expect, it } from 'vitest'
import { sandboxPresets } from '../sandbox/presets'
import { sandboxSystem } from '../sandbox/system'
import { createRuntimeReader, findBlueprintNodeId, subscribeObservationTargets } from './inspection-reader'

const validSource = sandboxPresets.find(preset => preset.id === 'valid-interactive')!.sourceText

function createValidRuntime(): WidgetSystemRuntime<SandboxPlugins> {
	const blueprint = sandboxSystem.createBlueprint(JSON.parse(validSource))
	if (blueprint.status !== 'valid')
		throw new Error('fixture setup error: expected a valid blueprint')
	return blueprint.createRuntime()
}

function counterWidget(runtime: WidgetSystemRuntime<SandboxPlugins>): RuntimeWidgetFor<typeof CounterPlugin, SandboxPlugins> {
	const widget = runtime.getWidget('counter-1')
	if (widget === null || widget.type !== 'Counter')
		throw new Error('fixture setup error: expected widget "counter-1" of type "Counter"')
	return widget as unknown as RuntimeWidgetFor<typeof CounterPlugin, SandboxPlugins>
}

describe('findBlueprintNodeId', () => {
	it('resolves a known widget id to its InspectionNodeId', () => {
		const runtime = createValidRuntime()
		try {
			const blueprint = inspectBlueprint(runtime.blueprint)
			const nodeId = findBlueprintNodeId(blueprint, 'counter-1')
			expect(nodeId)
				.not.toBeNull()
			const node = blueprint.getNode(nodeId!)
			expect(node?.resolved && node.node.id)
				.toBe('counter-1')
		}
		finally {
			runtime.dispose()
		}
	})

	it('returns null for an id with no matching resolved node', () => {
		const runtime = createValidRuntime()
		try {
			const blueprint = inspectBlueprint(runtime.blueprint)
			expect(findBlueprintNodeId(blueprint, 'does-not-exist'))
				.toBeNull()
		}
		finally {
			runtime.dispose()
		}
	})
})

describe('createRuntimeReader', () => {
	it('readState reads the current State value passively, reflecting a real Method-driven mutation', () => {
		const runtime = createValidRuntime()
		try {
			const reader = createRuntimeReader(runtime)
			expect(reader.readState('counter-1', 'count'))
				.toBe(0)

			counterWidget(runtime).methods.increment(3)

			expect(reader.readState('counter-1', 'count'))
				.toBe(3)
		}
		finally {
			runtime.dispose()
		}
	})

	it('readState returns undefined for an unresolvable widget id or state key', () => {
		const runtime = createValidRuntime()
		try {
			const reader = createRuntimeReader(runtime)
			expect(reader.readState('does-not-exist', 'count'))
				.toBeUndefined()
			expect(reader.readState('counter-1', 'not-a-real-key'))
				.toBeUndefined()
		}
		finally {
			runtime.dispose()
		}
	})

	it('readProperty reports never-evaluated until a real consumer causes evaluation, then the completed result', () => {
		const runtime = createValidRuntime()
		try {
			const reader = createRuntimeReader(runtime)
			expect(reader.readProperty('summary-1', 'total'))
				.toEqual({ status: 'never-evaluated' })

			// `narrowWidget().properties.total.get()` is the real evaluating consumer here (mirroring how
			// Preview's own `useProperties()` naturally reads a Property) — the reader itself never forces
			// evaluation.
			const summary = runtime.getWidget('summary-1')
			if (summary === null || summary.type !== 'Summary') {
				throw new Error('fixture setup error')
			}
			;(summary as unknown as { properties: { total: { get: () => unknown } } }).properties.total.get()

			expect(reader.readProperty('summary-1', 'total'))
				.toEqual({ status: 'completed', result: { success: true, value: 0 } })
		}
		finally {
			runtime.dispose()
		}
	})

	it('readProperty returns undefined for an unresolvable widget id or property key', () => {
		const runtime = createValidRuntime()
		try {
			const reader = createRuntimeReader(runtime)
			expect(reader.readProperty('does-not-exist', 'total'))
				.toBeUndefined()
			expect(reader.readProperty('summary-1', 'not-a-real-key'))
				.toBeUndefined()
		}
		finally {
			runtime.dispose()
		}
	})
})

describe('subscribeObservationTargets', () => {
	it('fires onChange when a subscribed State member changes, and stops after teardown', () => {
		const runtime = createValidRuntime()
		try {
			let calls = 0
			const teardown = subscribeObservationTargets(
				runtime,
				[{ widgetId: 'counter-1', member: { type: 'state', key: 'count' } }],
				() => { calls++ },
			)

			counterWidget(runtime).methods.increment(1)
			expect(calls)
				.toBeGreaterThan(0)

			const callsAfterFirstChange = calls
			teardown()
			counterWidget(runtime).methods.increment(1)
			expect(calls)
				.toBe(callsAfterFirstChange)
		}
		finally {
			runtime.dispose()
		}
	})

	it('silently skips an unresolvable target rather than throwing', () => {
		const runtime = createValidRuntime()
		try {
			expect(() => subscribeObservationTargets(
				runtime,
				[{ widgetId: 'does-not-exist', member: { type: 'state', key: 'count' } }],
				() => {},
			))
				.not.toThrow()
		}
		finally {
			runtime.dispose()
		}
	})
})
