/**
 * Runtime-owned aggregate Diagnostic query/subscription.
 *
 * Deterministic order: runtime-level diagnostics first, then `CompiledBlueprint.semanticOrder`, then each
 * widget's own aggregate (state members -> property members -> method members, member `Map` insertion
 * (declaration) order, each primitive's own local diagnostic order). Reading either aggregate level never
 * activates Property evaluation because it only ever reads diagnostic signals.
 *
 * `runtime.getDiagnostics()` is defined as the Runtime-level diagnostics plus each `RuntimeWidget.getDiagnostics()`
 * in Blueprint semantic widget order (diagnostic #10 amendment "RuntimeWidget aggregate diagnostic surface");
 * {@link createRuntimeAggregate} composes {@link buildWidgetDiagnosticSnapshot} per widget rather than
 * re-scanning primitives itself, so the two levels cannot silently drift apart.
 *
 * The Runtime level is incremental: every primitive commit marks its widget and bumps one per-Runtime
 * revision signal, so a read re-aggregates only the marked widgets and serves the cached snapshot when
 * nothing was committed, and the root subscription tracks that one signal instead of every primitive's
 * diagnostics signal. A change costs work proportional to the changed widgets and the diagnostics in the
 * new snapshot, never to the number of widgets.
 *
 * Both aggregate levels are framework-owned snapshots: {@link toDiagnosticSnapshot} reuses the canonical
 * `EMPTY_DIAGNOSTICS` identity when empty and freezes the composed array itself otherwise (amendment
 * "Framework-owned snapshot immutability"). Individual elements are already deep-frozen at their owning
 * primitive, so composition only ever needs to freeze the new wrapper array, never the diagnostics inside it.
 *
 * Normative contract: DevilTea/widget Discussion #12, Core composition architecture topic. Historical source (migrated): diagnostic #10 consolidated handoff §5/§16/§20, amendments "RuntimeWidget aggregate diagnostic
 * surface" and "Framework-owned snapshot immutability".
 */

import type { RuntimeDiagnostic, RuntimeLevelDiagnostic, RuntimeWidgetDiagnostic } from '../diagnostic'
import type { CompiledBlueprint, InternalNodeId } from '../internal/contract'
import type { RuntimeContext } from './context'
import type { PrimitiveRegistryEntry } from './deps'
import { signal } from 'alien-signals'
import { EMPTY_DIAGNOSTICS } from '../diagnostic'
import { createTrackedSubscription, readUntracked } from './adapter'
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

export interface RuntimeAggregate {
	getDiagnostics: () => readonly RuntimeDiagnostic[]
	subscribeDiagnostics: (listener: (diagnostics: readonly RuntimeDiagnostic[]) => void) => () => void
	/**
	 * The hook every primitive of widget `nodeId` calls right after committing a new diagnostic snapshot,
	 * inside the same deferred write (so the revision signal is subject to the same flush deferral).
	 */
	commitHookFor: (nodeId: InternalNodeId) => () => void
}

/** Index of the first element of the ascending `positions` that is `>= position`. */
function lowerBound(positions: readonly number[], position: number): number {
	let low = 0
	let high = positions.length
	while (low < high) {
		const middle = (low + high) >>> 1
		if (positions[middle]! < position)
			low = middle + 1
		else
			high = middle
	}
	return low
}

/**
 * Builds the Runtime-level aggregate. Created before the primitives (they need {@link
 * RuntimeAggregate.commitHookFor}); `registry` is only read once a snapshot is requested.
 */
