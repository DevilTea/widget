/**
 * Operation-local issue collector.
 *
 * Every state write, property evaluation and method invocation owns one of these for the duration of
 * its synchronous callback(s). Plugin callbacks only ever see the `IssueCollector<RelativeInput>`
 * surface (`addIssue`/`hasAnyIssue`); framework-internal code (dependency-leaf wrapping) additionally
 * inserts already-finalized issues through `addFinalizedIssue`, and reads the merged, call-ordered
 * result through `finalize()` once the callback has returned and the operation's final payload
 * (candidate / args / result) is known.
 *
 * `addFinalizedIssue` accepts an optional `dedupeKey`: repeated reads of the same failing dependency
 * within one execution scope resolve to the same key, so only the first insertion is kept while each
 * call's own returned `ExecutionResult` failure is unaffected.
 *
 * Normative source: issue #10 consolidated handoff §12/§15/§16 ("local execution collectors",
 * "finalize pending ... diagnostics", "automatically insert wrapped consumer Issues into the active
 * operation-local collector", "repeated reads of the same failing dependency ... avoid duplicating the
 * same dependency issue insertion").
 */

import type { IssueCollector } from '../issue'

type CollectorEntry<RelativeInput, FinalIssue>
	= | { readonly kind: 'relative', readonly input: RelativeInput }
		| { readonly kind: 'final', readonly issue: FinalIssue }

export interface OperationCollector<RelativeInput, FinalIssue> extends IssueCollector<RelativeInput> {
	/**
	 * Inserts an already-finalized issue (a wrapped dependency-target failure or refinement
	 * rejection) while preserving relative-call order. When `dedupeKey` is given and was already seen
	 * by this collector instance, the insertion is skipped (the caller's own returned failure is
	 * unaffected either way).
	 */
	addFinalizedIssue: (issue: FinalIssue, dedupeKey?: string) => void
	/**
	 * Resolves every pending relative entry into its final issue via `toFinalIssue`, in original call
	 * order, and returns the merged final list, frozen. Framework-internal only; never exposed to
	 * plugin callbacks.
	 */
	finalize: (toFinalIssue: (input: RelativeInput) => FinalIssue) => readonly FinalIssue[]
}

export function createOperationCollector<RelativeInput, FinalIssue>(): OperationCollector<RelativeInput, FinalIssue> {
	const entries: CollectorEntry<RelativeInput, FinalIssue>[] = []
	const seenDedupeKeys = new Set<string>()

	return {
		addIssue(input: RelativeInput) {
			entries.push({ kind: 'relative', input })
		},
		addFinalizedIssue(issue: FinalIssue, dedupeKey?: string) {
			if (dedupeKey !== undefined) {
				if (seenDedupeKeys.has(dedupeKey))
					return
				seenDedupeKeys.add(dedupeKey)
			}
			entries.push({ kind: 'final', issue })
		},
		hasAnyIssue() {
			return entries.length > 0
		},
		finalize(toFinalIssue: (input: RelativeInput) => FinalIssue) {
			// A completed non-empty issue snapshot is an immutable final artifact (issue #10 issue-
			// snapshot contract): it is stored as the primitive's latest `getIssues()` state *and*
			// returned as `ExecutionResult.failure.issues` for the very same call, so an external
			// mutation of one must not silently corrupt the other. Each individual issue object is
			// frozen too (cheap, and closes the same hazard one level down); `Object.freeze` on a
			// non-object value is a documented no-op, so this stays safe even if `FinalIssue` were ever
			// a primitive.
			const finalized = entries.map((entry) => {
				const issue = entry.kind === 'relative' ? toFinalIssue(entry.input) : entry.issue
				return Object.freeze(issue)
			})
			return Object.freeze(finalized)
		},
	}
}
