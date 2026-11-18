/**
 * The one place the page shows a refused Method call.
 *
 * Several renderers call Methods (the root's moves, the induction's request and cancel), and each refusal is that
 * Method's own diagnostic. The page shows a refusal as one alert, so that a screen reader is told once and never has
 * two `role="alert"` regions at the same time: the root renderer owns the board and renders its latest problem, and a
 * renderer below it reports after each call. A successful call clears the problem it replaced (a successful move
 * clears whatever was shown, because the visitor has moved on).
 *
 * The board only mirrors diagnostics Core produced; it never invents or reclassifies one.
 */

import type { InjectionKey, Ref } from 'vue'
import { inject, shallowRef } from 'vue'

export interface Problem {
	/** The Method that was refused, such as `goTo`. */
	readonly method: string
	readonly code: string
	readonly reason: string | undefined
	/** The diagnostic's own (English) message. */
	readonly message: string
}

export interface ProblemBoard {
	readonly latest: Readonly<Ref<Problem | null>>
	/** `problem` is the Method's latest diagnostic after a call (`null` when the call succeeded). */
	report: (method: string, problem: Omit<Problem, 'method'> | null, options?: { readonly clearAll?: boolean }) => void
	clear: () => void
}

export const ProblemBoardKey: InjectionKey<ProblemBoard> = Symbol('widget-lab:onboarding-problems')

export function createProblemBoard(): ProblemBoard {
	const latest = shallowRef<Problem | null>(null)
	return {
		latest,
		report: (method, problem, options = {}) => {
			if (problem !== null)
				latest.value = { method, ...problem }
			else if (options.clearAll === true || latest.value?.method === method)
				latest.value = null
		},
		clear: () => {
			latest.value = null
		},
	}
}

/**
 * Mirrors a Method's latest diagnostic onto the board right after a call (Core updates the snapshot before the call
 * returns). A call that succeeded clears the problem it replaced; `clearAll` clears whatever was shown (a successful move).
 */
export function reportCall(board: ProblemBoard, method: string, diagnostics: readonly { readonly code: string, readonly message: string }[], succeeded: boolean, options?: { readonly clearAll?: boolean }): void {
	const first = diagnostics[0]
	if (succeeded || first === undefined) {
		board.report(method, null, options)
		return
	}
	const reason = (first as { readonly reason?: unknown }).reason
	board.report(method, { code: first.code, reason: typeof reason === 'string' ? reason : undefined, message: first.message })
}

/** The board of the page the renderer is on; a renderer outside one (an isolated test) gets a board of its own. */
export function useProblemBoard(): ProblemBoard {
	return inject(ProblemBoardKey, null) ?? createProblemBoard()
}
