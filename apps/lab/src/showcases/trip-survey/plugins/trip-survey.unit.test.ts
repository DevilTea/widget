/**
 * `TripSurvey.reset()` / `.submit()` / `.generateResult()` (checkpoint §5), against the real canonical
 * presets (`../presets.ts`) — the same source every showcase user sees. Also covers the intentional
 * two-stage `submit -> generateResult` lazy-evaluation property: `TripReadiness`/`TripRecommendation`
 * Properties stay `never-evaluated` (via `@deviltea/widget-core/inspection`, never activated by
 * inspecting them) until the corresponding Method naturally evaluates them.
 */

import type { InspectionNodeId, RuntimePropertyInspectionSnapshot } from '@deviltea/widget-core/inspection'
import { inspectBlueprint, inspectRuntime } from '@deviltea/widget-core/inspection'
import { describe, expect, it } from 'vitest'
import { defaultSurveyPreset, surveyPresets } from '../presets'
import { createSurveyRuntime, widgetOfType } from '../test-support'

function nodeIdOf(runtime: ReturnType<typeof createSurveyRuntime>['runtime'], id: string): InspectionNodeId {
	const node = runtime.blueprint.getWidget(id)
	if (node === null)
		throw new Error(`Expected widget "${id}" to exist in the Blueprint.`)
	const nodeId = inspectBlueprint(runtime.blueprint)
		.getNodeId(node)
	if (nodeId === null)
		throw new Error(`Expected widget "${id}" to have an InspectionNodeId.`)
	return nodeId
}

function propertySnapshot(
	runtime: ReturnType<typeof createSurveyRuntime>['runtime'],
	widgetId: string,
	propertyName: string,
): RuntimePropertyInspectionSnapshot<unknown> {
	const runtimeInspection = inspectRuntime(runtime)
	const widgetInspection = runtimeInspection.getWidget(nodeIdOf(runtime, widgetId))
	if (widgetInspection === null)
		throw new Error(`Expected a RuntimeWidgetInspection for "${widgetId}".`)
	const propertyInspection = widgetInspection.getProperty(propertyName)
	if (propertyInspection === null)
		throw new Error(`Expected a RuntimePropertyInspection for "${widgetId}.${propertyName}".`)
	return propertyInspection.getSnapshot()
}

const notReadyPreset = surveyPresets.find(preset => preset.id === 'survey-not-ready')!

describe('tripSurvey.reset()', () => {
	it('restores every configured question to its default, phase to editing, and result to null', () => {
		const { runtime } = createSurveyRuntime()
		const survey = widgetOfType(runtime, 'trip-survey', 'TripSurvey')
		const departure = widgetOfType(runtime, 'departure', 'SurveyDateQuestion')
		const adults = widgetOfType(runtime, 'adults', 'SurveyNumberQuestion')

		departure.state.answer.set('2027-06-01')
		adults.state.answer.set(4)
		survey.state.phase.set('submitted')

		survey.methods.reset()

		expect(departure.state.answer.get())
			.toBe('2027-04-10')
		expect(adults.state.answer.get())
			.toBe(2)
		expect(survey.state.phase.get())
			.toBe('editing')
		expect(survey.state.result.get())
			.toBeNull()
	})
})

describe('tripSurvey.submit()', () => {
	it('succeeds, sets phase to submitted and result to null, when the survey is ready', () => {
		const { runtime } = createSurveyRuntime()
		const survey = widgetOfType(runtime, 'trip-survey', 'TripSurvey')

		expect(survey.methods.submit())
			.toEqual({ ok: true, value: true })
		expect(survey.state.phase.get())
			.toBe('submitted')
		expect(survey.state.result.get())
			.toBeNull()
	})

	it('fails via Method dependency propagation with no phase/result mutation when not ready', () => {
		const { runtime } = createSurveyRuntime(notReadyPreset.sourceText)
		const survey = widgetOfType(runtime, 'trip-survey', 'TripSurvey')

		const result = survey.methods.submit()
		expect(result.ok)
			.toBe(false)
		if (result.ok)
			throw new Error('expected a failure')
		expect(result.failure.diagnostics[0]!.code)
			.toBe('dependency-target-failed')
		expect(survey.state.phase.get())
			.toBe('editing')
		expect(survey.state.result.get())
			.toBeNull()
	})
})

