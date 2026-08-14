/**
 * RuntimeProperty primitive.
 *
 * Lazy/cached `alien-signals` computed whose reactive value is the fresh completed
 * `ExecutionResult` snapshot (not the raw value alone), so every actual recompute has fresh identity
 * and notifies subscribers exactly once even when the raw value compares equal. Issues live on a
 * separate signal written as a side effect of evaluation; `subscribeIssues`/`getIssues` only ever
 * touch that signal, never the computed, so they never activate evaluation.
 *
 * Normative source: issue #10 consolidated handoff §14, amendment "Implementation verification —
 * alien-signals@3.2.1 conformance" (#4).
 */

import type { ExecutionResult } from '../execution-result'
import type { RuntimeProperty } from '../internal/contract'
import type { RelativeValueIssueInput, RuntimePropertyIssue } from '../issue'
import type { ErasedWidgetPropertyDefinition } from '../plugin'
import type { WidgetId, WidgetMemberKey } from '../types'
import type { ActiveIssueSink, RuntimeContext } from './context'
import { computed, signal } from 'alien-signals'
import { EMPTY_ISSUES } from '../issue'
import { createTrackedSubscription, invokeListenerIsolated } from './adapter'
import { createOperationCollector } from './collector'
import { buildPropertyResultIssue, toIssueSnapshot } from './issues'
import { assertSyncValue } from './sync'

/**
 * Readonly-inspection `RuntimePropertyInspectionSnapshot`-shaped envelope, kept structural here (no
 * import from the `inspection` subpath — this internal module must stay usable independent of it).
 */
export type PropertyInspectionSnapshot
	= | { readonly status: 'never-evaluated' }
		| { readonly status: 'completed', readonly result: ExecutionResult<unknown, RuntimePropertyIssue> }

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
	getResult: () => ExecutionResult<unknown, RuntimePropertyIssue>
	/** Tracked raw issue-snapshot read. Reading this never activates the computed. */
	getIssues: () => readonly RuntimePropertyIssue[]
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
	const issuesSignal = signal<readonly RuntimePropertyIssue[]>(EMPTY_ISSUES)

	let inspectionSnapshot: PropertyInspectionSnapshot = NEVER_EVALUATED_SNAPSHOT
	// Plain lazy-allocated registration list (not a `Set` keyed by the listener function itself — two
	// independent `subscribe(sameFn)` calls must stay two independent registrations, exactly like the
	// alien-signals-effect-backed `createTrackedSubscription` never dedupes by listener identity either).
	interface ListenerEntry { readonly listener: (snapshot: PropertyInspectionSnapshot) => void }
	let inspectionListeners: ListenerEntry[] | null = null
	let lastPublishedResult: ExecutionResult<unknown, RuntimePropertyIssue> | null = null

	function publishInspectionCompletion(result: ExecutionResult<unknown, RuntimePropertyIssue>): void {
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

	const resultComputed = computed<ExecutionResult<unknown, RuntimePropertyIssue>>(() => {
		const collector = createOperationCollector<RelativeValueIssueInput, RuntimePropertyIssue>()
		const sink: ActiveIssueSink = {
			addFinalizedIssue: (issue, dedupe) => collector.addFinalizedIssue(issue as RuntimePropertyIssue, dedupe),
		}

		const ctx = {
			widget: params.selfNode,
			blueprint: params.blueprintView,
			deps: params.deps,
			...params.buildConfigFragment(),
			addIssue: collector.addIssue,
			hasAnyIssue: collector.hasAnyIssue,
		}

		const value = context.withActiveCollector(sink, () => params.definition.compute(ctx))
		assertSyncValue(value, `Property "${params.name}"'s compute`)

		const issues = collector.finalize(input => buildPropertyResultIssue(params.widgetId, params.name, value, input))
		issuesSignal(toIssueSnapshot(issues))

		// The alien computed caches this exact object as its reactive value and reuses it for every
		// `.get()`/dependency read until the next actual recompute; shallow-freeze the wrapper so external
		// code cannot rewrite `.value`/`.success` in place with no invalidation. `issues` is already
		// deep-frozen (via `finalize()`); `value` is the plugin's own payload and is deliberately left
		// untouched.
		const result: ExecutionResult<unknown, RuntimePropertyIssue> = issues.length > 0
			? { success: false, issues: issues as readonly [RuntimePropertyIssue, ...RuntimePropertyIssue[]] }
			: { success: true, value }
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
	function getResultWithInspectionPublish(): ExecutionResult<unknown, RuntimePropertyIssue> {
		const result = resultComputed()
		if (result !== lastPublishedResult) {
			lastPublishedResult = result
			publishInspectionCompletion(result)
		}
		return result
	}

	const internal: PropertyPrimitiveInternal = {
		getResult: getResultWithInspectionPublish,
		getIssues: () => issuesSignal(),
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
		getIssues() {
			context.assertActive()
			return internal.getIssues()
		},
		subscribeIssues(listener) {
			context.assertActive()
			return createTrackedSubscription(context, internal.getIssues, listener)
		},
	}

	return { internal, public: publicProperty }
}
