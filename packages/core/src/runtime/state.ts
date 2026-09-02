/**
 * RuntimeState primitive.
 *
 * Backed by two independent `alien-signals` signals (value, diagnostics) per diagnostic #10 consolidated
 * handoff §13. `attemptSet` is the single authoritative candidate-acceptance path shared by direct
 * `set()`, state initialization (defaults/overrides) and dependency `state-set` crossings.
 */

import type { RelativeValueDiagnosticInput, RuntimeStateDiagnostic } from '../diagnostic'
import type { ExecutionResult } from '../execution-result'
import type { RuntimeState } from '../internal/contract'
import type { ErasedWidgetStateMemberDefinition } from '../plugin'
import type { WidgetId, WidgetMemberKey } from '../types'
import type { RuntimeContext } from './context'
import { signal } from 'alien-signals'
import { EMPTY_DIAGNOSTICS } from '../diagnostic'
import { createTrackedSubscription, invokeListenerIsolated, runRuntimeOperation, writeDeferringFlush } from './adapter'
import { createOperationCollector } from './collector'
import { buildDefaultStateValidationDiagnostic, buildStateValidationDiagnostic, freezeDiagnosticSnapshot } from './diagnostics'
import { assertSyncValue } from './sync'

/**
 * One retained-fact channel for the readonly `@deviltea/widget-core/inspection` subpath: a frozen
 * current-value envelope plus plain, lazily-allocated listeners. Retention starts at primitive creation
 * (Runtime creation), independent of whether an inspector ever attaches — a later-created inspector must
 * not be amnesiac. Deliberately not built on `effect()`/`createTrackedSubscription`: the envelope is
 * published directly at `attemptSet`'s fact-commit point (the normal semantic pipeline), never by
 * wrapping a semantic read in an alien-signals effect, so inspection can never itself widen the reactive
 * graph.
 */
export interface StateInspectionChannel {
	getSnapshot: () => Readonly<{ value: unknown }>
	subscribe: (listener: (snapshot: Readonly<{ value: unknown }>) => void) => () => void
}

export interface StatePrimitiveInternal {
	/** Tracked raw value read. `null` when never successfully initialized/written. */
	get: () => unknown
	/** Tracked raw diagnostic-snapshot read. Reading this never touches the value signal. */
	getDiagnostics: () => readonly RuntimeStateDiagnostic[]
	/**
	 * The authoritative candidate-acceptance path. Used by `RuntimeState.set`, state initialization
	 * and dependency `state-set` crossings alike.
	 */
	attemptSet: (candidate: unknown) => ExecutionResult<unknown, RuntimeStateDiagnostic>
	/** Readonly-inspection retained-fact channel. See {@link StateInspectionChannel}. */
	readonly inspection: StateInspectionChannel
}

export interface StatePrimitive {
	readonly internal: StatePrimitiveInternal
	readonly public: RuntimeState<unknown>
}

export interface CreateStatePrimitiveParams {
	readonly widgetId: WidgetId
	readonly key: WidgetMemberKey
	readonly definition: ErasedWidgetStateMemberDefinition
	/** Returns `{ config }` when the owning widget has config capability, `{}` otherwise. */
	readonly buildConfigFragment: () => Record<string, unknown>
}

