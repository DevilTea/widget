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
 * `addFinalizedIssue` accepts an optional {@link DedupeDescriptor}: repeated reads of the same failing
 * dependency within one execution scope resolve to the same `scope` + `anchor` pair, so only the first
 * insertion is kept while each call's own returned `ExecutionResult` failure is unaffected. `anchor` is
 * compared by `Set` membership (SameValueZero) rather than stringified, so it stays collision-free for
 * every JS value — including two distinct `Symbol` instances that happen to share a description, which
 * a naive `` `${typeof value}:${String(value)}` `` encoding would incorrectly conflate.
 *
 * Normative source: issue #10 consolidated handoff §12/§15/§16 ("local execution collectors",
 * "finalize pending ... diagnostics", "automatically insert wrapped consumer Issues into the active
 * operation-local collector", "repeated reads of the same failing dependency ... avoid duplicating the
 * same dependency issue insertion").
 */

import type { IssueCollector } from '../issue'
import { freezeIssueSnapshot } from './issues'

type CollectorEntry<RelativeInput, FinalIssue>
	= | { readonly kind: 'relative', readonly input: RelativeInput }
		| { readonly kind: 'final', readonly issue: FinalIssue }

/**
 * Identifies "the same failing dependency" for dedupe purposes. `scope` groups entries that could ever
 * collide (in practice: one dependency leaf's identity plus the failure message); `anchor` is the raw
 * failure-identity value — never stringified — compared via `Set`'s SameValueZero semantics: correct
 * reference identity for objects/functions, correct distinct-instance identity for `Symbol`s that share
 * a description, value equality for other primitives, and `NaN` counted as equal to itself (matching
 * "the same failing dependency" intent — a candidate that is consistently `NaN` is one steady failure,
 * not a new one on every read).
 */
export interface DedupeDescriptor {
	readonly scope: string
	readonly anchor: unknown
}

export interface OperationCollector<RelativeInput, FinalIssue> extends IssueCollector<RelativeInput> {
	/**
	 * Inserts an already-finalized issue (a wrapped dependency-target failure or refinement
	 * rejection) while preserving relative-call order. When `dedupe` is given and its `(scope, anchor)`
	 * pair was already seen by this collector instance, the insertion is skipped (the caller's own
	 * returned failure is unaffected either way).
	 */
	addFinalizedIssue: (issue: FinalIssue, dedupe?: DedupeDescriptor) => void
	/**
	 * Resolves every pending relative entry into its final issue via `toFinalIssue`, in original call
	 * order, and returns the merged final list, frozen. Framework-internal only; never exposed to
	 * plugin callbacks.
	 */
	finalize: (toFinalIssue: (input: RelativeInput) => FinalIssue) => readonly FinalIssue[]
}

export function createOperationCollector<RelativeInput, FinalIssue>(): OperationCollector<RelativeInput, FinalIssue> {
	const entries: CollectorEntry<RelativeInput, FinalIssue>[] = []
	// Operation-local (this collector's lifetime only, discarded with it): never a module-global table,
	// so distinct `Symbol`s/objects passed through here never accumulate beyond one operation.
	const seenAnchorsByScope = new Map<string, Set<unknown>>()

	return {
		addIssue(input: RelativeInput) {
			entries.push({ kind: 'relative', input })
		},
		addFinalizedIssue(issue: FinalIssue, dedupe?: DedupeDescriptor) {
			if (dedupe !== undefined) {
				let seenAnchors = seenAnchorsByScope.get(dedupe.scope)
				if (seenAnchors === undefined) {
					seenAnchors = new Set()
					seenAnchorsByScope.set(dedupe.scope, seenAnchors)
				}
				if (seenAnchors.has(dedupe.anchor))
					return
				seenAnchors.add(dedupe.anchor)
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
			// mutation of one must not silently corrupt the other. `freezeIssueSnapshot` deep-freezes
			// each issue's framework-owned structure (not just the top-level issue object) plus the
			// array itself.
			const finalized = entries.map(entry => entry.kind === 'relative' ? toFinalIssue(entry.input) : entry.issue)
			return freezeIssueSnapshot(finalized)
		},
	}
}
