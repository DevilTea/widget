/**
 * `TripMetrics` conformance (checkpoint §2/§4.2): inclusive UTC-calendar-day `tripDays`, the
 * cross-field date-order failure and its cascading `property-dependency` downstream failures, plus the
 * `travelerCount` / `budgetPerPersonPerDay` / `estimatedBaselineCost` formulas.
 */

import { describe, expect, it } from 'vitest'
import { surveySystem } from '../system'
import { widgetOfType } from '../test-support'

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
