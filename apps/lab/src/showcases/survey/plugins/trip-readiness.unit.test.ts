/**
 * `TripReadiness` locked C1 semantics (checkpoint C1): a semantically ready survey succeeds with
 * `true`; a not-ready survey fails as a `property-result` failure carrying contextual issues — the
 * successful-`false` branch is never produced by this plugin.
 */

import { describe, expect, it } from 'vitest'
import { surveySystem } from '../system'
import { widgetOfType } from '../test-support'

const destinationOptions = [{ value: 'tokyo', label: 'Tokyo' }]
const travelStyleOptions = [{ value: 'balanced', label: 'Balanced' }]
const familyPriorityOptions = [{ value: 'easy-transit', label: 'Easy transit' }]

function definitionWithDefaults(overrides: Record<string, unknown> = {}) {
	const defaults: Record<string, unknown> = {
		'departure': '2027-04-10',
		'return': '2027-04-14',
		'adults': 2,
		'children': 0,
		'budget': 1800,
		'destination': 'tokyo',
		'travel-style': 'balanced',
		'family-priority': null,
		...overrides,
	}

	return {
		id: 'root',
		type: 'SurveySection',
		config: { title: 'Root' },
		slots: {
			body: [
				{ id: 'departure', type: 'SurveyDateQuestion', config: { label: 'Departure', default: defaults.departure } },
				{ id: 'return', type: 'SurveyDateQuestion', config: { label: 'Return', default: defaults.return } },
				{ id: 'adults', type: 'SurveyNumberQuestion', config: { label: 'Adults', default: defaults.adults } },
				{ id: 'children', type: 'SurveyNumberQuestion', config: { label: 'Children', default: defaults.children } },
				{ id: 'budget', type: 'SurveyNumberQuestion', config: { label: 'Budget', default: defaults.budget } },
				{ id: 'destination', type: 'SurveyChoiceQuestion', config: { label: 'Destination', options: destinationOptions, default: defaults.destination } },
				{ id: 'travel-style', type: 'SurveyChoiceQuestion', config: { label: 'Travel style', options: travelStyleOptions, default: defaults['travel-style'] } },
				{ id: 'family-priority', type: 'SurveyChoiceQuestion', config: { label: 'Family priority', options: familyPriorityOptions, default: defaults['family-priority'] } },
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
			],
		},
	}
}

function createRuntime(overrides: Record<string, unknown> = {}) {
	const blueprint = surveySystem.createBlueprint(definitionWithDefaults(overrides))
	if (blueprint.status !== 'valid')
		throw new Error(`Expected a valid Blueprint, got issues: ${JSON.stringify(blueprint.getCollectedIssues())}`)
	return blueprint.createRuntime()
}

describe('tripReadiness.ready (C1)', () => {
	it('succeeds with true when every required answer is present and children is 0', () => {
		const runtime = createRuntime()
		const readiness = widgetOfType(runtime, 'trip-readiness', 'TripReadiness')

		expect(readiness.properties.ready.get())
			.toEqual({ success: true, value: true })
	})

	it('fails with a contextual issue when a required answer is missing', () => {
		const runtime = createRuntime()
		const destination = widgetOfType(runtime, 'destination', 'SurveyChoiceQuestion')
		destination.state.answer.set(null)

		const readiness = widgetOfType(runtime, 'trip-readiness', 'TripReadiness')
		const result = readiness.properties.ready.get()
		expect(result.success)
			.toBe(false)
		if (result.success)
			throw new Error('expected a failure')
		expect(result.issues.some(issue => issue.message.includes('Destination')))
			.toBe(true)
	})

	it('fails when children > 0 and family-priority is null (never a successful false)', () => {
		const runtime = createRuntime({ children: 2 })
		const readiness = widgetOfType(runtime, 'trip-readiness', 'TripReadiness')

		const result = readiness.properties.ready.get()
		expect(result.success)
			.toBe(false)
		if (result.success)
			throw new Error('expected a failure')
		expect(result.issues.some(issue => issue.message.includes('Family priority')))
			.toBe(true)
	})

	it('succeeds when children > 0 and family-priority is answered', () => {
		const runtime = createRuntime({ 'children': 2, 'family-priority': 'easy-transit' })
		const readiness = widgetOfType(runtime, 'trip-readiness', 'TripReadiness')

		expect(readiness.properties.ready.get())
			.toEqual({ success: true, value: true })
	})

	it('fails via automatic property-dependency propagation when TripMetrics.tripDays itself fails', () => {
		const runtime = createRuntime()
		const returnQuestion = widgetOfType(runtime, 'return', 'SurveyDateQuestion')
		returnQuestion.state.answer.set('2027-04-01') // before departure

		const readiness = widgetOfType(runtime, 'trip-readiness', 'TripReadiness')
		const result = readiness.properties.ready.get()
		expect(result.success)
			.toBe(false)
		if (result.success)
			throw new Error('expected a failure')
		expect(result.issues.some(issue => issue.source.type === 'property-dependency'))
			.toBe(true)
	})
})
