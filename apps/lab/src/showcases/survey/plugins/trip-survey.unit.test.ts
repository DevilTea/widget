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
			.toEqual({ success: true, value: true })
		expect(survey.state.phase.get())
			.toBe('submitted')
		expect(survey.state.result.get())
			.toBeNull()
	})

	it('fails via Method dependency propagation with no phase/result mutation when not ready', () => {
		const { runtime } = createSurveyRuntime(notReadyPreset.sourceText)
		const survey = widgetOfType(runtime, 'trip-survey', 'TripSurvey')

		const result = survey.methods.submit()
		expect(result.success)
			.toBe(false)
		if (result.success)
			throw new Error('expected a failure')
		expect(result.issues[0]!.source.type)
			.toBe('method-dependency')
		expect(survey.state.phase.get())
			.toBe('editing')
		expect(survey.state.result.get())
			.toBeNull()
	})
})

describe('tripSurvey.generateResult()', () => {
	it('fails with a Method issue and performs no mutation when phase is not "submitted"', () => {
		const { runtime } = createSurveyRuntime()
		const survey = widgetOfType(runtime, 'trip-survey', 'TripSurvey')

		expect(survey.state.phase.get())
			.toBe('editing')
		const result = survey.methods.generateResult()
		expect(result.success)
			.toBe(false)
		if (result.success)
			throw new Error('expected a failure')
		expect(result.issues[0]!.source.type)
			.toBe('method-result')
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

		expect(result.success)
			.toBe(true)
		if (!result.success)
			throw new Error('expected success')
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
		expect(result.success)
			.toBe(false)
		if (result.success)
			throw new Error('expected a failure')
		expect(result.issues[0]!.source.type)
			.toBe('method-dependency')
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

describe('presets.ts preset ids', () => {
	it('exposes the canonical default preset first', () => {
		expect(surveyPresets[0])
			.toBe(defaultSurveyPreset)
	})
})
