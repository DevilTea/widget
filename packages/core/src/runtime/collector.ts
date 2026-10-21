/**
 * Operation-local diagnostic collector.
 *
 * Every state write, property evaluation and method invocation owns one of these for the duration of
 * its synchronous callback(s). Plugin callbacks only ever see the `DiagnosticCollector<RelativeInput>`
 * surface (`addDiagnostic`/`hasAnyDiagnostic`); framework-internal code (dependency-leaf wrapping) additionally
 * inserts already-finalized diagnostics through `addFinalizedDiagnostic`, and reads the merged, call-ordered
 * result through `finalize()` once the callback has returned and the operation's final payload
 * (candidate / args / result) is known.
 *
 * `addFinalizedDiagnostic` accepts an optional {@link DedupeDescriptor}: repeated reads of the same failing
 * dependency within one execution scope resolve to the same `scope` + `anchor` pair, so only the first
 * insertion is kept while each call's own returned `ExecutionResult` failure is unaffected. `anchor` is
 * compared by `Set` membership (SameValueZero) rather than stringified, so it stays collision-free for
 * every JS value — including two distinct `Symbol` instances that happen to share a description, which
 * a naive `` `${typeof value}:${String(value)}` `` encoding would incorrectly conflate.
 *
 * Normative source: diagnostic #10 consolidated handoff §12/§15/§16 ("local execution collectors",
 * "finalize pending ... diagnostics", "automatically insert wrapped consumer Diagnostics into the active
 * operation-local collector", "repeated reads of the same failing dependency ... avoid duplicating the
 * same dependency diagnostic insertion").
 */

import type { DiagnosticCollector } from '../diagnostic'
import { EMPTY_DIAGNOSTICS } from '../diagnostic'
import { freezeDiagnosticSnapshot } from './diagnostics'
import { throwClosedCollector } from './sync'

type CollectorEntry<RelativeInput, FinalDiagnostic>
	= | { readonly kind: 'relative', readonly input: RelativeInput }
		| { readonly kind: 'final', readonly diagnostic: FinalDiagnostic }

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

export interface OperationCollector<RelativeInput, FinalDiagnostic> extends DiagnosticCollector<RelativeInput> {
	/**
	 * Inserts an already-finalized diagnostic (a wrapped dependency-target failure or refinement
	 * rejection) while preserving relative-call order. When `dedupe` is given and its `(scope, anchor)`
	 * pair was already seen by this collector instance, the insertion is skipped (the caller's own
	 * returned failure is unaffected either way).
	 */
	addFinalizedDiagnostic: (diagnostic: FinalDiagnostic, dedupe?: DedupeDescriptor) => void
	/**
	 * Resolves every pending relative entry into its final diagnostic via `toFinalDiagnostic`, in original call
	 * order, and returns the merged final list, frozen. Framework-internal only; never exposed to
	 * plugin callbacks.
	 */
	finalize: (toFinalDiagnostic: (input: RelativeInput) => FinalDiagnostic) => readonly FinalDiagnostic[]
	/**
	 * Ends the plugin-facing lifetime: a later `addDiagnostic` / `hasAnyDiagnostic` call throws. Called
	 * once the operation no longer reads the collector, whether its callback returned or threw.
	 */
	close: () => void
}

export function createOperationCollector<RelativeInput, FinalDiagnostic>(): OperationCollector<RelativeInput, FinalDiagnostic> {
	// Allocated on first use: most operations complete without any diagnostic.
	let entries: CollectorEntry<RelativeInput, FinalDiagnostic>[] | null = null
	// Operation-local (this collector's lifetime only, discarded with it): never a module-global table,
	// so distinct `Symbol`s/objects passed through here never accumulate beyond one operation.
	let seenAnchorsByScope: Map<string, Set<unknown>> | null = null
	let closed = false

	return {
		addDiagnostic(input: RelativeInput) {
			if (closed)
				throwClosedCollector('addDiagnostic')
			;(entries ??= []).push({ kind: 'relative', input })
		},
		addFinalizedDiagnostic(diagnostic: FinalDiagnostic, dedupe?: DedupeDescriptor) {
			if (dedupe !== undefined) {
				seenAnchorsByScope ??= new Map()
				let seenAnchors = seenAnchorsByScope.get(dedupe.scope)
				if (seenAnchors === undefined) {
					seenAnchors = new Set()
					seenAnchorsByScope.set(dedupe.scope, seenAnchors)
				}
				if (seenAnchors.has(dedupe.anchor))
					return
				seenAnchors.add(dedupe.anchor)
			}
			;(entries ??= []).push({ kind: 'final', diagnostic })
		},
		hasAnyDiagnostic() {
			if (closed)
				throwClosedCollector('hasAnyDiagnostic')
			return entries !== null
		},
		finalize(toFinalDiagnostic: (input: RelativeInput) => FinalDiagnostic) {
			// A completed non-empty diagnostic snapshot is an immutable final artifact (diagnostic #10 diagnostic-
			// snapshot contract): it is stored as the primitive's latest `getDiagnostics()` state *and*
			// returned as `ExecutionResult.failure.diagnostics` for the very same call, so an external
			// mutation of one must not silently corrupt the other. `freezeDiagnosticSnapshot` deep-freezes
			// each diagnostic's framework-owned structure (not just the top-level diagnostic object) plus the
			// array itself.
			if (entries === null)
				return EMPTY_DIAGNOSTICS
			const finalized = entries.map(entry => entry.kind === 'relative' ? toFinalDiagnostic(entry.input) : entry.diagnostic)
			return freezeDiagnosticSnapshot(finalized)
		},
		close() {
			closed = true
		},
	}
}
