/**
 * `TripMetrics` conformance (checkpoint §2/§4.2): inclusive UTC-calendar-day `tripDays`, the
 * cross-field date-order failure and its cascading `property-dependency` downstream failures, plus the
 * `travelerCount` / `budgetPerPersonPerDay` / `estimatedBaselineCost` formulas.
 */

import { describe, expect, it } from 'vitest'
import { surveyPresets } from '../presets'
import { surveySystem } from '../system'
import { createSurveyRuntime, widgetOfType } from '../test-support'

const destinationOptions = [
	{ value: 'tokyo', label: 'Tokyo' },
	{ value: 'seoul', label: 'Seoul' },
	{ value: 'bangkok', label: 'Bangkok' },
]
const travelStyleOptions = [
	{ value: 'budget', label: 'Budget' },
	{ value: 'balanced', label: 'Balanced' },
	{ value: 'comfort', label: 'Comfort' },
]

const definition = {
	id: 'root',
	type: 'SurveySection',
	config: { title: 'Root' },
	slots: {
		body: [
			{ id: 'departure', type: 'SurveyDateQuestion', config: { label: 'Departure', default: '2027-04-10' } },
			{ id: 'return', type: 'SurveyDateQuestion', config: { label: 'Return', default: '2027-04-14' } },
			{ id: 'adults', type: 'SurveyNumberQuestion', config: { label: 'Adults', default: 2 } },
			{ id: 'children', type: 'SurveyNumberQuestion', config: { label: 'Children', default: 0 } },
			{ id: 'budget', type: 'SurveyNumberQuestion', config: { label: 'Budget', default: 1800 } },
			{ id: 'destination', type: 'SurveyChoiceQuestion', config: { label: 'Destination', options: destinationOptions, default: 'tokyo' } },
			{ id: 'travel-style', type: 'SurveyChoiceQuestion', config: { label: 'Travel style', options: travelStyleOptions, default: 'balanced' } },
			{
				id: 'trip-metrics',
				type: 'TripMetrics',
				config: {
					departureId: 'departure',
					returnId: 'return',
					adultsId: 'adults',
					childrenId: 'children',
					budgetId: 'budget',
					destinationId: 'destination',
					travelStyleId: 'travel-style',
				},
			},
		],
	},
}

function createRuntime() {
	const blueprint = surveySystem.createBlueprint(definition)
	if (blueprint.status !== 'valid')
		throw new Error(`Expected a valid Blueprint, got issues: ${JSON.stringify(blueprint.getCollectedIssues())}`)
	return blueprint.createRuntime()
}

