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
import { createTrackedSubscription } from './adapter'
import { createOperationCollector } from './collector'
import { buildPropertyResultIssue } from './issues'
import { assertSyncValue } from './sync'

export interface PropertyPrimitiveInternal {
	/** Tracked, lazy/cached read of the completed `ExecutionResult` snapshot. */
	getResult: () => ExecutionResult<unknown, RuntimePropertyIssue>
	/** Tracked raw issue-snapshot read. Reading this never activates the computed. */
	getIssues: () => readonly RuntimePropertyIssue[]
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

	const resultComputed = computed<ExecutionResult<unknown, RuntimePropertyIssue>>(() => {
		const collector = createOperationCollector<RelativeValueIssueInput, RuntimePropertyIssue>()
		const sink: ActiveIssueSink = {
			addFinalizedIssue: issue => collector.addFinalizedIssue(issue as RuntimePropertyIssue),
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
		issuesSignal(issues)

		return issues.length > 0
			? { success: false, issues: issues as readonly [RuntimePropertyIssue, ...RuntimePropertyIssue[]] }
			: { success: true, value }
	})

	const internal: PropertyPrimitiveInternal = {
		getResult: () => resultComputed(),
		getIssues: () => issuesSignal(),
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
