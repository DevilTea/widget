/**
 * `TripRecommendation` locked C2 dependency-failure semantics plus the deterministic fit-threshold /
 * style-downgrade / family-notes model (checkpoint §2).
 *
 * Every scenario fixes `destination: tokyo` (dailyCost 150), `adults: 2, children: 0` (travelerCount 2)
 * and `departure/return` 2027-04-10..04-14 (tripDays 5) unless a scenario overrides `children`, so
 * `estimatedBaselineCost = 150 × styleMultiplier[travelStyle] × 2 × 5` is fully determined by the
 * requested travel style alone.
 */

import { describe, expect, it } from 'vitest'
import { surveySystem } from '../system'
import { widgetOfType } from '../test-support'

const destinationOptions = [{ value: 'tokyo', label: 'Tokyo' }]
const travelStyleOptions = [
	{ value: 'budget', label: 'Budget' },
	{ value: 'balanced', label: 'Balanced' },
	{ value: 'comfort', label: 'Comfort' },
]
const familyPriorityOptions = [
	{ value: 'easy-transit', label: 'Easy transit' },
	{ value: 'kid-friendly', label: 'Kid-friendly' },
	{ value: 'relaxed-pace', label: 'Relaxed pace' },
]

interface Scenario {
	readonly budget: number
	readonly travelStyle: string
	readonly children?: number
	readonly familyPriority?: string | null
	readonly destinationAnswered?: boolean
}

function createRuntime(scenario: Scenario) {
	const definition = {
		id: 'root',
		type: 'SurveySection',
		config: { title: 'Root' },
		slots: {
			body: [
				{ id: 'departure', type: 'SurveyDateQuestion', config: { label: 'Departure', default: '2027-04-10' } },
				{ id: 'return', type: 'SurveyDateQuestion', config: { label: 'Return', default: '2027-04-14' } },
				{ id: 'adults', type: 'SurveyNumberQuestion', config: { label: 'Adults', default: 2 } },
				{ id: 'children', type: 'SurveyNumberQuestion', config: { label: 'Children', default: scenario.children ?? 0 } },
				{ id: 'budget', type: 'SurveyNumberQuestion', config: { label: 'Budget', default: scenario.budget } },
				{ id: 'destination', type: 'SurveyChoiceQuestion', config: { label: 'Destination', options: destinationOptions, default: scenario.destinationAnswered === false ? null : 'tokyo' } },
				{ id: 'travel-style', type: 'SurveyChoiceQuestion', config: { label: 'Travel style', options: travelStyleOptions, default: scenario.travelStyle } },
				{ id: 'family-priority', type: 'SurveyChoiceQuestion', config: { label: 'Family priority', options: familyPriorityOptions, default: scenario.familyPriority ?? null } },
				{
					id: 'trip-metrics',
					type: 'TripMetrics',
					config: { departureId: 'departure', returnId: 'return', adultsId: 'adults', childrenId: 'children', budgetId: 'budget', destinationId: 'destination', travelStyleId: 'travel-style' },
				},
				{
					id: 'trip-readiness',
					type: 'TripReadiness',
					config: {
						departureId: 'departure',
						returnId: 'return',
						adultsId: 'adults',
						childrenId: 'children',
						budgetId: 'budget',
						destinationId: 'destination',
						travelStyleId: 'travel-style',
						familyPriorityId: 'family-priority',
						metricsId: 'trip-metrics',
					},
				},
				{
					id: 'trip-recommendation',
					type: 'TripRecommendation',
					config: {
						readinessId: 'trip-readiness',
						metricsId: 'trip-metrics',
						budgetId: 'budget',
						destinationId: 'destination',
						travelStyleId: 'travel-style',
						childrenId: 'children',
						familyPriorityId: 'family-priority',
					},
				},
			],
		},
	}

	const blueprint = surveySystem.createBlueprint(definition)
	if (blueprint.status !== 'valid')
		throw new Error(`Expected a valid Blueprint, got issues: ${JSON.stringify(blueprint.getCollectedIssues())}`)
	return blueprint.createRuntime()
}