export function createStatePrimitive(context: RuntimeContext, params: CreateStatePrimitiveParams): StatePrimitive {
	const valueSignal = signal<unknown>(null)
	const diagnosticsSignal = signal<readonly RuntimeStateDiagnostic[]>(EMPTY_DIAGNOSTICS)

	let inspectionSnapshot: Readonly<{ value: unknown }> = Object.freeze({ value: null })
	// Plain lazy-allocated registration list (diagnostic #10 inspection amendment "runtime inspection,
	// materialization, disposal, conformance"): never a global registry, allocated only once something
	// actually subscribes. Not a `Set` keyed by the listener function itself — two independent
	// `subscribe(sameFn)` calls must stay two independent registrations, exactly like the
	// alien-signals-effect-backed `createTrackedSubscription` never dedupes by listener identity either.
	interface ListenerEntry { readonly listener: (snapshot: Readonly<{ value: unknown }>) => void }
	let inspectionListeners: ListenerEntry[] | null = null

	function publishInspectionSnapshot(value: unknown): void {
		inspectionSnapshot = Object.freeze({ value })
		if (inspectionListeners === null)
			return
		// Iterate a stable snapshot taken at publication start: a listener that itself calls `subscribe()`
		// during this loop must not have its new registration visited by *this* publication (future-changes
		// -only / no-immediate-emission), which a live-array/live-Set iteration could otherwise do.
		const listenersSnapshot = inspectionListeners.slice()
		for (const entry of listenersSnapshot)
			invokeListenerIsolated(entry.listener, inspectionSnapshot)
	}

	/**
	 * The value write below is what makes the whole dependent Property graph recompute, and those
	 * recomputes commit their own diagnostic snapshots from inside their evaluators. Wrapping the pipeline in
	 * `runRuntimeOperation` is only what tells `writeDeferringFlush` when those evaluators are all back
	 * out of the graph, so the propagations they deferred are released here: still inside the very `set()`
	 * call that caused them, before its `ExecutionResult` reaches the caller.
	 */
	function attemptSet(candidate: unknown): ExecutionResult<unknown, RuntimeStateDiagnostic> {
		return runRuntimeOperation(() => attemptSetWithinOperation(candidate))
	}

	function attemptSetWithinOperation(candidate: unknown): ExecutionResult<unknown, RuntimeStateDiagnostic> {
		const collector = createOperationCollector<RelativeValueDiagnosticInput, RuntimeStateDiagnostic>()
		const ctx = {
			...params.buildConfigFragment(),
			addDiagnostic: collector.addDiagnostic,
			hasAnyDiagnostic: collector.hasAnyDiagnostic,
		}

		const isValid = params.definition.validate(candidate, ctx)
		assertSyncValue(isValid, `State "${params.key}"'s validate`)

		if (!isValid || collector.hasAnyDiagnostic()) {
			const finalized = collector.finalize(input => buildStateValidationDiagnostic(params.widgetId, params.key, candidate, input))
			// `finalize()` already returns a deep-frozen array; the generic-fallback branch builds a
			// fresh array here and needs the same immutable-snapshot treatment (diagnostic #10 diagnostic-snapshot
			// contract).
			const diagnostics = finalized.length > 0 ? finalized : freezeDiagnosticSnapshot([buildDefaultStateValidationDiagnostic(params.widgetId, params.key, candidate)])
			writeDeferringFlush(() => diagnosticsSignal(diagnostics))
			return { ok: false, failure: { diagnostics: diagnostics as readonly [RuntimeStateDiagnostic, ...RuntimeStateDiagnostic[]] } }
		}

		// Top-level semantic execution values (state values included) must not be `PromiseLike`; a
		// candidate that would otherwise be accepted must not become the live State value if it is
		// thenable (diagnostic #10 amendment "synchronous core boundary and future async seams").
		assertSyncValue(candidate, `State "${params.key}"'s value`)

		// Read the pre-write raw value before committing, using the exact strict-inequality comparison
		// `alien-signals`' own signal uses to decide whether a write actually changes anything (see the
		// state conformance regressions: `NaN -> NaN` counts as changed, `+0 -> -0` does not). Publishing
		// the inspection fact only on an authoritative change keeps inspection from becoming a second,
		// looser change detector.
		const previous = valueSignal()
		valueSignal(candidate)
		writeDeferringFlush(() => diagnosticsSignal(EMPTY_DIAGNOSTICS))
		if (candidate !== previous)
			publishInspectionSnapshot(candidate)
		return { ok: true, value: candidate }
	}

	const internal: StatePrimitiveInternal = {
		get: () => valueSignal(),
		getDiagnostics: () => diagnosticsSignal(),
		attemptSet,
		inspection: {
			getSnapshot: () => inspectionSnapshot,
			subscribe: (listener) => {
				const entry: ListenerEntry = { listener }
				if (inspectionListeners === null)
					inspectionListeners = []
				inspectionListeners.push(entry)
				return () => {
					if (inspectionListeners === null)
						return
					const index = inspectionListeners.indexOf(entry)
					if (index !== -1)
						inspectionListeners.splice(index, 1)
				}
			},
		},
	}

	const publicState: RuntimeState<unknown> = {
		get() {
			context.assertActive()
			return internal.get()
		},
		set(value: unknown) {
			context.assertActive()
			return internal.attemptSet(value)
		},
		subscribe(listener) {
			context.assertActive()
			return createTrackedSubscription(context, internal.get, listener)
		},
		getDiagnostics() {
			context.assertActive()
			return internal.getDiagnostics()
		},
		subscribeDiagnostics(listener) {
			context.assertActive()
			return createTrackedSubscription(context, internal.getDiagnostics, listener)
		},
	}

	return { internal, public: publicState }
}
