/**
 * The one module under `src/tutorial/` that actually touches `@deviltea/widget-core`/`inspection` —
 * every other file in this directory only sees the abstract `TutorialRuntimeReader`/`TutorialActions`
 * shapes from `types.ts`. Mirrors `src/runtime-inspector/viewmodel.ts`'s passive-projection discipline:
 * every read here is `getSnapshot()`/`subscribe()` only — never `state.set()`, a Method invocation, or
 * anything that could force a lazy Property to evaluate. Widget Lab's own Preview is the only real
 * Runtime consumer; this module only observes whatever Preview's ordinary use already produced.
 */

import type { AnyWidgetPluginTuple, WidgetSystemRuntime } from '@deviltea/widget-core'
import type { BlueprintInspection, InspectionNodeId, RuntimeInspection } from '@deviltea/widget-core/inspection'
import type { TutorialObservationTarget, TutorialPropertySnapshot, TutorialRuntimeReader } from './types'
import { inspectRuntime } from '@deviltea/widget-core/inspection'

/**
 * Resolves a Lab-known widget id (e.g. `"adults"`, `"trip-metrics"`) to its `InspectionNodeId` within one
 * Blueprint inspection snapshot. Widget ids are stable, author-declared Source identifiers (`node.id`)
 * — not the snapshot-local `InspectionNodeId` itself — so this is a linear scan over recovered nodes,
 * same as `BlueprintTree.vue`'s own node listing; the survey Blueprint is small enough that this is not a
 * hot path.
 */
export function findBlueprintNodeId(
	blueprint: BlueprintInspection<AnyWidgetPluginTuple>,
	widgetId: string,
): InspectionNodeId | null {
	for (const node of blueprint.nodes) {
		if (node.node.resolved && node.node.id === widgetId)
			return node.nodeId
	}
	return null
}

function findRuntimeWidget(
	inspection: RuntimeInspection<AnyWidgetPluginTuple>,
	widgetId: string,
): ReturnType<RuntimeInspection<AnyWidgetPluginTuple>['getWidget']> {
	const nodeId = findBlueprintNodeId(inspection.blueprint, widgetId)
	return nodeId === null ? null : inspection.getWidget(nodeId)
}

/** Passive `getSnapshot()`-only reads over one Runtime's inspection facade — see the file header. */
export function createRuntimeReader(runtime: WidgetSystemRuntime<AnyWidgetPluginTuple>): TutorialRuntimeReader {
	const inspection = inspectRuntime(runtime)
	return {
		readState: (widgetId, key) => {
			const widget = findRuntimeWidget(inspection, widgetId)
			return widget?.getState(key)
				?.getSnapshot().value
		},
		readProperty: (widgetId, key): TutorialPropertySnapshot | undefined => {
			const widget = findRuntimeWidget(inspection, widgetId)
			const property = widget?.getProperty(key)
			if (property === null || property === undefined)
				return undefined
			const snapshot = property.getSnapshot()
			return snapshot.status === 'never-evaluated'
				? { status: 'never-evaluated' }
				: { status: 'completed', result: { ok: snapshot.result.ok, value: snapshot.result.ok ? snapshot.result.value : undefined } }
		},
	}
}

/**
 * Subscribes to every resolvable target's underlying State/Property inspection observable, calling
 * `onChange` on each fire — the mechanism `use-tutorial.ts` uses to re-run `TutorialEngine.recheck()`
 * whenever a relevant Runtime primitive changes. An unresolvable target (wrong showcase, unknown id) is
 * silently skipped rather than throwing — `recheck()` predicates already treat an unresolved read as
 * `undefined` and fail closed. Returns one aggregate teardown; safe to call multiple times.
 */
export function subscribeObservationTargets(
	runtime: WidgetSystemRuntime<AnyWidgetPluginTuple>,
	targets: readonly TutorialObservationTarget[],
	onChange: () => void,
): () => void {
	const inspection = inspectRuntime(runtime)
	const unsubscribes: Array<() => void> = []

	for (const target of targets) {
		const widget = findRuntimeWidget(inspection, target.widgetId)
		if (widget === null)
			continue

		if (target.member.type === 'state') {
			const state = widget.getState(target.member.key)
			if (state !== null)
				unsubscribes.push(state.subscribe(onChange))
		}
		else {
			const property = widget.getProperty(target.member.key)
			if (property !== null)
				unsubscribes.push(property.subscribe(onChange))
		}
	}

	return () => {
		for (const unsubscribe of unsubscribes) unsubscribe()
	}
}