describe('tripRecommendation.result (C2)', () => {
	it('fails via property-dependency when TripReadiness.ready fails — no fallback/partial recommendation', () => {
		const runtime = createRuntime({ budget: 1800, travelStyle: 'balanced', destinationAnswered: false })
		const recommendation = widgetOfType(runtime, 'trip-recommendation', 'TripRecommendation')

		const result = recommendation.properties.result.get()
		expect(result.success)
			.toBe(false)
		if (result.success)
			throw new Error('expected a failure')
		expect(result.issues[0]!.source.type)
			.toBe('property-dependency')
	})

	it('fit "comfortable" (ratio >= 1.20) keeps the requested style', () => {
		// estimatedBaselineCost = 150 × 1 (balanced) × 2 × 5 = 1500; ratio = 1800 / 1500 = 1.20
		const runtime = createRuntime({ budget: 1800, travelStyle: 'balanced' })
		const recommendation = widgetOfType(runtime, 'trip-recommendation', 'TripRecommendation')

		const result = recommendation.properties.result.get()
		expect(result)
			.toEqual({
				success: true,
				value: expect.objectContaining({
					fit: 'comfortable',
					requestedStyle: 'balanced',
					recommendedStyle: 'balanced',
					estimatedBaselineCost: 1500,
					budgetGap: 300,
					budgetPerPersonPerDay: 180,
				}),
			})
	})

	it('fit "workable" (0.95 <= ratio < 1.20) keeps the requested style', () => {
		// ratio = 1425 / 1500 = 0.95
		const runtime = createRuntime({ budget: 1425, travelStyle: 'balanced' })
		const recommendation = widgetOfType(runtime, 'trip-recommendation', 'TripRecommendation')

		const result = recommendation.properties.result.get()
		expect(result.success)
			.toBe(true)
		if (!result.success)
			throw new Error('expected success')
		expect(result.value.fit)
			.toBe('workable')
		expect(result.value.recommendedStyle)
			.toBe('balanced')
	})

	it('fit "tight" downgrades comfort -> balanced', () => {
		// estimatedBaselineCost = 150 × 1.4 × 2 × 5 = 2100; ratio = 1000 / 2100 ≈ 0.476
		const runtime = createRuntime({ budget: 1000, travelStyle: 'comfort' })
		const recommendation = widgetOfType(runtime, 'trip-recommendation', 'TripRecommendation')

		const result = recommendation.properties.result.get()
		expect(result.success)
			.toBe(true)
		if (!result.success)
			throw new Error('expected success')
		expect(result.value.fit)
			.toBe('tight')
		expect(result.value.requestedStyle)
			.toBe('comfort')
		expect(result.value.recommendedStyle)
			.toBe('balanced')
	})

	it('fit "tight" downgrades balanced -> budget', () => {
		// estimatedBaselineCost = 1500; ratio = 750 / 1500 = 0.5
		const runtime = createRuntime({ budget: 750, travelStyle: 'balanced' })
		const recommendation = widgetOfType(runtime, 'trip-recommendation', 'TripRecommendation')

		const result = recommendation.properties.result.get()
		expect(result.success)
			.toBe(true)
		if (!result.success)
			throw new Error('expected success')
		expect(result.value.fit)
			.toBe('tight')
		expect(result.value.recommendedStyle)
			.toBe('budget')
	})

	it('fit "tight" keeps budget as budget (no further downgrade)', () => {
		// estimatedBaselineCost = 150 × 0.75 × 2 × 5 = 1125; ratio = 500 / 1125 ≈ 0.444
		const runtime = createRuntime({ budget: 500, travelStyle: 'budget' })
		const recommendation = widgetOfType(runtime, 'trip-recommendation', 'TripRecommendation')

		const result = recommendation.properties.result.get()
		expect(result.success)
			.toBe(true)
		if (!result.success)
			throw new Error('expected success')
		expect(result.value.fit)
			.toBe('tight')
		expect(result.value.requestedStyle)
			.toBe('budget')
		expect(result.value.recommendedStyle)
			.toBe('budget')
	})

	it('derives family notes from children/familyPriority when ready', () => {
		const runtime = createRuntime({ budget: 1800, travelStyle: 'balanced', children: 2, familyPriority: 'easy-transit' })
		const recommendation = widgetOfType(runtime, 'trip-recommendation', 'TripRecommendation')

		const result = recommendation.properties.result.get()
		expect(result.success)
			.toBe(true)
		if (!result.success)
			throw new Error('expected success')
		expect(result.value.notes)
			.toEqual([
				'Traveling with 2 children.',
				'Prioritize easy-transit routes and short transfers.',
			])
	})

	it('produces no family notes when children is 0', () => {
		const runtime = createRuntime({ budget: 1800, travelStyle: 'balanced' })
		const recommendation = widgetOfType(runtime, 'trip-recommendation', 'TripRecommendation')

		const result = recommendation.properties.result.get()
		expect(result.success)
			.toBe(true)
		if (!result.success)
			throw new Error('expected success')
		expect(result.value.notes)
			.toEqual([])
	})
})