describe('tripSurvey.generateResult()', () => {
	it('fails with a Method diagnostic and performs no mutation when phase is not "submitted"', () => {
		const { runtime } = createSurveyRuntime()
		const survey = widgetOfType(runtime, 'trip-survey', 'TripSurvey')

		expect(survey.state.phase.get())
			.toBe('editing')
		const result = survey.methods.generateResult()
		expect(result.ok)
			.toBe(false)
		if (result.ok)
			throw new Error('expected a failure')
		expect(result.failure.diagnostics[0]!.code)
			.toBe('invalid-method-result')
		expect(survey.state.phase.get())
			.toBe('editing')
		expect(survey.state.result.get())
			.toBeNull()
	})

	it('succeeds after submit(), copying the recommendation snapshot and setting phase to "result"', () => {
		const { runtime } = createSurveyRuntime()
		const survey = widgetOfType(runtime, 'trip-survey', 'TripSurvey')

		survey.methods.submit()
		const result = survey.methods.generateResult()

		expect(result.ok)
			.toBe(true)
		if (!result.ok)
			throw new Error('expected ok')
		expect(result.value)
			.not.toBeNull()
		expect(survey.state.phase.get())
			.toBe('result')
		expect(survey.state.result.get())
			.toEqual(result.value)
	})

	it('fails via Method dependency propagation with no mutation when the recommendation regresses after submit', () => {
		const { runtime } = createSurveyRuntime()
		const survey = widgetOfType(runtime, 'trip-survey', 'TripSurvey')
		const destination = widgetOfType(runtime, 'destination', 'SurveyChoiceQuestion')

		survey.methods.submit()
		expect(survey.state.phase.get())
			.toBe('submitted')

		// Regress readiness after submit — still "submitted", but TripRecommendation.result now fails.
		destination.state.answer.set(null)

		const result = survey.methods.generateResult()
		expect(result.ok)
			.toBe(false)
		if (result.ok)
			throw new Error('expected a failure')
		expect(result.failure.diagnostics[0]!.code)
			.toBe('dependency-target-failed')
		expect(survey.state.phase.get())
			.toBe('submitted')
		expect(survey.state.result.get())
			.toBeNull()
	})
})

describe('lazy evaluation: TripReadiness/TripRecommendation stay never-evaluated until naturally activated', () => {
	it('both Properties start never-evaluated on a fresh Runtime', () => {
		const { runtime } = createSurveyRuntime()

		expect(propertySnapshot(runtime, 'trip-readiness', 'ready'))
			.toEqual({ status: 'never-evaluated' })
		expect(propertySnapshot(runtime, 'trip-recommendation', 'result'))
			.toEqual({ status: 'never-evaluated' })
	})

	it('submit() activates TripReadiness but not TripRecommendation', () => {
		const { runtime } = createSurveyRuntime()
		const survey = widgetOfType(runtime, 'trip-survey', 'TripSurvey')

		survey.methods.submit()

		expect(propertySnapshot(runtime, 'trip-readiness', 'ready').status)
			.toBe('completed')
		expect(propertySnapshot(runtime, 'trip-recommendation', 'result'))
			.toEqual({ status: 'never-evaluated' })
	})

	it('generateResult() (after submit()) also activates TripRecommendation', () => {
		const { runtime } = createSurveyRuntime()
		const survey = widgetOfType(runtime, 'trip-survey', 'TripSurvey')

		survey.methods.submit()
		survey.methods.generateResult()

		expect(propertySnapshot(runtime, 'trip-recommendation', 'result').status)
			.toBe('completed')
	})
})

