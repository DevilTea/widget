/**
 * Runtime-owned aggregate Issue query/subscription.
 *
 * Deterministic order: runtime-level issues first, then `CompiledBlueprint.semanticOrder`, then each
 * widget's own aggregate (state members -> property members -> method members, member `Map` insertion
 * (declaration) order, each primitive's own local issue order). Reading either aggregate level never
 * activates Property evaluation because it only ever reads issue signals.
 *
 * `runtime.getCollectedIssues()` is defined as `runtime.getIssues()` plus each `RuntimeWidget.getIssues()`
 * in Blueprint semantic widget order (issue #10 amendment "RuntimeWidget aggregate issue surface");
 * {@link buildAggregateSnapshot} composes {@link buildWidgetIssueSnapshot} per widget rather than
 * re-scanning primitives itself, so the two levels cannot silently drift apart.
 *
 * Normative source: issue #10 consolidated handoff §5/§16/§20, amendment "RuntimeWidget aggregate issue
 * surface".
 */

import type { CompiledBlueprint, InternalNodeId } from '../internal/contract'
import type { RuntimeLevelIssue, RuntimeWidgetIssue, WidgetSystemRuntimeIssue } from '../issue'
import type { RuntimeContext } from './context'
import type { PrimitiveRegistryEntry } from './deps'
import { createTrackedSubscription } from './adapter'
import { toIssueSnapshot } from './issues'

/**
 * One `RuntimeWidget`'s own aggregate snapshot: only issues owned by that widget's primitives, never
 * Runtime-level issues even when their source mentions the same `widgetId`. Reuses the canonical empty
 * snapshot identity when the widget currently owns no issue (no capability, or every primitive
 * currently succeeds).
 */
export function buildWidgetIssueSnapshot(entry: PrimitiveRegistryEntry): readonly RuntimeWidgetIssue[] {
	const result: RuntimeWidgetIssue[] = []

	for (const primitive of entry.state.values())
		result.push(...primitive.internal.getIssues())

	for (const primitive of entry.properties.values())
		result.push(...primitive.internal.getIssues())

	for (const primitive of entry.methods.values())
		result.push(...primitive.getIssues())

	return toIssueSnapshot(result)
}

export interface RuntimeWidgetIssuesAggregate {
	getIssues: () => readonly RuntimeWidgetIssue[]
	subscribeIssues: (listener: (issues: readonly RuntimeWidgetIssue[]) => void) => () => void
}

/**
 * Builds the live-gated `getIssues`/`subscribeIssues` pair one `RuntimeWidget` exposes, composing
 * {@link buildWidgetIssueSnapshot} the same way {@link createRuntimeAggregate} composes it for every
 * widget at the Runtime level.
 */
export function createRuntimeWidgetIssuesAggregate(
	context: RuntimeContext,
	entry: PrimitiveRegistryEntry,
): RuntimeWidgetIssuesAggregate {
	const snapshot = () => buildWidgetIssueSnapshot(entry)

	return {
		getIssues() {
			context.assertActive()
			return snapshot()
		},
		subscribeIssues(listener) {
			context.assertActive()
			return createTrackedSubscription(context, snapshot, listener)
		},
	}
}

export function buildAggregateSnapshot(
	compiled: CompiledBlueprint,
	registry: ReadonlyMap<InternalNodeId, PrimitiveRegistryEntry>,
	runtimeLevelIssues: readonly RuntimeLevelIssue[],
): readonly WidgetSystemRuntimeIssue[] {
	const result: WidgetSystemRuntimeIssue[] = [...runtimeLevelIssues]

	for (const nodeId of compiled.semanticOrder) {
		const entry = registry.get(nodeId)
		if (entry === undefined)
			continue

		result.push(...buildWidgetIssueSnapshot(entry))
	}

	return result
}

export interface RuntimeAggregate {
	getIssues: () => readonly RuntimeLevelIssue[]
	getCollectedIssues: () => readonly WidgetSystemRuntimeIssue[]
	subscribeCollectedIssues: (listener: (issues: readonly WidgetSystemRuntimeIssue[]) => void) => () => void
}

export function createRuntimeAggregate(
	context: RuntimeContext,
	compiled: CompiledBlueprint,
	registry: ReadonlyMap<InternalNodeId, PrimitiveRegistryEntry>,
	runtimeLevelIssues: readonly RuntimeLevelIssue[],
): RuntimeAggregate {
	const snapshot = () => buildAggregateSnapshot(compiled, registry, runtimeLevelIssues)

	return {
		getIssues() {
			context.assertActive()
			return runtimeLevelIssues
		},
		getCollectedIssues() {
			context.assertActive()
			return snapshot()
		},
		subscribeCollectedIssues(listener) {
			context.assertActive()
			return createTrackedSubscription(context, snapshot, listener)
		},
	}
}
