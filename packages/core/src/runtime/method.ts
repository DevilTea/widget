/**
 * RuntimeMethod primitive.
 *
 * Every invocation is one `alien-signals` batch boundary (start before `validateArgs`, end only after
 * the method's final issue snapshot commits, `endBatch()` always in `finally`). Nested
 * dependency-invoked methods reuse this exact same pipeline, so nested calls naturally nest batch
 * depth; only the outermost `endBatch()` flushes.
 *
 * The issue-snapshot commits go through `writeDeferringFlush`, which keeps that rule true one level
 * further out: a Property may declare a dependency on a write-free Method, so `invoke` can run inside a
 * Property evaluator, and there the invocation's own `endBatch()` must not be the frame that flushes —
 * doing so re-enters alien-signals' propagation while the evaluating computed is uncommitted (the helper
 * documents the mechanism). The still-open deferral level keeps this `endBatch()` from reaching depth `0`,
 * and the flush happens once the outermost enclosing read/write call is leaving instead.
 *
 * Normative source: issue #10 consolidated handoff §15, amendment "RuntimeMethod invocation as
 * alien-signals batch boundary".
 */

import type { ExecutionResult } from '../execution-result'
import type { RuntimeMethod } from '../internal/contract'
import type { RelativeValueIssueInput, RuntimeMethodIssue } from '../issue'
import type { ErasedWidgetMethodDefinition } from '../plugin'
import type { WidgetId, WidgetMemberKey } from '../types'
import type { ActiveIssueSink, RuntimeContext } from './context'
import { endBatch, signal, startBatch } from 'alien-signals'
import { EMPTY_ISSUES } from '../issue'
import { createTrackedSubscription, runRuntimeOperation, writeDeferringFlush } from './adapter'
import { createOperationCollector } from './collector'
import { buildDefaultMethodArgsIssue, buildMethodArgsIssue, buildMethodResultIssue, freezeIssueSnapshot, toIssueSnapshot } from './issues'
import { assertSyncValue } from './sync'

export interface MethodPrimitive {
	/** Tracked raw issue-snapshot read. */
	getIssues: () => readonly RuntimeMethodIssue[]
	public: RuntimeMethod<(...args: readonly unknown[]) => unknown>
}

export interface CreateMethodPrimitiveParams {
	readonly widgetId: WidgetId
	readonly name: WidgetMemberKey
	readonly definition: ErasedWidgetMethodDefinition
	readonly buildConfigFragment: () => Record<string, unknown>
	readonly selfNode: unknown
	readonly blueprintView: unknown
	readonly deps: unknown
}

export function createMethodPrimitive(context: RuntimeContext, params: CreateMethodPrimitiveParams): MethodPrimitive {
	const issuesSignal = signal<readonly RuntimeMethodIssue[]>(EMPTY_ISSUES)

	function invoke(...args: readonly unknown[]): ExecutionResult<unknown, RuntimeMethodIssue> {
		context.assertActive()
		return runRuntimeOperation(() => invokeWithinOperation(...args))
	}

	function invokeWithinOperation(...args: readonly unknown[]): ExecutionResult<unknown, RuntimeMethodIssue> {
		startBatch()
		try {
			const argsCollector = createOperationCollector<RelativeValueIssueInput, RuntimeMethodIssue>()
			const argsCtx = {
				...params.buildConfigFragment(),
				addIssue: argsCollector.addIssue,
				hasAnyIssue: argsCollector.hasAnyIssue,
			}

			const validArgs = params.definition.validateArgs(args, argsCtx)
			assertSyncValue(validArgs, `Method "${params.name}"'s validateArgs`)

			if (!validArgs || argsCollector.hasAnyIssue()) {
				const finalized = argsCollector.finalize(input => buildMethodArgsIssue(params.widgetId, params.name, args, input))
				// `finalize()` already returns a deep-frozen array; the generic-fallback branch builds
				// a fresh array here and needs the same immutable-snapshot treatment (issue #10
				// issue-snapshot contract).
				const issues = finalized.length > 0 ? finalized : freezeIssueSnapshot([buildDefaultMethodArgsIssue(params.widgetId, params.name, args)])
				writeDeferringFlush(() => issuesSignal(issues))
				// `invoke()` doesn't cache its return value, so mutating it can't corrupt a later call
				// the way Property's cached computed result could — freezing the wrapper here is a
				// consistency/defense-in-depth measure, not a fix for a persistence hazard.
				return Object.freeze({ success: false, issues: issues as readonly [RuntimeMethodIssue, ...RuntimeMethodIssue[]] })
			}

			const execCollector = createOperationCollector<RelativeValueIssueInput, RuntimeMethodIssue>()
			const sink: ActiveIssueSink = {
				addFinalizedIssue: (issue, dedupe) => execCollector.addFinalizedIssue(issue as RuntimeMethodIssue, dedupe),
			}

			const executeCtx = {
				args,
				widget: params.selfNode,
				blueprint: params.blueprintView,
				deps: params.deps,
				...params.buildConfigFragment(),
				addIssue: execCollector.addIssue,
				hasAnyIssue: execCollector.hasAnyIssue,
			}

			const value = context.withActiveCollector(sink, () => params.definition.execute(executeCtx))
			assertSyncValue(value, `Method "${params.name}"'s execute`)

			const issues = execCollector.finalize(input => buildMethodResultIssue(params.widgetId, params.name, value, input))
			writeDeferringFlush(() => issuesSignal(toIssueSnapshot(issues)))

			// Same consistency rationale as the validateArgs-failure branch above: not a persistence
			// hazard (each `invoke()` builds a fresh wrapper), but freezing it keeps every
			// `ExecutionResult` returned to plugin/consumer code equally immutable.
			const result: ExecutionResult<unknown, RuntimeMethodIssue> = issues.length > 0
				? { success: false, issues: issues as readonly [RuntimeMethodIssue, ...RuntimeMethodIssue[]] }
				: { success: true, value }
			return Object.freeze(result)
		}
		finally {
			endBatch()
		}
	}

	const callable = ((...args: readonly unknown[]) => invoke(...args)) as RuntimeMethod<(...args: readonly unknown[]) => unknown>

	Object.assign(callable, {
		getIssues() {
			context.assertActive()
			return issuesSignal()
		},
		subscribeIssues(listener: (issues: readonly RuntimeMethodIssue[]) => void) {
			context.assertActive()
			return createTrackedSubscription(context, () => issuesSignal(), listener)
		},
	})

	return {
		getIssues: () => issuesSignal(),
		public: callable,
	}
}
