import type { TutorialActions, TutorialRuntimeReader, TutorialScript } from './types'
import { describe, expect, it } from 'vitest'
import { createTutorialEngine } from './engine'

function noopActions(): TutorialActions {
	return { setFocus: () => {}, activateTab: () => {} }
}

/**
 * A reader whose predicates are driven entirely by test-controlled values, decoupled from any real
 * `@deviltea/widget-core` Runtime — `inspection-reader.unit.test.ts` covers the real passive-reading
 * contract; this suite only needs to prove the step machine's own gating/navigation semantics.
 */
function readerOf(values: Record<string, unknown>): TutorialRuntimeReader {
	return {
		readState: (widgetId, key) => values[`${widgetId}.${key}`],
		readProperty: (widgetId, key) => values[`${widgetId}.${key}`] as never,
	}
}

const threeStepScript: TutorialScript = {
	id: 'test-script',
	observationTargets: [],
	steps: [
		{
			id: 'orient',
			title: 'Orient',
			target: 'preview',
			stages: [{ prompt: 'Orient prompt', reveal: 'Orient reveal' }],
		},
		{
			id: 'gated',
			title: 'Gated',
			target: 'widget-a',
			stages: [{
				prompt: 'Change A',
				isComplete: reader => reader.readState('a', 'value') === true,
				reveal: 'A changed',
			}],
		},
		{
			id: 'hand-back',
			title: 'Hand back',
			target: null,
			finishLabel: 'Finish',
			stages: [{ prompt: 'Done prompt', reveal: 'Done reveal' }],
		},
	],
}

