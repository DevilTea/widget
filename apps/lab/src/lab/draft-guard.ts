/**
 * Unapplied-draft guard: an action that would replace the editor's draft (loading a preset, switching
 * showcase) runs at once when there is no unapplied draft, and otherwise waits for an explicit
 * confirm/cancel. It generalises the tutorial's deterministic-start dirty-draft confirmation
 * (`tutorial/deterministic-start.ts`), which stays separate because it also gates the tour's own state machine.
 *
 * One request at a time: while one waits, further requests are ignored (the confirmation dialog is modal,
 * so a second one can only come from a double activation).
 */

export type DraftGuardRequestResult = 'ran' | 'confirming' | 'ignored'

export interface DraftGuardPending {
	/** Text for the confirmation, e.g. the name of what is about to be loaded. */
	readonly subject: string
	readonly run: () => void
}

export interface DraftGuard {
	/** `ran` = no unapplied draft, executed immediately; `confirming` = waiting for the user; `ignored` = one already waits. */
	request: (options: { readonly isDirty: boolean, readonly subject: string, readonly run: () => void }) => DraftGuardRequestResult
	/** Runs the waiting action. `false` when nothing waits. */
	confirm: () => boolean
	/** Drops the waiting action; the draft is untouched. */
	cancel: () => void
	getPending: () => DraftGuardPending | null
}

export function createDraftGuard(onChange: () => void = () => {}): DraftGuard {
	let pending: DraftGuardPending | null = null
	return {
		request: ({ isDirty, subject, run }) => {
			if (pending !== null)
				return 'ignored'
			if (!isDirty) {
				run()
				return 'ran'
			}
			pending = { subject, run }
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
