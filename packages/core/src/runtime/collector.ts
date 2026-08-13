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
 * Normative source: issue #10 consolidated handoff §12/§15/§16 ("local execution collectors",
 * "finalize pending ... diagnostics", "automatically insert wrapped consumer Issues into the active
 * operation-local collector").
 */

import type { IssueCollector } from '../issue'

type CollectorEntry<RelativeInput, FinalIssue>
	= | { readonly kind: 'relative', readonly input: RelativeInput }
		| { readonly kind: 'final', readonly issue: FinalIssue }

export interface OperationCollector<RelativeInput, FinalIssue> extends IssueCollector<RelativeInput> {
	/**
	 * Inserts an already-finalized issue (a wrapped dependency-target failure or refinement
	 * rejection) while preserving relative-call order.
	 */
	addFinalizedIssue: (issue: FinalIssue) => void
	/**
	 * Resolves every pending relative entry into its final issue via `toFinalIssue`, in original call
	 * order, and returns the merged final list. Framework-internal only; never exposed to plugin
	 * callbacks.
	 */
	finalize: (toFinalIssue: (input: RelativeInput) => FinalIssue) => readonly FinalIssue[]
}

export function createOperationCollector<RelativeInput, FinalIssue>(): OperationCollector<RelativeInput, FinalIssue> {
	const entries: CollectorEntry<RelativeInput, FinalIssue>[] = []

	return {
		addIssue(input: RelativeInput) {
			entries.push({ kind: 'relative', input })
		},
		addFinalizedIssue(issue: FinalIssue) {
			entries.push({ kind: 'final', issue })
		},
		hasAnyIssue() {
			return entries.length > 0
		},
		finalize(toFinalIssue: (input: RelativeInput) => FinalIssue) {
			return entries.map(entry => entry.kind === 'relative' ? toFinalIssue(entry.input) : entry.issue)
		},
	}
}
