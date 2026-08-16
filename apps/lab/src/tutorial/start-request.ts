/**
 * Deterministic-start re-entry guard (issue #25 P1 merge-gate review, blocker 3).
 *
 * `use-tutorial.ts`'s `requestStartOrRestart()` calls an async `loadSurveyDefault()` (a
 * `switchShowcase()`/`applyPreset()` Apply-pipeline round trip) before `TutorialEngine.start()`/
 * `restart()` ever runs — and the tutorial's own `status` stays `'idle'`/`'completed'` for that whole
 * window, since the engine only transitions once `start()`/`restart()` actually executes. Left
 * unguarded, a second header click (or Welcome's "Start the tour" firing twice) during that window
 * would run a second `loadSurveyDefault()` and, worse, a *later* `engine.start()`/`restart()` call could
 * land after the visitor has already begun interacting with the first one, silently resetting it.
 *
 * This is a small, framework-agnostic, independently-testable phase tracker for exactly that window —
 * kept separate from `use-tutorial.ts` the same way `deterministic-start.ts`'s pure decision is, so the
 * "second request during pending is a no-op" contract is unit-testable without Vue/timing at all.
 *
 * Phases: `'idle'` (no request in flight) -> `'confirming'` (dirty-draft confirmation is open, awaiting
 * the visitor) -> `'loading'` (the deterministic reload + `engine.start()`/`restart()` is in flight) ->
 * back to `'idle'` once settled. A non-dirty request skips `'confirming'` and goes straight to
 * `'loading'`.
 */

export type StartRequestPhase = 'idle' | 'confirming' | 'loading'

export interface StartRequestGuard {
	getPhase: () => StartRequestPhase
	/**
	 * Called the instant a start/restart is requested (header button, Welcome's "Start the tour", a
	 * later restart). Returns `false` — a no-op, coalesced into whichever request is already in
	 * flight — when `getPhase() !== 'idle'`; returns `true` and transitions to `'confirming'` (when
	 * `needsConfirmation`) or directly to `'loading'` otherwise.
	 */
	request: (needsConfirmation: boolean) => boolean
	/**
	 * The confirmation dialog's "Start tour". `'confirming'` -> `'loading'`; a no-op (returns `false`)
	 * from any other phase.
	 */
	confirm: () => boolean
	/**
	 * The confirmation dialog's "Cancel", or Escape on it. `'confirming'` -> `'idle'`; a no-op from any
	 * other phase — in particular, never interrupts an already-`'loading'` request.
	 */
	cancel: () => void
	/**
	 * The in-flight deterministic load + `engine.start()`/`restart()` has fully settled. `'loading'` ->
	 * `'idle'`, from any phase (defensive: always safe to call).
	 */
	settle: () => void
}

export function createStartRequestGuard(): StartRequestGuard {
	let phase: StartRequestPhase = 'idle'

	return {
		getPhase: () => phase,
		request: (needsConfirmation) => {
			if (phase !== 'idle')
				return false
			phase = needsConfirmation ? 'confirming' : 'loading'
			return true
		},
		confirm: () => {
			if (phase !== 'confirming')
				return false
			phase = 'loading'
			return true
		},
		cancel: () => {
			if (phase === 'confirming')
				phase = 'idle'
		},
		settle: () => {
			phase = 'idle'
		},
	}
}
