/**
 * Runtime-owned aggregate Diagnostic query/subscription.
 *
 * Deterministic order: runtime-level diagnostics first, then `CompiledBlueprint.semanticOrder`, then each
 * widget's own aggregate (state members -> property members -> method members, member `Map` insertion
 * (declaration) order, each primitive's own local diagnostic order). Reading either aggregate level never
 * activates Property evaluation because it only ever reads diagnostic signals.
 *
 * `runtime.getDiagnostics()` is defined as `runtime.getDiagnostics()` plus each `RuntimeWidget.getDiagnostics()`
 * in Blueprint semantic widget order (diagnostic #10 amendment "RuntimeWidget aggregate diagnostic surface");
 * {@link buildAggregateSnapshot} composes {@link buildWidgetDiagnosticSnapshot} per widget rather than
 * re-scanning primitives itself, so the two levels cannot silently drift apart.
 *
 * Both aggregate levels are framework-owned snapshots: {@link toDiagnosticSnapshot} reuses the canonical
 * `EMPTY_DIAGNOSTICS` identity when empty and freezes the composed array itself otherwise (amendment
 * "Framework-owned snapshot immutability"). Individual elements are already deep-frozen at their owning
 * primitive, so composition only ever needs to freeze the new wrapper array, never the diagnostics inside it.
 *
 * Normative source: diagnostic #10 consolidated handoff §5/§16/§20, amendments "RuntimeWidget aggregate diagnostic
 * surface" and "Framework-owned snapshot immutability".
 */

import type { RuntimeLevelDiagnostic, RuntimeWidgetDiagnostic, WidgetSystemRuntimeDiagnostic } from '../diagnostic'
import type { CompiledBlueprint, InternalNodeId } from '../internal/contract'
import type { RuntimeContext } from './context'
import type { PrimitiveRegistryEntry } from './deps'
import { createTrackedSubscription } from './adapter'
import { toDiagnosticSnapshot } from './diagnostics'

interface CachedWidgetSnapshot {
	readonly primitiveSnapshots: readonly (readonly RuntimeWidgetDiagnostic[])[]
	readonly snapshot: readonly RuntimeWidgetDiagnostic[]
}

const widgetSnapshotCache = new WeakMap<PrimitiveRegistryEntry, CachedWidgetSnapshot>()

/**
 * One `RuntimeWidget`'s own aggregate snapshot: only diagnostics owned by that widget's primitives, never
 * Runtime-level diagnostics even when their source mentions the same `widgetId`. Reuses the canonical empty
 * snapshot identity when the widget currently owns no diagnostic (no capability, or every primitive
 * currently succeeds).
 */
export function buildWidgetDiagnosticSnapshot(entry: PrimitiveRegistryEntry): readonly RuntimeWidgetDiagnostic[] {
	const primitiveSnapshots = [
		...Array.from(entry.state.values(), primitive => primitive.internal.getDiagnostics()),
		...Array.from(entry.properties.values(), primitive => primitive.internal.getDiagnostics()),
		...Array.from(entry.methods.values(), primitive => primitive.getDiagnostics()),
	] as readonly (readonly RuntimeWidgetDiagnostic[])[]

	const previous = widgetSnapshotCache.get(entry)
	if (previous !== undefined
		&& previous.primitiveSnapshots.length === primitiveSnapshots.length
		&& primitiveSnapshots.every((snapshot, index) => snapshot === previous.primitiveSnapshots[index])) {
		return previous.snapshot
	}

	const result = toDiagnosticSnapshot(primitiveSnapshots.flat())
	widgetSnapshotCache.set(entry, { primitiveSnapshots, snapshot: result })
	return result
}

export interface RuntimeWidgetDiagnosticsAggregate {
	getDiagnostics: () => readonly RuntimeWidgetDiagnostic[]
	subscribeDiagnostics: (listener: (diagnostics: readonly RuntimeWidgetDiagnostic[]) => void) => () => void
}

/**
 * Builds the live-gated `getDiagnostics`/`subscribeDiagnostics` pair one `RuntimeWidget` exposes, composing
 * {@link buildWidgetDiagnosticSnapshot} the same way {@link createRuntimeAggregate} composes it for every
 * widget at the Runtime level.
 */
export function createRuntimeWidgetDiagnosticsAggregate(
	context: RuntimeContext,
	entry: PrimitiveRegistryEntry,
): RuntimeWidgetDiagnosticsAggregate {
	const snapshot = () => buildWidgetDiagnosticSnapshot(entry)

	return {
		getDiagnostics() {
			context.assertActive()
			return snapshot()
		},
		subscribeDiagnostics(listener) {
			context.assertActive()
			return createTrackedSubscription(context, snapshot, listener)
		},
	}
}

export function buildAggregateSnapshot(
	compiled: CompiledBlueprint,
	registry: ReadonlyMap<InternalNodeId, PrimitiveRegistryEntry>,
	runtimeLevelDiagnostics: readonly RuntimeLevelDiagnostic[],
): readonly WidgetSystemRuntimeDiagnostic[] {
	const result: WidgetSystemRuntimeDiagnostic[] = [...runtimeLevelDiagnostics]

	for (const nodeId of compiled.semanticOrder) {
		const entry = registry.get(nodeId)
		if (entry === undefined)
			continue

		result.push(...buildWidgetDiagnosticSnapshot(entry))
	}

	return toDiagnosticSnapshot(result)
}

export interface RuntimeAggregate {
	getDiagnostics: () => readonly WidgetSystemRuntimeDiagnostic[]
	subscribeDiagnostics: (listener: (diagnostics: readonly WidgetSystemRuntimeDiagnostic[]) => void) => () => void
}

export function createRuntimeAggregate(
	context: RuntimeContext,
	compiled: CompiledBlueprint,
	registry: ReadonlyMap<InternalNodeId, PrimitiveRegistryEntry>,
	runtimeLevelDiagnostics: readonly RuntimeLevelDiagnostic[],
): RuntimeAggregate {
	let previousChildren: readonly (readonly RuntimeWidgetDiagnostic[])[] | undefined
	let previousSnapshot: readonly WidgetSystemRuntimeDiagnostic[] | undefined
	const snapshot = (): readonly WidgetSystemRuntimeDiagnostic[] => {
		const children = compiled.semanticOrder
			.map(nodeId => registry.get(nodeId))
			.filter((entry): entry is PrimitiveRegistryEntry => entry !== undefined)
			.map(entry => buildWidgetDiagnosticSnapshot(entry))

		if (previousSnapshot !== undefined
			&& previousChildren !== undefined
			&& previousChildren.length === children.length
			&& previousChildren.every((child, index) => child === children[index])) {
			return previousSnapshot
		}

		const result: WidgetSystemRuntimeDiagnostic[] = [...runtimeLevelDiagnostics]
		for (const child of children)
			result.push(...child)
		previousChildren = children
		previousSnapshot = toDiagnosticSnapshot(result)
		return previousSnapshot
	}

	return {
		getDiagnostics() {
			context.assertActive()
			return snapshot()
		},
		subscribeDiagnostics(listener) {
			context.assertActive()
			return createTrackedSubscription(context, snapshot, listener)
		},
	}
}
