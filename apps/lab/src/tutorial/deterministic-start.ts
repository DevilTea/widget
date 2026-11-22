/**
 * Deterministic-start decision logic (diagnostic #25 OWNER decision, "deterministic tutorial start
 * accepted"): starting or restarting a tour always reloads its known default preset through the normal
 * preset -> JSON commit pipeline. The only product decision left to the visitor is whether that reload is allowed
 * to replace something that cannot be brought back — this module is exactly that one decision, kept pure and
 * separate from the actual `LabStore.applyPreset()`/`switchShowcase()` calls (`use-tutorial.ts` owns those) so
 * the "when do we need to ask" rule is independently testable.
 *
 * It follows the replacement rule of `lab/draft-guard.ts` (Lab UX phase 2, report item 10):
 * - JSON text that does not parse always asks (it was never committed, so nothing brings it back; text that parses is
 *   committed before the start, Lab UX phase 3);
 * - committed edits ask only when the start switches showcase (a new session has an empty Undo stack). On the tour's own
 *   showcase the reload is an ordinary preset commit: it does not ask, and `LabStore.applyPreset()` offers Undo afterwards.
 *
 * Locked copy for the draft case (verbatim, owned by the caller that renders the confirmation, not this module):
 * "Starting the tutorial will load the Survey teaching example and discard the JSON that can't be applied yet."
 * Actions: "Start tour" / "Cancel".
 */

import type { ReplacementLoss } from '../lab/draft-guard'
import { replacementLoss } from '../lab/draft-guard'

export interface DeterministicStartInput {
	/** `LabStore.jsonBlocked.value` at the moment start/restart was requested: the JSON view's text does not parse. */
	readonly jsonBlocked: boolean
	/** `LabStore.hasCommittedEdits.value`: the committed Document equals no preset of the open showcase. */
	readonly hasCommittedEdits: boolean
	/** The tour belongs to another showcase than the open one, so starting it switches showcase (not undoable). */
	readonly switchesShowcase: boolean
}

export interface DeterministicStartDecision {
	/** `true` when the visitor must confirm before the teaching preset replaces their work. */
	readonly needsConfirmation: boolean
	/** What confirming discards (`none` when nothing is asked): the message names the draft, committed edits Undo cannot restore, or both. */
	readonly loss: ReplacementLoss
}

export function decideDeterministicStart(input: DeterministicStartInput): DeterministicStartDecision {
	const loss = replacementLoss({ jsonBlocked: input.jsonBlocked, hasCommittedEdits: input.hasCommittedEdits, undoable: !input.switchesShowcase })
	return { needsConfirmation: loss !== 'none', loss }
}