describe('tripMetrics', () => {
	it('tripDays is UTC-calendar-day inclusive: 2027-04-10 through 2027-04-14 = 5', () => {
		const runtime = createRuntime()
		const metrics = widgetOfType(runtime, 'trip-metrics', 'TripMetrics')

		expect(metrics.properties.tripDays.get())
			.toEqual({ success: true, value: 5 })
	})

	it('travelerCount = adults + children', () => {
		const runtime = createRuntime()
		const metrics = widgetOfType(runtime, 'trip-metrics', 'TripMetrics')

		expect(metrics.properties.travelerCount.get())
			.toEqual({ success: true, value: 2 })
	})

	it('estimatedBaselineCost = dailyCost[destination] × styleMultiplier[travelStyle] × travelerCount × tripDays', () => {
		const runtime = createRuntime()
		const metrics = widgetOfType(runtime, 'trip-metrics', 'TripMetrics')

		// tokyo(150) × balanced(1) × travelers(2) × tripDays(5) = 1500
		expect(metrics.properties.estimatedBaselineCost.get())
			.toEqual({ success: true, value: 1500 })
	})

	it('budgetPerPersonPerDay = budget / (travelerCount × tripDays)', () => {
		const runtime = createRuntime()
		const metrics = widgetOfType(runtime, 'trip-metrics', 'TripMetrics')

		// 1800 / (2 × 5) = 180
		expect(metrics.properties.budgetPerPersonPerDay.get())
			.toEqual({ success: true, value: 180 })
	})

	it('return <= departure fails tripDays as a property-result failure, preserving a state-validation-free individual date', () => {
		const runtime = createRuntime()
		const returnQuestion = widgetOfType(runtime, 'return', 'SurveyDateQuestion')
		const metrics = widgetOfType(runtime, 'trip-metrics', 'TripMetrics')

		// Individually calendar-valid, but not strictly after departure (2027-04-10).
		expect(returnQuestion.state.answer.set('2027-04-10').success)
			.toBe(true)

		const result = metrics.properties.tripDays.get()
		expect(result.success)
			.toBe(false)
		if (result.success)
			throw new Error('expected a failure')
		expect(result.issues[0]!.source.type)
			.toBe('property-result')
	})

	it('a tripDays failure cascades into budgetPerPersonPerDay/estimatedBaselineCost as property-dependency failures', () => {
		const runtime = createRuntime()
		const returnQuestion = widgetOfType(runtime, 'return', 'SurveyDateQuestion')
		const metrics = widgetOfType(runtime, 'trip-metrics', 'TripMetrics')

		returnQuestion.state.answer.set('2027-04-01') // strictly before departure
		expect(metrics.properties.tripDays.get().success)
			.toBe(false)

		const budgetPerPersonPerDayResult = metrics.properties.budgetPerPersonPerDay.get()
		const estimatedBaselineCostResult = metrics.properties.estimatedBaselineCost.get()
		expect(budgetPerPersonPerDayResult.success)
			.toBe(false)
		expect(estimatedBaselineCostResult.success)
			.toBe(false)
		if (budgetPerPersonPerDayResult.success || estimatedBaselineCostResult.success)
			throw new Error('expected failures')
		expect(budgetPerPersonPerDayResult.issues[0]!.source.type)
			.toBe('property-dependency')
		expect(estimatedBaselineCostResult.issues[0]!.source.type)
			.toBe('property-dependency')

		// travelerCount does not depend on dates at all, so it is unaffected.
		expect(metrics.properties.travelerCount.get())
			.toEqual({ success: true, value: 2 })
	})
})

