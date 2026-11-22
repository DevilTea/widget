/**
 * Deterministic-start decision logic (diagnostic #25 OWNER decision, "deterministic tutorial start
 * accepted"): starting or restarting a tour always reloads its known default preset through the normal
 * preset -> Apply pipeline. The only product decision left to the visitor is whether that reload is allowed
 * to replace something that cannot be brought back — this module is exactly that one decision, kept pure and
 * separate from the actual `LabStore.applyPreset()`/`switchShowcase()` calls (`use-tutorial.ts` owns those) so
 * the "when do we need to ask" rule is independently testable.
 *
 * It follows the replacement rule of `lab/draft-guard.ts` (Lab UX phase 2, report item 10):
 * - an unapplied draft always asks (nothing brings it back);
 * - committed edits ask only when the start switches showcase (a new session has an empty Undo stack). On the tour's own
 *   showcase the reload is an ordinary preset commit: it does not ask, and `LabStore.applyPreset()` offers Undo afterwards.
 *
 * Locked copy for the draft case (verbatim, owned by the caller that renders the confirmation, not this module):
 * "Starting the tutorial will load the Survey teaching example and replace your unapplied changes."
 * Actions: "Start tour" / "Cancel".
 */

import { replacementLoss } from '../lab/draft-guard'

export interface DeterministicStartInput {
	/**
	 * `LabStore.isDirty.value` at the moment start/restart was requested — whether the CURRENT
	 * showcase's draft Source text differs from its last applied snapshot.
	 */
	readonly isDirty: boolean
	/** `LabStore.hasCommittedEdits.value`: the committed Document equals no preset of the open showcase. */
	readonly hasCommittedEdits: boolean
	/** The tour belongs to another showcase than the open one, so starting it switches showcase (not undoable). */
	readonly switchesShowcase: boolean
}

export interface DeterministicStartDecision {
	/** `true` when the visitor must confirm before the teaching preset replaces their work. */
	readonly needsConfirmation: boolean
	/** `true` when confirming also discards committed edits that Undo cannot restore (the message must say so). */
	readonly discardsEdits: boolean
}

export function decideDeterministicStart(input: DeterministicStartInput): DeterministicStartDecision {
	const loss = replacementLoss({ isDirty: input.isDirty, hasCommittedEdits: input.hasCommittedEdits, undoable: !input.switchesShowcase })
	return { needsConfirmation: loss !== 'none', discardsEdits: loss === 'edits' || loss === 'draft-and-edits' }
}
