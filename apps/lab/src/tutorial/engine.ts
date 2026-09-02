/**
 * `createTutorialEngine()` — the framework-agnostic tutorial step machine (diagnostic #25 P1).
 *
 * See `types.ts` for the full contract and the do -> observe -> name pedagogical invariant this engine
 * exists to enforce: `recheck()` only ever reveals stage text and flips `canAdvance` within the *current*
 * step; only an explicit `next()`/`back()`/`restart()`/`start()`/`resume()` call ever changes which step
 * (and therefore which spotlight target) is current.
 */

import type {
	TutorialActions,
	TutorialEngine,
	TutorialEngineSnapshot,
	TutorialRuntimeReader,
	TutorialScript,
	TutorialStatus,
	TutorialStepDefinition,
} from './types'

interface EngineState {
	status: TutorialStatus
	stepIndex: number
	/**
	 * How many of the current step's stages have completed, per step index — persists across `back()`/
	 * `next()` navigation within one run (see the "monotonic completion" note on `recheck()` below);
	 * reset to all-zero only by `start()`/`restart()`.
	 */
	progress: number[]
}

function freshState(stepCount: number): EngineState {
	const progress = Array.from<number>({ length: stepCount })
		.fill(0)
	return { status: 'idle', stepIndex: 0, progress }
}

export function createTutorialEngine(script: TutorialScript): TutorialEngine {
	let state = freshState(script.steps.length)
	const listeners = new Set<() => void>()

	function emit(): void {
		for (const listener of listeners) listener()
	}

	function currentStep(): TutorialStepDefinition | null {
		if (state.status === 'idle' || state.status === 'completed')
			return null
		return script.steps[state.stepIndex] ?? null
	}

	function snapshot(): TutorialEngineSnapshot {
		const step = currentStep()
		const progress = step === null ? 0 : (state.progress[state.stepIndex] ?? 0)
		return Object.freeze({
			status: state.status,
			stepIndex: state.stepIndex,
			stepCount: script.steps.length,
			step,
			revealed: step === null
				? []
				: step.stages.slice(0, progress)
						.map(stage => stage.reveal),
			pendingPrompt: step !== null && progress < step.stages.length ? step.stages[progress]!.prompt : null,
			canAdvance: step !== null && progress >= step.stages.length,
			isFirstStep: state.stepIndex === 0,
			isLastStep: state.stepIndex === script.steps.length - 1,
		})
	}

	function enterStep(index: number, actions: TutorialActions): void {
		state = { ...state, status: 'active', stepIndex: index }
		script.steps[index]?.onEnter?.(actions)
		emit()
	}

	function beginFresh(actions: TutorialActions): void {
		state = freshState(script.steps.length)
		state.status = 'active'
		script.steps[0]?.onEnter?.(actions)
		emit()
	}

	return {
		getSnapshot: snapshot,

		subscribe: (listener) => {
			listeners.add(listener)
			return () => {
				listeners.delete(listener)
			}
		},

		start: actions => beginFresh(actions),
		restart: actions => beginFresh(actions),

		next: (actions) => {
			if (state.status !== 'active')
				return
			const step = currentStep()
			if (step === null)
				return
			const progress = state.progress[state.stepIndex] ?? 0
			if (progress < step.stages.length)
				return // Not every stage has revealed yet — Next stays disabled, per the do -> observe -> name invariant.

			if (state.stepIndex >= script.steps.length - 1) {
				state = { ...state, status: 'completed' }
				emit()
				return
			}
			enterStep(state.stepIndex + 1, actions)
		},

		back: (actions) => {
			if (state.status !== 'active' || state.stepIndex === 0)
				return
			enterStep(state.stepIndex - 1, actions)
		},

		skip: () => {
			state = { ...state, status: 'idle' }
			emit()
		},

		pause: () => {
			if (state.status !== 'active')
				return
			state = { ...state, status: 'paused' }
			emit()
		},

		resume: (actions) => {
			if (state.status !== 'paused')
				return
			state = { ...state, status: 'active' }
			script.steps[state.stepIndex]?.onEnter?.(actions)
			emit()
		},

		/**
		 * Walks the current step's stages forward from its already-completed count, stopping at the first
		 * stage whose `isComplete` (or the absence of one) is not yet satisfied. Monotonic by construction:
		 * a stage already counted as complete is never re-checked, so a later Runtime change that would
		 * make an earlier predicate false again (e.g. re-breaking a fixed date) cannot un-reveal text that
		 * already reveal­ed — the pedagogical invariant only promises a predicate-true moment gets
		 * revealed once, never that it stays continuously true.
		 */
		recheck: (reader: TutorialRuntimeReader) => {
			const step = currentStep()
			if (step === null)
				return
			let progress = state.progress[state.stepIndex] ?? 0
			while (progress < step.stages.length) {
				const stage = step.stages[progress]!
				const complete = stage.isComplete === undefined ? true : stage.isComplete(reader)
				if (!complete)
					break
				progress++
			}
			if (progress !== (state.progress[state.stepIndex] ?? 0)) {
				const nextProgress = state.progress.slice()
				nextProgress[state.stepIndex] = progress
				state = { ...state, progress: nextProgress }
				emit()
			}
		},

		runLink: (linkId, actions) => {
			const step = currentStep()
			const link = step?.links?.find(candidate => candidate.id === linkId)
			if (link === undefined || link.disabled === true)
				return
			link.run?.(actions)
		},

		restoreCompleted: () => {
			state = { ...freshState(script.steps.length), status: 'completed' }
			emit()
		},
	}
}