export function createRuntimeAggregate(
	context: RuntimeContext,
	compiled: CompiledBlueprint,
	registry: ReadonlyMap<InternalNodeId, PrimitiveRegistryEntry>,
	runtimeLevelDiagnostics: readonly RuntimeLevelDiagnostic[],
): RuntimeAggregate {
	const { semanticOrder } = compiled
	// Internal node ids are dense array indexes, so a typed array (-1: not in semantic order) is the
	// cheapest position index to build per Runtime.
	const positionByNodeId = new Int32Array(compiled.nodes.length)
		.fill(-1)
	for (let position = 0; position < semanticOrder.length; position++)
		positionByNodeId[semanticOrder[position]!] = position

	// Each widget's last aggregated snapshot, by semantic-order position.
	const widgetSnapshots: (readonly RuntimeWidgetDiagnostic[])[] = Array.from<readonly RuntimeWidgetDiagnostic[]>({ length: semanticOrder.length })
		.fill(EMPTY_DIAGNOSTICS)
	// Ascending positions whose last aggregated snapshot is non-empty: composition visits only these.
	const nonEmptyPositions: number[] = []
	// Positions committed to since the last aggregation, each listed once.
	let dirtyPositions: number[] = []
	const isDirty = new Uint8Array(semanticOrder.length)
	let needsFullScan = true
	let cached: readonly RuntimeDiagnostic[] | null = null

	let revision = 0
	const revisionSignal = signal(revision)

	function markDirty(position: number): void {
		if (isDirty[position] === 1)
			return
		isDirty[position] = 1
		dirtyPositions.push(position)
	}

	/** Re-aggregates one widget; returns whether its snapshot identity changed. */
	function refreshWidget(position: number): boolean {
		const entry = registry.get(semanticOrder[position]!)
		const next = entry === undefined ? EMPTY_DIAGNOSTICS : buildWidgetDiagnosticSnapshot(entry)
		const previous = widgetSnapshots[position]!
		if (next === previous)
			return false
		widgetSnapshots[position] = next
		if ((previous.length === 0) !== (next.length === 0)) {
			const index = lowerBound(nonEmptyPositions, position)
			if (next.length === 0)
				nonEmptyPositions.splice(index, 1)
			else
				nonEmptyPositions.splice(index, 0, position)
		}
		return true
	}

	function refreshDirtyWidgets(): boolean {
		let changed = false
		if (needsFullScan) {
			needsFullScan = false
			for (let position = 0; position < semanticOrder.length; position++)
				changed = refreshWidget(position) || changed
		}
		else {
			for (const position of dirtyPositions)
				changed = refreshWidget(position) || changed
		}
		for (const position of dirtyPositions)
			isDirty[position] = 0
		dirtyPositions = []
		return changed
	}

	function compose(): readonly RuntimeDiagnostic[] {
		if (nonEmptyPositions.length === 0)
			return runtimeLevelDiagnostics.length === 0 ? EMPTY_DIAGNOSTICS : runtimeLevelDiagnostics
		const result: RuntimeDiagnostic[] = [...runtimeLevelDiagnostics]
		for (const position of nonEmptyPositions) {
			for (const diagnostic of widgetSnapshots[position]!)
				result.push(diagnostic)
		}
		return toDiagnosticSnapshot(result)
	}

	const snapshot = (): readonly RuntimeDiagnostic[] => {
		// Tracked: a root subscription re-runs after any commit. The primitive signals behind the dirty
		// widgets are read untracked, so the subscription never depends on every primitive.
		revisionSignal()
		if (cached !== null && !needsFullScan && dirtyPositions.length === 0)
			return cached
		const changed = readUntracked(refreshDirtyWidgets)
		if (changed || cached === null)
			cached = compose()
		return cached
	}

	return {
		getDiagnostics() {
			context.assertActive()
			return snapshot()
		},
		subscribeDiagnostics(listener) {
			context.assertActive()
			// The revision signal changes on every commit, including commits a batch undoes before it
			// flushes; notify only when the aggregate actually changed, as tracking each primitive did.
			let delivered = readUntracked(snapshot)
			return createTrackedSubscription(context, snapshot, (next) => {
				if (next === delivered)
					return
				delivered = next
				listener(next)
			})
		},
		commitHookFor(nodeId) {
			const position = positionByNodeId[nodeId] ?? -1
			return () => {
				if (position !== -1)
					markDirty(position)
				revisionSignal(++revision)
			}
		},
	}
}