describe('tripSurvey.resultFresh (diagnostic #26 Finding 1)', () => {
	it('is true immediately after generateResult() (snapshot matches current answers)', () => {
		const { runtime } = createSurveyRuntime()
		const survey = widgetOfType(runtime, 'trip-survey', 'TripSurvey')

		survey.methods.submit()
		survey.methods.generateResult()

		expect(survey.properties.resultFresh.get())
			.toEqual({ ok: true, value: true })
	})

	it('flips false after changing a tracked answer, even one that makes the current answers invalid', () => {
		const { runtime } = createSurveyRuntime()
		const survey = widgetOfType(runtime, 'trip-survey', 'TripSurvey')
		const destination = widgetOfType(runtime, 'destination', 'SurveyChoiceQuestion')

		survey.methods.submit()
		survey.methods.generateResult()
		expect(survey.properties.resultFresh.get())
			.toEqual({ ok: true, value: true })

		// `destination` is a tracked `resultInputQuestionIds` question; setting its answer to `null` also
		// makes it fail `TripReadiness`/`TripRecommendation` — `resultFresh` must still report `false`,
		// since it compares tracked answers rather than re-deciding current validity.
		destination.state.answer.set(null)

		expect(survey.properties.resultFresh.get())
			.toEqual({ ok: true, value: false })
		// The retained snapshot itself is untouched while stale.
		expect(survey.state.result.get())
			.not.toBeNull()
	})

	it('flips false after changing a tracked answer the recommendation never reads (over-approximation)', () => {
		const { runtime } = createSurveyRuntime()
		const survey = widgetOfType(runtime, 'trip-survey', 'TripSurvey')
		const familyPriority = widgetOfType(runtime, 'family-priority', 'SurveyChoiceQuestion')

		survey.methods.submit()
		survey.methods.generateResult()
		expect(survey.properties.resultFresh.get())
			.toEqual({ ok: true, value: true })

		// `children` defaults to 0 in the default preset, so `family-priority` is hidden and ignored by
		// both `TripReadiness`/`TripRecommendation` (see `trip-readiness.ts`'s file header) — yet it is
		// still one of `resultInputQuestionIds`' tracked questions, so changing it must still mark stale.
		familyPriority.state.answer.set('kid-friendly')

		expect(survey.properties.resultFresh.get())
			.toEqual({ ok: true, value: false })
	})

	it('is true again after re-submitting and regenerating the result', () => {
		const { runtime } = createSurveyRuntime()
		const survey = widgetOfType(runtime, 'trip-survey', 'TripSurvey')
		const adults = widgetOfType(runtime, 'adults', 'SurveyNumberQuestion')

		survey.methods.submit()
		survey.methods.generateResult()
		adults.state.answer.set(3)
		expect(survey.properties.resultFresh.get())
			.toEqual({ ok: true, value: false })

		survey.methods.submit()
		survey.methods.generateResult()

		expect(survey.properties.resultFresh.get())
			.toEqual({ ok: true, value: true })
	})

	it('is true when there is no result yet (documented no-result convention)', () => {
		const { runtime } = createSurveyRuntime()
		const survey = widgetOfType(runtime, 'trip-survey', 'TripSurvey')

		expect(survey.state.result.get())
			.toBeNull()
		expect(survey.properties.resultFresh.get())
			.toEqual({ ok: true, value: true })
	})

	it('reset() clears both result and resultInputs, and a subsequent generateResult() is fresh again', () => {
		const { runtime } = createSurveyRuntime()
		const survey = widgetOfType(runtime, 'trip-survey', 'TripSurvey')

		survey.methods.submit()
		survey.methods.generateResult()
		expect(survey.state.result.get())
			.not.toBeNull()

		survey.methods.reset()

		expect(survey.state.result.get())
			.toBeNull()
		expect(survey.state.resultInputs.get())
			.toBeNull()
		expect(survey.properties.resultFresh.get())
			.toEqual({ ok: true, value: true })
	})
})

describe('tripSurvey.resultFresh is decoupled from resetQuestionIds (diagnostic #26, GPT adversarial review round 1)', () => {
	// Reproduction from the review: a Source edit that narrows `resetQuestionIds` to a strict subset of
	// `resultInputQuestionIds` must remain a fully valid, functioning Survey — and `resultFresh` must
	// still track every `resultInputQuestionIds` question regardless of what `resetQuestionIds` says.
	function createRuntimeWithNarrowedResetSet() {
		const definition = JSON.parse(defaultSurveyPreset.sourceText) as { config: { resetQuestionIds: string[], resultInputQuestionIds: string[] } }
		definition.config.resetQuestionIds = definition.config.resetQuestionIds.filter(id => id !== 'return')
		expect(definition.config.resultInputQuestionIds)
			.toContain('return')
		return createSurveyRuntime(JSON.stringify(definition))
	}

	it('resultFresh still flips false when "return" changes, even though resetQuestionIds no longer includes it', () => {
		const { runtime } = createRuntimeWithNarrowedResetSet()
		const survey = widgetOfType(runtime, 'trip-survey', 'TripSurvey')
		const returnQuestion = widgetOfType(runtime, 'return', 'SurveyDateQuestion')

		survey.methods.submit()
		survey.methods.generateResult()
		expect(survey.properties.resultFresh.get())
			.toEqual({ ok: true, value: true })

		returnQuestion.state.answer.set('2027-04-20')

		expect(survey.properties.resultFresh.get())
			.toEqual({ ok: true, value: false })
	})

	it('reset() only restores the narrowed resetQuestionIds set, leaving "return" untouched', () => {
		const { runtime } = createRuntimeWithNarrowedResetSet()
		const survey = widgetOfType(runtime, 'trip-survey', 'TripSurvey')
		const returnQuestion = widgetOfType(runtime, 'return', 'SurveyDateQuestion')

		returnQuestion.state.answer.set('2027-04-20')
		survey.methods.reset()

		// "return" is deliberately excluded from this variant's resetQuestionIds, so reset() must not
		// restore it — proving resetQuestionIds and resultInputQuestionIds are genuinely independent
		// config keys, not just two names for the same list.
		expect(returnQuestion.state.answer.get())
			.toBe('2027-04-20')
	})
})

describe('presets.ts preset ids', () => {
	it('exposes the canonical default preset first', () => {
		expect(surveyPresets[0])
			.toBe(defaultSurveyPreset)
	})
})
