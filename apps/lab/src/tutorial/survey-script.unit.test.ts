/**
 * The Survey tour's step predicates against a REAL `@deviltea/widget-core` Runtime built from the actual
 * `survey-default` preset (`showcases/survey/test-support.ts`) — never a mock. Each predicate is read
 * through the exact passive `TutorialRuntimeReader` the engine uses (`createRuntimeReader`), so a
 * Property only counts once something evaluated it. In the real app the Preview's renderers are that
 * "real consumer"; here `observe()` plays the same part by calling `.get()` on every Property the survey
 * renderers always read (`visible`, `errors`, `changedSinceSubmit`, `response`).
 *
 * Every step's stages are checked false before and true after the scripted writes, and one test walks the
 * whole script through the real `createTutorialEngine`.
 */

import type { TutorialActions, TutorialStepDefinition } from './types'
import { describe, expect, it, vi } from 'vitest'
import { translateMessage } from '../i18n/messages'
import { createSurveyRuntime, widgetOfType } from '../showcases/survey/test-support'
import { createTutorialEngine } from './engine'
import { createRuntimeReader } from './inspection-reader'
import { SURVEY_TOUR_ID, surveyTourScript } from './survey-script'

function setup() {
	const { runtime } = createSurveyRuntime()
	const mode = widgetOfType(runtime, 'mode', 'SingleChoice')
	const guests = widgetOfType(runtime, 'guests', 'Numeric')
	const sessions = widgetOfType(runtime, 'sessions', 'MultipleChoice')
	const phone = widgetOfType(runtime, 'phone', 'ShortAnswer')
	const root = widgetOfType(runtime, 'open-day', 'Survey')
	const reader = createRuntimeReader(runtime)

	/** The Properties the survey renderers always read in Preview, evaluated the way Preview does. */
	function observe(): void {
		for (const question of [mode, guests, sessions, phone]) {
			question.properties.visible.get()
			question.properties.errors.get()
		}
		root.properties.response.get()
		root.properties.changedSinceSubmit.get()
	}

	return { runtime, mode, guests, sessions, phone, root, reader, observe }
}

function step(id: string): TutorialStepDefinition {
	const found = surveyTourScript.steps.find(candidate => candidate.id === id)
	if (found === undefined)
		throw new Error(`No step "${id}"`)
	return found
}

/** `isComplete` of one stage, which every action-gated stage declares. */
function stage(id: string, index = 0) {
	const predicate = step(id).stages[index]?.isComplete
	if (predicate === undefined)
		throw new Error(`Step "${id}" stage ${index} has no predicate`)
	return predicate
}

describe('surveyTourScript shape', () => {
	it('has the nine steps under the tour id the showcase shares', () => {
		expect(surveyTourScript.id)
			.toBe(SURVEY_TOUR_ID)
		expect(SURVEY_TOUR_ID)
			.toBe('survey')
		expect(surveyTourScript.steps.map(candidate => candidate.id))
			.toEqual(['orient', 'state', 'property', 'error-and-recovery', 'dependency', 'direct-write-vs-method', 'stale-snapshot', 'map-the-views', 'hand-back'])
	})

	it('observes exactly the members its predicates read', () => {
		expect(surveyTourScript.observationTargets)
			.toEqual([
				{ widgetId: 'mode', member: { type: 'state', key: 'answer' } },
				{ widgetId: 'guests', member: { type: 'property', key: 'errors' } },
				{ widgetId: 'guests', member: { type: 'property', key: 'visible' } },
				{ widgetId: 'open-day', member: { type: 'state', key: 'submitted' } },
				{ widgetId: 'open-day', member: { type: 'property', key: 'changedSinceSubmit' } },
			])
	})

	it('only names widgets and members that exist in survey-default', () => {
		const { runtime } = createSurveyRuntime()
		const reader = createRuntimeReader(runtime)
		for (const { widgetId, member } of surveyTourScript.observationTargets) {
			if (member.type === 'state') {
				expect(reader.readState(widgetId, member.key), `${widgetId}.${member.key}`).not.toBeUndefined()
			}
			else {
				expect(reader.readProperty(widgetId, member.key), `${widgetId}.${member.key}`)
					.toEqual({ status: 'never-evaluated' })
			}
		}
	})

	it('has a zh-TW translation for every title, prompt, reveal and action link label', () => {
		const sources = new Set<string>()
		for (const candidate of surveyTourScript.steps) {
			sources.add(candidate.title)
			for (const { prompt, reveal } of candidate.stages) {
				sources.add(prompt)
				sources.add(reveal)
			}
			// The view-name links (Author, Blueprint, ...) are proper names that read the same in zh-TW.
			for (const link of (candidate.links ?? []).filter(({ id }) => !id.startsWith('view-')))
				sources.add(link.label)
		}
		const untranslated = [...sources].filter(source => translateMessage('zh-TW', source) === source)
		expect(untranslated)
			.toEqual([])
	})
})

