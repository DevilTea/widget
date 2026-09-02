/**
 * RuntimeProperty primitive.
 *
 * Lazy/cached `alien-signals` computed whose reactive value is the fresh completed
 * `ExecutionResult` snapshot (not the raw value alone), so every actual recompute has fresh identity
 * and notifies subscribers exactly once even when the raw value compares equal. Diagnostics live on a
 * separate signal written as a side effect of evaluation; `subscribeDiagnostics`/`getDiagnostics` only ever
 * touch that signal, never the computed, so they never activate evaluation. That in-evaluator write is
 * committed through `writeDeferringFlush`, so watching the diagnostics channel can never perturb value
 * propagation (see the `alien-signals@3.2.1` mechanism documented on that helper).
 *
 * Normative source: diagnostic #10 consolidated handoff §14, amendment "Implementation verification —
 * alien-signals@3.2.1 conformance" (#4).
 */

import type { RelativeValueDiagnosticInput, RuntimePropertyDiagnostic } from '../diagnostic'
import type { ExecutionResult } from '../execution-result'
import type { RuntimeProperty } from '../internal/contract'
import type { ErasedWidgetPropertyDefinition } from '../plugin'
import type { WidgetId, WidgetMemberKey } from '../types'
import type { ActiveDiagnosticSink, RuntimeContext } from './context'
import { computed, signal } from 'alien-signals'
import { EMPTY_DIAGNOSTICS } from '../diagnostic'
import { createTrackedSubscription, invokeListenerIsolated, runRuntimeOperation, writeDeferringFlush } from './adapter'
import { createOperationCollector } from './collector'
import { buildPropertyResultDiagnostic, toDiagnosticSnapshot } from './diagnostics'
import { assertSyncValue } from './sync'

/**
 * Readonly-inspection `RuntimePropertyInspectionSnapshot`-shaped envelope, kept structural here (no
 * import from the `inspection` subpath — this internal module must stay usable independent of it).
 */
export type PropertyInspectionSnapshot
	= | { readonly status: 'never-evaluated' }
		| { readonly status: 'completed', readonly result: ExecutionResult<unknown, RuntimePropertyDiagnostic> }

/** The frozen singleton every Property inspection channel starts at and returns to before first evaluation. */
const NEVER_EVALUATED_SNAPSHOT: PropertyInspectionSnapshot = Object.freeze({ status: 'never-evaluated' })

/**
 * One retained-fact channel for the readonly `@deviltea/widget-core/inspection` subpath. Published only
 * after `resultComputed()` has returned — see `getResultWithInspectionPublish` below for why publishing
 * from inside the computed getter body is wrong — and never by wrapping `getResult()` in a second
 * alien-signals effect.
 */
export interface PropertyInspectionChannel {
	getSnapshot: () => PropertyInspectionSnapshot
	subscribe: (listener: (snapshot: PropertyInspectionSnapshot) => void) => () => void
}

export interface PropertyPrimitiveInternal {
	/** Tracked, lazy/cached read of the completed `ExecutionResult` snapshot. */
	getResult: () => ExecutionResult<unknown, RuntimePropertyDiagnostic>
	/** Tracked raw diagnostic-snapshot read. Reading this never activates the computed. */
	getDiagnostics: () => readonly RuntimePropertyDiagnostic[]
	/** Readonly-inspection retained-fact channel. See {@link PropertyInspectionChannel}. */
	readonly inspection: PropertyInspectionChannel
}

export interface PropertyPrimitive {
	readonly internal: PropertyPrimitiveInternal
	readonly public: RuntimeProperty<unknown>
}

export interface CreatePropertyPrimitiveParams {
	readonly widgetId: WidgetId
	readonly name: WidgetMemberKey
	readonly definition: ErasedWidgetPropertyDefinition
	readonly buildConfigFragment: () => Record<string, unknown>
	readonly selfNode: unknown
	readonly blueprintView: unknown
	readonly deps: unknown
}

