/**
 * Deterministic-start decision logic (diagnostic #25 OWNER decision, "deterministic tutorial start
 * accepted"): starting or restarting the Survey tour always reloads the known `survey-default` preset
 * through the normal preset -> Apply pipeline. The only product decision left to the visitor is whether
 * that reload is allowed to silently replace an unapplied Source draft — this module is exactly that
 * one decision, kept pure and separate from the actual `LabStore.applyPreset()`/`switchShowcase()` calls
 * (`use-tutorial.ts` owns those) so the "when do we need to ask" rule is independently testable.
 *
 * Locked copy (verbatim, owned by the caller that renders the confirmation, not this module):
 * "Starting the tutorial will load the Survey teaching example and replace your unapplied changes."
 * Actions: "Start tour" / "Cancel".
 */

export interface DeterministicStartInput {
	/**
	 * `LabStore.isDirty.value` at the moment start/restart was requested — whether the CURRENT
	 * showcase's draft Source text differs from its last applied snapshot. Switching away from a
	 * different, non-dirty showcase is not itself a reason to confirm (the existing showcase selector
	 * already does that unprompted) — only an unapplied draft edit is.
	 */
	readonly isDirty: boolean
}

export interface DeterministicStartDecision {
	/** `true` when the visitor must confirm before the Survey teaching preset replaces their draft. */
	readonly needsConfirmation: boolean
}

export function decideDeterministicStart(input: DeterministicStartInput): DeterministicStartDecision {
	return { needsConfirmation: input.isDirty }
}