describe('step "state" (choose On site)', () => {
	it('is false before, false for Online, true once "onsite" is stored', () => {
		const { mode, reader, observe } = setup()
		const complete = stage('state')
		observe()
		expect(complete(reader))
			.toBe(false)

		mode.state.answer.set('online')
		observe()
		expect(complete(reader))
			.toBe(false)

		mode.state.answer.set('onsite')
		observe()
		expect(complete(reader))
			.toBe(true)
	})
})

describe('step "property"', () => {
	it('is a narration-only step: its stage has no predicate', () => {
		expect(step('property').stages)
			.toHaveLength(1)
		expect(step('property').stages[0].isComplete)
			.toBeUndefined()
	})
})

describe('step "error-and-recovery"', () => {
	it('completes the error stage only for a stored answer above max, and the recovery stage once errors are empty', () => {
		const { mode, guests, reader, observe } = setup()
		mode.state.answer.set('onsite')
		observe()
		const errorShown = stage('error-and-recovery', 0)
		const recovered = stage('error-and-recovery', 1)

		// Visible but unanswered: Guests reports `required`, which is not the scripted `max` error.
		expect(errorShown(reader))
			.toBe(false)
		expect(recovered(reader))
			.toBe(false)

		guests.state.answer.set(5)
		observe()
		expect(guests.state.answer.get())
			.toBe(5)
		expect(errorShown(reader))
			.toBe(true)
		expect(recovered(reader))
			.toBe(false)

		guests.state.answer.set(2)
		observe()
		expect(recovered(reader))
			.toBe(true)
	})

	it('accepts any number above max and any recovery, but not other answer errors', () => {
		const { mode, guests, reader, observe } = setup()
		mode.state.answer.set('onsite')
		const errorShown = stage('error-and-recovery', 0)
		const recovered = stage('error-and-recovery', 1)

		// `integer` and `min` errors are answer errors too, but not the scripted `max` one.
		for (const [answer, code] of [[2.5, 'integer'], [-1, 'min']] as const) {
			guests.state.answer.set(answer)
			observe()
			expect(guests.properties.errors.get())
				.toMatchObject({ ok: true, value: [{ code }] })
			expect(errorShown(reader), `${code} error`)
				.toBe(false)
			expect(recovered(reader), `${code} error`)
				.toBe(false)
		}

		// Any number above max completes the first phase (the copy does not name a number), and any valid
		// number, including 0, completes the second.
		guests.state.answer.set(4)
		observe()
		expect(errorShown(reader))
			.toBe(true)
		guests.state.answer.set(0)
		observe()
		expect(recovered(reader))
			.toBe(true)
	})

	it('does not read a Property nothing evaluated yet', () => {
		const { mode, guests, reader } = setup()
		mode.state.answer.set('onsite')
		guests.state.answer.set(5)

		expect(reader.readProperty('guests', 'errors'))
			.toEqual({ status: 'never-evaluated' })
		expect(stage('error-and-recovery', 0)(reader))
			.toBe(false)
	})
})

describe('step "dependency"', () => {
	it('completes when Guests hides under Online, and again when On site brings it back', () => {
		const { mode, guests, reader, observe } = setup()
		mode.state.answer.set('onsite')
		guests.state.answer.set(2)
		observe()
		const hidden = stage('dependency', 0)
		const shown = stage('dependency', 1)

		expect(hidden(reader))
			.toBe(false)
		expect(shown(reader))
			.toBe(true) // true on its own: it is only ever asked after the first stage completed.

		mode.state.answer.set('online')
		observe()
		expect(hidden(reader))
			.toBe(true)
		expect(shown(reader))
			.toBe(false)

		mode.state.answer.set('onsite')
		observe()
		expect(shown(reader))
			.toBe(true)
		// Hiding never erased the stored answer.
		expect(guests.state.answer.get())
			.toBe(2)
	})
})

