/**
 * Replacement guard: an action that would replace what the user is working on (loading a preset, switching showcase)
 * runs at once when nothing would be lost, and otherwise waits for an explicit confirm/cancel. It generalises the
 * tutorial's deterministic-start confirmation (`tutorial/deterministic-start.ts`), which stays separate because it also
 * gates the tour's own state machine.
 *
 * Two things can be lost (Lab UX phase 2, report item 10):
 * - an **unapplied JSON draft** (`LabSession.isDirty`): nothing can bring it back, whatever the action;
 * - **committed edits**: the Document's applied source equals no preset of the open showcase (`hasCommittedEdits()`).
 *   Loading a preset keeps them on the Undo stack (it is an ordinary commit), so the action runs without asking and the
 *   Lab offers Undo afterwards; a showcase switch starts a fresh session with an empty Undo stack, so it asks first.
 *
 * `replacementLoss()` is that rule; one dialog names everything an action would lose, so a draft and committed edits
 * never ask twice. One request at a time: while one waits, further requests are ignored (the confirmation dialog is
 * modal, so a second one can only come from a double activation).
 */

/** What confirming would discard: nothing, the unapplied draft, committed edits that Undo cannot restore, or both. */
export type ReplacementLoss = 'none' | 'draft' | 'edits' | 'draft-and-edits'

export interface ReplacementLossInput {
	/** An unapplied JSON draft exists (`LabSession.isDirty`). */
	readonly isDirty: boolean
	/** The committed Document differs from every preset of the open showcase (`hasCommittedEdits()`). */
	readonly hasCommittedEdits: boolean
	/**
	 * The replacement is an ordinary Document commit that Undo can take back (loading a preset), rather than a new session
	 * with an empty Undo stack (switching showcase).
	 */
	readonly undoable: boolean
}

/** What an action would lose for good, i.e. what the user must confirm. Committed edits are lost only when the action cannot be undone. */
export function replacementLoss({ isDirty, hasCommittedEdits, undoable }: ReplacementLossInput): ReplacementLoss {
	const edits = hasCommittedEdits && !undoable
	if (isDirty)
		return edits ? 'draft-and-edits' : 'draft'
	return edits ? 'edits' : 'none'
}

/**
 * "The current document differs from what was loaded": its applied source text equals no preset of the open showcase,
 * compared as exact text (the same rule the Examples menu uses to say "edited", `example.ts`, without the draft). A
 * document that equals a preset, including one reached with Undo, has nothing a preset load could not bring back.
 * Revision numbers are not used: they only grow, so an edit undone back to the preset would still count.
 */
export function hasCommittedEdits(appliedSourceText: string, presets: readonly { readonly sourceText: string }[]): boolean {
	return !presets.some(preset => preset.sourceText === appliedSourceText)
}

export type DraftGuardRequestResult = 'ran' | 'confirming' | 'ignored'

export interface DraftGuardPending {
	/** Text for the confirmation, e.g. the name of what is about to be loaded. */
	readonly subject: string
	/** What confirming discards (never `none`: nothing to lose runs at once). */
	readonly loss: Exclude<ReplacementLoss, 'none'>
	readonly run: () => void
}

export interface DraftGuard {
	/** `ran` = nothing would be lost, executed immediately; `confirming` = waiting for the user; `ignored` = one already waits. */
	request: (options: { readonly loss: ReplacementLoss, readonly subject: string, readonly run: () => void }) => DraftGuardRequestResult
	/** Runs the waiting action. `false` when nothing waits. */
	confirm: () => boolean
	/** Drops the waiting action; the draft and the Document are untouched. */
	cancel: () => void
	getPending: () => DraftGuardPending | null
}

export function createDraftGuard(onChange: () => void = () => {}): DraftGuard {
	let pending: DraftGuardPending | null = null
	return {
		request: ({ loss, subject, run }) => {
			if (pending !== null)
				return 'ignored'
			if (loss === 'none') {
				run()
				return 'ran'
			}
			pending = { subject, loss, run }
			onChange()
			return 'confirming'
		},
		confirm: () => {
			const waiting = pending
			if (waiting === null)
				return false
			pending = null
			onChange()
			waiting.run()
			return true
		},
		cancel: () => {
			if (pending === null)
				return
			pending = null
			onChange()
		},
		getPending: () => pending,
	}
}