describe('tripMetrics nullable-input failures (issue #26 Finding 2, GPT adversarial review round 1)', () => {
	// Every case here clears a real, user-reachable nullable answer (SurveyNumberQuestion's empty
	// input / SurveyChoiceQuestion's "— select —" option both write `null`) and asserts the affected
	// Property fails with an issue rather than silently substituting 0 — a failed Property is what makes
	// `useProperties()` project `null`, which is what `TripMetricsRenderer.vue` renders as "Unavailable".

	it('travelerCount fails when adults is cleared to null (not a "0 adults" reading)', () => {
		const runtime = createRuntime()
		const adults = widgetOfType(runtime, 'adults', 'SurveyNumberQuestion')
		const metrics = widgetOfType(runtime, 'trip-metrics', 'TripMetrics')

		expect(adults.state.answer.set(null).success)
			.toBe(true)

		const result = metrics.properties.travelerCount.get()
		expect(result.success)
			.toBe(false)
		if (result.success)
			throw new Error('expected a failure')
		expect(result.issues[0]!.source.type)
			.toBe('property-result')
	})

	it('travelerCount fails when children is cleared to null', () => {
		const runtime = createRuntime()
		const children = widgetOfType(runtime, 'children', 'SurveyNumberQuestion')
		const metrics = widgetOfType(runtime, 'trip-metrics', 'TripMetrics')

		expect(children.state.answer.set(null).success)
			.toBe(true)

		const result = metrics.properties.travelerCount.get()
		expect(result.success)
			.toBe(false)
	})

	it('budgetPerPersonPerDay fails when budget is cleared to null, even though tripDays/travelerCount both still succeed', () => {
		const runtime = createRuntime()
		const budget = widgetOfType(runtime, 'budget', 'SurveyNumberQuestion')
		const metrics = widgetOfType(runtime, 'trip-metrics', 'TripMetrics')

		expect(budget.state.answer.set(null).success)
			.toBe(true)

		expect(metrics.properties.tripDays.get())
			.toEqual({ success: true, value: 5 })
		expect(metrics.properties.travelerCount.get())
			.toEqual({ success: true, value: 2 })

		const result = metrics.properties.budgetPerPersonPerDay.get()
		expect(result.success)
			.toBe(false)
		if (result.success)
			throw new Error('expected a failure')
		// Its own root cause (a missing budget), not a wrapped tripDays/travelerCount dependency failure.
		expect(result.issues[0]!.source.type)
			.toBe('property-result')
	})

	it('estimatedBaselineCost fails when destination is cleared to null', () => {
		const runtime = createRuntime()
		const destination = widgetOfType(runtime, 'destination', 'SurveyChoiceQuestion')
		const metrics = widgetOfType(runtime, 'trip-metrics', 'TripMetrics')

		expect(destination.state.answer.set(null).success)
			.toBe(true)

		const result = metrics.properties.estimatedBaselineCost.get()
		expect(result.success)
			.toBe(false)
		if (result.success)
			throw new Error('expected a failure')
		expect(result.issues[0]!.source.type)
			.toBe('property-result')
	})

	it('estimatedBaselineCost fails when travel-style is cleared to null', () => {
		const runtime = createRuntime()
		const travelStyle = widgetOfType(runtime, 'travel-style', 'SurveyChoiceQuestion')
		const metrics = widgetOfType(runtime, 'trip-metrics', 'TripMetrics')

		expect(travelStyle.state.answer.set(null).success)
			.toBe(true)

		const result = metrics.properties.estimatedBaselineCost.get()
		expect(result.success)
			.toBe(false)
	})

	it('a tripDays failure still propagates structurally into budgetPerPersonPerDay/estimatedBaselineCost (no duplicate issue added by this fix)', () => {
		const runtime = createRuntime()
		const returnQuestion = widgetOfType(runtime, 'return', 'SurveyDateQuestion')
		const metrics = widgetOfType(runtime, 'trip-metrics', 'TripMetrics')

		returnQuestion.state.answer.set('2027-04-01') // strictly before departure

		const budgetPerPersonPerDayResult = metrics.properties.budgetPerPersonPerDay.get()
		expect(budgetPerPersonPerDayResult.success)
			.toBe(false)
		if (budgetPerPersonPerDayResult.success)
			throw new Error('expected a failure')
		// Exactly one issue: the propagated tripDays dependency failure, not a second self-reported one.
		expect(budgetPerPersonPerDayResult.issues)
			.toHaveLength(1)
		expect(budgetPerPersonPerDayResult.issues[0]!.source.type)
			.toBe('property-dependency')
	})
})

describe('tripMetrics against the "survey-not-ready" preset (issue #26 Finding 2 knock-on check)', () => {
	it('renders sanely: TripMetrics properties all still succeed, only TripReadiness fails on the missing family-priority answer', () => {
		const notReadyPreset = surveyPresets.find(preset => preset.id === 'survey-not-ready')!
		const { runtime } = createSurveyRuntime(notReadyPreset.sourceText)
		const metrics = widgetOfType(runtime, 'trip-metrics', 'TripMetrics')
		const readiness = widgetOfType(runtime, 'trip-readiness', 'TripReadiness')

		// None of TripMetrics' own nullable inputs (adults/children/budget/destination/travel-style) are
		// null in this preset — only `family-priority` is unanswered, and TripMetrics never reads it — so
		// the live metrics stay fully computed (no "Unavailable" coexisting with the readiness failure
		// here); only readiness (and therefore Submit/Recommendation) fails.
		expect(metrics.properties.tripDays.get().success)
			.toBe(true)
		expect(metrics.properties.travelerCount.get())
			.toEqual({ success: true, value: 4 })
		expect(metrics.properties.budgetPerPersonPerDay.get().success)
			.toBe(true)
		expect(metrics.properties.estimatedBaselineCost.get().success)
			.toBe(true)
		expect(readiness.properties.ready.get().success)
			.toBe(false)
	})
})