describe('step "dependency" without an evaluated Property', () => {
	it('is not complete while guests.visible has not been evaluated or is not false', () => {
		const { mode, reader, observe } = setup()
		const hidden = stage('dependency', 0)

		// Nothing has evaluated `visible` yet: the predicate must fail closed, not read it as "not true".
		expect(reader.readProperty('guests', 'visible'))
			.toEqual({ status: 'never-evaluated' })
		expect(hidden(reader))
			.toBe(false)

		mode.state.answer.set('onsite')
		observe()
		expect(reader.readProperty('guests', 'visible'))
			.toEqual({ status: 'completed', result: { ok: true, value: true } })
		expect(hidden(reader))
			.toBe(false)
	})
})

describe('step "direct-write-vs-method"', () => {
	it('stays false for a blocked Submit and completes once a Submit stores the response', () => {
		const { mode, guests, sessions, phone, root, reader, observe } = setup()
		const submitted = stage('direct-write-vs-method')
		mode.state.answer.set('onsite')
		guests.state.answer.set(2)
		observe()
		expect(submitted(reader))
			.toBe(false)

		// No session and no phone number yet: the Method refuses and writes nothing.
		const blocked = root.methods.submit()
		expect(blocked.ok)
			.toBe(false)
		expect(submitted(reader))
			.toBe(false)

		sessions.state.answer.set(['printing'])
		phone.state.answer.set('0912 345 678')
		observe()
		expect(root.methods.submit().ok)
			.toBe(true)
		expect(submitted(reader))
			.toBe(true)
	})
})

describe('step "stale-snapshot"', () => {
	it('completes once an answer changes after the Submit', () => {
		const { mode, guests, sessions, phone, root, reader, observe } = setup()
		const changed = stage('stale-snapshot')
		mode.state.answer.set('onsite')
		guests.state.answer.set(2)
		sessions.state.answer.set(['printing'])
		phone.state.answer.set('0912 345 678')
		observe()
		root.methods.submit()
		observe()
		expect(changed(reader))
			.toBe(false)

		guests.state.answer.set(1)
		observe()
		expect(changed(reader))
			.toBe(true)
	})
})

describe('the whole script on a real Runtime', () => {
	it('walks nine steps with the scripted interactions, each revealing before Next enables', () => {
		const { mode, guests, sessions, phone, root, reader, observe } = setup()
		const engine = createTutorialEngine(surveyTourScript)
		const actions: TutorialActions = {
			setFocus: vi.fn(),
			activateTab: vi.fn(),
			openImplementation: vi.fn(),
			startTour: vi.fn(),
		}
		const settle = (): void => {
			observe()
			engine.recheck(reader)
		}
		const expectStep = (id: string, canAdvance: boolean): void => {
			expect(engine.getSnapshot().step?.id)
				.toBe(id)
			expect(engine.getSnapshot().canAdvance, `${id} canAdvance`)
				.toBe(canAdvance)
		}
		const advance = (): void => engine.next(actions)

		engine.start(actions)
		settle()
		expectStep('orient', true)
		advance()

		settle()
		expectStep('state', false)
		mode.state.answer.set('onsite')
		settle()
		expectStep('state', true)
		advance()

		settle()
		expectStep('property', true)
		advance()

		settle()
		expectStep('error-and-recovery', false)
		guests.state.answer.set(5)
		settle()
		expectStep('error-and-recovery', false)
		expect(engine.getSnapshot().revealed)
			.toHaveLength(1)
		guests.state.answer.set(2)
		settle()
		expectStep('error-and-recovery', true)
		advance()

		settle()
		expectStep('dependency', false)
		mode.state.answer.set('online')
		settle()
		expectStep('dependency', false)
		mode.state.answer.set('onsite')
		settle()
		expectStep('dependency', true)
		advance()

		settle()
		expectStep('direct-write-vs-method', false)
		sessions.state.answer.set(['laser'])
		phone.state.answer.set('0912 345 678')
		settle()
		expect(root.methods.submit().ok)
			.toBe(true)
		settle()
		expectStep('direct-write-vs-method', true)
		advance()

		settle()
		expectStep('stale-snapshot', false)
		guests.state.answer.set(1)
		settle()
		expectStep('stale-snapshot', true)
		advance()

		settle()
		expectStep('map-the-views', true)
		advance()
		settle()
		expectStep('hand-back', true)
		advance()
		expect(engine.getSnapshot().status)
			.toBe('completed')
	})
})
