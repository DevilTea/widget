/**
 * RuntimeState primitive.
 *
 * Backed by two independent `alien-signals` signals (value, issues) per issue #10 consolidated
 * handoff §13. `attemptSet` is the single authoritative candidate-acceptance path shared by direct
 * `set()`, state initialization (defaults/overrides) and dependency `state-set` crossings.
 */

import type { ExecutionResult } from '../execution-result'
import type { RuntimeState } from '../internal/contract'
import type { RelativeValueIssueInput, RuntimeStateIssue } from '../issue'
import type { ErasedWidgetStateMemberDefinition } from '../plugin'
import type { WidgetId, WidgetMemberKey } from '../types'
import type { RuntimeContext } from './context'
import { signal } from 'alien-signals'
import { EMPTY_ISSUES } from '../issue'
import { createTrackedSubscription } from './adapter'
import { createOperationCollector } from './collector'
import { buildDefaultStateValidationIssue, buildStateValidationIssue, freezeIssueSnapshot } from './issues'
import { assertSyncValue } from './sync'

export interface StatePrimitiveInternal {
	/** Tracked raw value read. `null` when never successfully initialized/written. */
	get: () => unknown
	/** Tracked raw issue-snapshot read. Reading this never touches the value signal. */
	getIssues: () => readonly RuntimeStateIssue[]
	/**
	 * The authoritative candidate-acceptance path. Used by `RuntimeState.set`, state initialization
	 * and dependency `state-set` crossings alike.
	 */
	attemptSet: (candidate: unknown) => ExecutionResult<unknown, RuntimeStateIssue>
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
	const issuesSignal = signal<readonly RuntimeStateIssue[]>(EMPTY_ISSUES)

	function attemptSet(candidate: unknown): ExecutionResult<unknown, RuntimeStateIssue> {
		const collector = createOperationCollector<RelativeValueIssueInput, RuntimeStateIssue>()
		const ctx = {
			...params.buildConfigFragment(),
			addIssue: collector.addIssue,
			hasAnyIssue: collector.hasAnyIssue,
		}

		const isValid = params.definition.validate(candidate, ctx)
		assertSyncValue(isValid, `State "${params.key}"'s validate`)

		if (!isValid || collector.hasAnyIssue()) {
			const finalized = collector.finalize(input => buildStateValidationIssue(params.widgetId, params.key, candidate, input))
			// `finalize()` already returns a deep-frozen array; the generic-fallback branch builds a
			// fresh array here and needs the same immutable-snapshot treatment (issue #10 issue-snapshot
			// contract).
			const issues = finalized.length > 0 ? finalized : freezeIssueSnapshot([buildDefaultStateValidationIssue(params.widgetId, params.key, candidate)])
			issuesSignal(issues)
			return { success: false, issues: issues as readonly [RuntimeStateIssue, ...RuntimeStateIssue[]] }
		}

		// Top-level semantic execution values (state values included) must not be `PromiseLike`; a
		// candidate that would otherwise be accepted must not become the live State value if it is
		// thenable (issue #10 amendment "synchronous core boundary and future async seams").
		assertSyncValue(candidate, `State "${params.key}"'s value`)

		valueSignal(candidate)
		issuesSignal(EMPTY_ISSUES)
		return { success: true, value: candidate }
	}

	const internal: StatePrimitiveInternal = {
		get: () => valueSignal(),
		getIssues: () => issuesSignal(),
		attemptSet,
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
		getIssues() {
			context.assertActive()
			return internal.getIssues()
		},
		subscribeIssues(listener) {
			context.assertActive()
			return createTrackedSubscription(context, internal.getIssues, listener)
		},
	}

	return { internal, public: publicState }
}