describe('createTutorialEngine', () => {
	it('starts idle with no current step', () => {
		const engine = createTutorialEngine(threeStepScript)
		const snapshot = engine.getSnapshot()
		expect(snapshot.status)
			.toBe('idle')
		expect(snapshot.step)
			.toBeNull()
		expect(snapshot.canAdvance)
			.toBe(false)
	})

	it('start() enters step 0, running its onEnter, with the stage-less step immediately advanceable', () => {
		let entered = false
		const script: TutorialScript = {
			...threeStepScript,
			steps: [{ ...threeStepScript.steps[0]!, onEnter: () => { entered = true } }, ...threeStepScript.steps.slice(1)],
		}
		const engine = createTutorialEngine(script)
		engine.start(noopActions())

		const snapshot = engine.getSnapshot()
		expect(snapshot.status)
			.toBe('active')
		expect(snapshot.stepIndex)
			.toBe(0)
		expect(entered)
			.toBe(true)
	})

	it('a no-predicate stage only reveals once recheck() runs — it never auto-reveals on start()', () => {
		const engine = createTutorialEngine(threeStepScript)
		engine.start(noopActions())

		expect(engine.getSnapshot().revealed)
			.toEqual([])
		expect(engine.getSnapshot().canAdvance)
			.toBe(false)

		engine.recheck(readerOf({}))

		expect(engine.getSnapshot().revealed)
			.toEqual(['Orient reveal'])
		expect(engine.getSnapshot().canAdvance)
			.toBe(true)
	})

	it('an action-gated step reveals its observation only once its predicate turns true, and never auto-advances the step index', () => {
		const engine = createTutorialEngine(threeStepScript)
		engine.start(noopActions())
		engine.recheck(readerOf({})) // completes step 0
		engine.next(noopActions()) // -> step 1 (gated)

		expect(engine.getSnapshot().stepIndex)
			.toBe(1)
		expect(engine.getSnapshot().pendingPrompt)
			.toBe('Change A')
		expect(engine.getSnapshot().canAdvance)
			.toBe(false)

		// Predicate still false: recheck() must not reveal or advance.
		engine.recheck(readerOf({ 'a.value': false }))
		expect(engine.getSnapshot().revealed)
			.toEqual([])
		expect(engine.getSnapshot().stepIndex)
			.toBe(1)

		// Predicate turns true: reveals in the SAME step, enables Next, but the spotlight/step never moves
		// on its own — stepIndex stays 1 until an explicit next() call.
		engine.recheck(readerOf({ 'a.value': true }))
		expect(engine.getSnapshot().revealed)
			.toEqual(['A changed'])
		expect(engine.getSnapshot().canAdvance)
			.toBe(true)
		expect(engine.getSnapshot().stepIndex)
			.toBe(1)
	})

	it('next() is a no-op while canAdvance is false', () => {
		const engine = createTutorialEngine(threeStepScript)
		engine.start(noopActions())
		engine.recheck(readerOf({})) // completes step 0
		engine.next(noopActions()) // -> step 1 (gated, not yet complete)

		engine.next(noopActions())
		expect(engine.getSnapshot().stepIndex)
			.toBe(1)
	})

	it('next() from the last step completes the tour', () => {
		const engine = createTutorialEngine(threeStepScript)
		engine.start(noopActions())
		engine.recheck(readerOf({ 'a.value': true }))
		engine.next(noopActions()) // step 0 -> 1
		engine.recheck(readerOf({ 'a.value': true })) // completes step 1
		engine.next(noopActions()) // step 1 -> 2 (last)
		engine.recheck(readerOf({})) // completes step 2

		expect(engine.getSnapshot().isLastStep)
			.toBe(true)
		expect(engine.getSnapshot().step?.finishLabel)
			.toBe('Finish')

		engine.next(noopActions())
		expect(engine.getSnapshot().status)
			.toBe('completed')
		expect(engine.getSnapshot().step)
			.toBeNull()
	})

	it('back() moves to the previous step and is a no-op on the first step', () => {
		const engine = createTutorialEngine(threeStepScript)
		engine.start(noopActions())
		engine.recheck(readerOf({}))
		engine.next(noopActions())
		expect(engine.getSnapshot().stepIndex)
			.toBe(1)

		engine.back(noopActions())
		expect(engine.getSnapshot().stepIndex)
			.toBe(0)

		engine.back(noopActions())
		expect(engine.getSnapshot().stepIndex)
			.toBe(0)
	})

	it('going back to an already-completed step preserves its progress (monotonic completion)', () => {
		const engine = createTutorialEngine(threeStepScript)
		engine.start(noopActions())
		engine.recheck(readerOf({}))
		expect(engine.getSnapshot().canAdvance)
			.toBe(true)

		engine.next(noopActions()) // -> step 1
		engine.back(noopActions()) // -> step 0 again

		expect(engine.getSnapshot().revealed)
			.toEqual(['Orient reveal'])
		expect(engine.getSnapshot().canAdvance)
			.toBe(true)
	})

	it('skip() dismisses the tour to idle from any step', () => {
		const engine = createTutorialEngine(threeStepScript)
		engine.start(noopActions())
		engine.recheck(readerOf({}))
		engine.next(noopActions())

		engine.skip()
		expect(engine.getSnapshot().status)
			.toBe('idle')
		expect(engine.getSnapshot().step)
			.toBeNull()
	})

	it('pause()/resume() preserve step and progress, and resume() re-runs onEnter', () => {
		let enterCount = 0
		const script: TutorialScript = {
			...threeStepScript,
			steps: [{ ...threeStepScript.steps[0]!, onEnter: () => { enterCount++ } }, ...threeStepScript.steps.slice(1)],
		}
		const engine = createTutorialEngine(script)
		engine.start(noopActions())
		expect(enterCount)
			.toBe(1)
		engine.recheck(readerOf({}))

		engine.pause()
		expect(engine.getSnapshot().status)
			.toBe('paused')
		// Progress survives the pause — revealed text is still derivable from the snapshot even though the
		// rail is closed while paused.
		expect(engine.getSnapshot().revealed)
			.toEqual(['Orient reveal'])

		engine.resume(noopActions())
		expect(engine.getSnapshot().status)
			.toBe('active')
		expect(engine.getSnapshot().stepIndex)
			.toBe(0)
		expect(enterCount)
			.toBe(2)
	})

	it('pause() is a no-op unless active, and resume() is a no-op unless paused', () => {
		const engine = createTutorialEngine(threeStepScript)
		engine.pause() // idle -> still idle
		expect(engine.getSnapshot().status)
			.toBe('idle')

		engine.resume(noopActions()) // idle -> still idle
		expect(engine.getSnapshot().status)
			.toBe('idle')
	})

	it('restart() discards prior progress and begins a fresh run at step 0', () => {
		const engine = createTutorialEngine(threeStepScript)
		engine.start(noopActions())
		engine.recheck(readerOf({}))
		engine.next(noopActions())
		engine.recheck(readerOf({ 'a.value': true }))
		expect(engine.getSnapshot().stepIndex)
			.toBe(1)

		engine.restart(noopActions())
		expect(engine.getSnapshot().status)
			.toBe('active')
		expect(engine.getSnapshot().stepIndex)
			.toBe(0)
		expect(engine.getSnapshot().revealed)
			.toEqual([])
	})

	it('restoreCompleted() bootstraps completed status without traversing any step', () => {
		const engine = createTutorialEngine(threeStepScript)
		engine.restoreCompleted()
		expect(engine.getSnapshot().status)
			.toBe('completed')
		expect(engine.getSnapshot().step)
			.toBeNull()
	})

	it('a multi-stage step (failure + recovery) reveals each stage only as its own predicate turns true, in order', () => {
		const script: TutorialScript = {
			id: 'multi-stage',
			observationTargets: [],
			steps: [{
				id: 'break-fix',
				title: 'Break and fix',
				target: 'widget-b',
				stages: [
					{ prompt: 'Break it', isComplete: reader => reader.readState('b', 'broken') === true, reveal: 'Observed the break' },
					{ prompt: 'Fix it', isComplete: reader => reader.readState('b', 'broken') === false, reveal: 'Observed the recovery' },
				],
			}],
		}
		const engine = createTutorialEngine(script)
		engine.start(noopActions())

		// Neither stage satisfied yet.
		engine.recheck(readerOf({ 'b.broken': false }))
		// stage 0's predicate (`=== true`) is false, so nothing reveals — even though stage 1's predicate
		// (`=== false`) already happens to hold; stages are gated strictly in order.
		expect(engine.getSnapshot().revealed)
			.toEqual([])
		expect(engine.getSnapshot().pendingPrompt)
			.toBe('Break it')

		engine.recheck(readerOf({ 'b.broken': true }))
		expect(engine.getSnapshot().revealed)
			.toEqual(['Observed the break'])
		expect(engine.getSnapshot().pendingPrompt)
			.toBe('Fix it')
		expect(engine.getSnapshot().canAdvance)
			.toBe(false)

		engine.recheck(readerOf({ 'b.broken': false }))
		expect(engine.getSnapshot().revealed)
			.toEqual(['Observed the break', 'Observed the recovery'])
		expect(engine.getSnapshot().pendingPrompt)
			.toBeNull()
		expect(engine.getSnapshot().canAdvance)
			.toBe(true)
	})

	it('subscribe() notifies on every state-changing call and stops after unsubscribing', () => {
		const engine = createTutorialEngine(threeStepScript)
		let calls = 0
		const unsubscribe = engine.subscribe(() => {
			calls++
		})

		engine.start(noopActions())
		expect(calls)
			.toBe(1)
		engine.recheck(readerOf({}))
		expect(calls)
			.toBe(2)
		// A recheck() that changes nothing must not emit.
		engine.recheck(readerOf({}))
		expect(calls)
			.toBe(2)

		unsubscribe()
		engine.next(noopActions())
		expect(calls)
			.toBe(2)
	})

	it('runLink() invokes the named link\'s run() and ignores unknown/disabled links', () => {
		let ran = false
		const script: TutorialScript = {
			id: 'with-links',
			observationTargets: [],
			steps: [{
				id: 'step',
				title: 'Step',
				target: null,
				stages: [{ prompt: 'p', reveal: 'r' }],
				links: [
					{ id: 'go', label: 'Go', run: () => { ran = true } },
					{ id: 'disabled', label: 'Disabled', disabled: true, run: () => { throw new Error('must not run') } },
				],
			}],
		}
		const engine = createTutorialEngine(script)
		engine.start(noopActions())

		engine.runLink('disabled', noopActions())
		expect(ran)
			.toBe(false)

		engine.runLink('unknown', noopActions())
		expect(ran)
			.toBe(false)

		engine.runLink('go', noopActions())
		expect(ran)
			.toBe(true)
	})
})