export function createPropertyPrimitive(context: RuntimeContext, params: CreatePropertyPrimitiveParams): PropertyPrimitive {
	const diagnosticsSignal = signal<readonly RuntimePropertyDiagnostic[]>(EMPTY_DIAGNOSTICS)

	let inspectionSnapshot: PropertyInspectionSnapshot = NEVER_EVALUATED_SNAPSHOT
	// Plain lazy-allocated registration list (not a `Set` keyed by the listener function itself — two
	// independent `subscribe(sameFn)` calls must stay two independent registrations, exactly like the
	// alien-signals-effect-backed `createTrackedSubscription` never dedupes by listener identity either).
	interface ListenerEntry { readonly listener: (snapshot: PropertyInspectionSnapshot) => void }
	let inspectionListeners: ListenerEntry[] | null = null
	let lastPublishedResult: ExecutionResult<unknown, RuntimePropertyDiagnostic> | null = null

	function publishInspectionCompletion(result: ExecutionResult<unknown, RuntimePropertyDiagnostic>): void {
		inspectionSnapshot = Object.freeze({ status: 'completed', result })
		if (inspectionListeners === null)
			return
		// Iterate a stable snapshot taken at publication start: a listener that itself calls `subscribe()`
		// during this loop must not have its new registration visited by *this* publication (future-changes
		// -only / no-immediate-emission), which a live-array/live-Set iteration could otherwise do.
		const listenersSnapshot = inspectionListeners.slice()
		for (const entry of listenersSnapshot)
			invokeListenerIsolated(entry.listener, inspectionSnapshot)
	}

	const resultComputed = computed<ExecutionResult<unknown, RuntimePropertyDiagnostic>>(() => {
		const collector = createOperationCollector<RelativeValueDiagnosticInput, RuntimePropertyDiagnostic>()
		const sink: ActiveDiagnosticSink = {
			addFinalizedDiagnostic: (diagnostic, dedupe) => collector.addFinalizedDiagnostic(diagnostic as RuntimePropertyDiagnostic, dedupe),
		}

		const ctx = {
			widget: params.selfNode,
			blueprint: params.blueprintView,
			deps: params.deps,
			...params.buildConfigFragment(),
			addDiagnostic: collector.addDiagnostic,
			hasAnyDiagnostic: collector.hasAnyDiagnostic,
		}

		const value = context.withActiveCollector(sink, () => params.definition.compute(ctx))
		assertSyncValue(value, `Property "${params.name}"'s compute`)

		const diagnostics = collector.finalize(input => buildPropertyResultDiagnostic(params.widgetId, params.name, value, input))
		// Commit the snapshot here — the fact-commit point every consumer's `getDiagnostics()` must already
		// reflect — but hold its *propagation* inside an alien batch until this evaluation (and whatever
		// drove it) is done. A watched signal write from inside a computed's own evaluator starts a nested
		// alien-signals flush while this computed is mid-`updateComputed`, which permanently marks the
		// Property's other dependents clean-but-stale; `writeDeferringFlush` documents the exact
		// alien-signals@3.2.1 mechanism.
		writeDeferringFlush(() => diagnosticsSignal(toDiagnosticSnapshot(diagnostics)))

		// The alien computed caches this exact object as its reactive value and reuses it for every
		// `.get()`/dependency read until the next actual recompute; shallow-freeze the wrapper so external
		// code cannot rewrite `.value`/`.ok` in place with no invalidation. `diagnostics` is already
		// deep-frozen (via `finalize()`); `value` is the plugin's own payload and is deliberately left
		// untouched.
		const result: ExecutionResult<unknown, RuntimePropertyDiagnostic> = diagnostics.length > 0
			? { ok: false, failure: { diagnostics: diagnostics as readonly [RuntimePropertyDiagnostic, ...RuntimePropertyDiagnostic[]] } }
			: { ok: true, value }
		return Object.freeze(result)
	})

	/**
	 * Reads the computed result through the exact same call every existing consumer already makes, then
	 * publishes the inspection fact only *after* that call has returned.
	 *
	 * In pinned alien-signals@3.2.1 a computed's cache assignment happens as `c.value = c.getter(...)`:
	 * the getter runs to completion *before* the assignment to `c.value` takes effect. Publishing from
	 * inside the getter body (as an earlier revision did) therefore ran before alien-signals had committed
	 * the fresh result to its own cache — a synchronous inspection listener that read the same Property
	 * back through the ordinary `.get()`/computed path during that window could observe the *previous*
	 * cached result (or an inconsistent one on the very first evaluation). Reading `resultComputed()` to
	 * completion here first, and only then comparing/publishing, means the cache is already committed by
	 * the time any listener runs. This is not a second alien-signals effect and creates no new tracked
	 * read: it is a plain post-return identity check on the same synchronous call `getResult()` already
	 * made. Every actual recompute produces a brand-new frozen `ExecutionResult` literal (see above), so
	 * comparing by reference — never by value — still notifies twice for two equal-value completions while
	 * never re-publishing a merely-re-read, already-cached result.
	 */
	function getResultWithInspectionPublish(): ExecutionResult<unknown, RuntimePropertyDiagnostic> {
		// `runRuntimeOperation` only records that an evaluation may start here: when this read is the
		// outermost such call, the diagnostic-snapshot propagations deferred during the evaluation are released
		// as soon as the computed has committed — before the inspection publication below, exactly the
		// order a direct in-evaluator write produced. A nested read (a dependent Property's evaluator, or
		// an effect run inside a state write's flush) leaves the release to the outermost call instead.
		const result = runRuntimeOperation(resultComputed)
		if (result !== lastPublishedResult) {
			lastPublishedResult = result
			publishInspectionCompletion(result)
		}
		return result
	}

	const internal: PropertyPrimitiveInternal = {
		getResult: getResultWithInspectionPublish,
		getDiagnostics: () => diagnosticsSignal(),
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

	const publicProperty: RuntimeProperty<unknown> = {
		get() {
			context.assertActive()
			return internal.getResult()
		},
		subscribe(listener) {
			context.assertActive()
			return createTrackedSubscription(context, internal.getResult, listener)
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

	return { internal, public: publicProperty }
}
