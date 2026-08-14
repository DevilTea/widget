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
 * One retained-fact channel for the readonly `@deviltea/widget-core/inspection` subpath. Same
 * fact-commit-point discipline as `StateInspectionChannel` in `./state`: published directly from inside
 * the computed body at the exact point a natural recompute actually completes, never by wrapping
 * `getResult()` in a second alien-signals effect.
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
	// Plain lazy-allocated set, same rationale as the State inspection channel: never a global registry.
	let inspectionListeners: Set<(snapshot: PropertyInspectionSnapshot) => void> | null = null

	function publishInspectionCompletion(result: ExecutionResult<unknown, RuntimePropertyIssue>): void {
		inspectionSnapshot = Object.freeze({ status: 'completed', result })
		if (inspectionListeners === null)
			return
		for (const listener of inspectionListeners)
			invokeListenerIsolated(listener, inspectionSnapshot)
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
		// `.get()`/dependency read until the next actual recompute; shallow-freeze the wrapper so
		// external code cannot rewrite `.value`/`.success` in place with no invalidation. `issues` is
		// already deep-frozen (via `finalize()`); `value` is the plugin's own payload and is
		// deliberately left untouched.
		const result: ExecutionResult<unknown, RuntimePropertyIssue> = issues.length > 0
			? { success: false, issues: issues as readonly [RuntimePropertyIssue, ...RuntimePropertyIssue[]] }
			: { success: true, value }
		const frozenResult = Object.freeze(result)

		// Published from directly inside the computed body — the exact fact-commit point of a natural
		// recompute (issue #10 inspection amendment "runtime inspection, materialization, disposal,
		// conformance") — never by wrapping `getResult()`/`resultComputed()` in a second alien-signals
		// effect. Every actual recompute publishes unconditionally, success or semantic failure alike,
		// with no deep-equality suppression: two real completions notify twice even when equal.
		publishInspectionCompletion(frozenResult)

		return frozenResult
	})

	const internal: PropertyPrimitiveInternal = {
		getResult: () => resultComputed(),
		getIssues: () => issuesSignal(),
		inspection: {
			getSnapshot: () => inspectionSnapshot,
			subscribe: (listener) => {
				if (inspectionListeners === null)
					inspectionListeners = new Set()
				inspectionListeners.add(listener)
				return () => inspectionListeners?.delete(listener)
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
