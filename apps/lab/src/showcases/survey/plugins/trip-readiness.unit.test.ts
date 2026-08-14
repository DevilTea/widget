/**
 * `TripReadiness` locked C1 semantics (checkpoint C1): a semantically ready survey succeeds with
 * `true`; a not-ready survey fails as a `property-result` failure carrying contextual issues — the
 * successful-`false` branch is never produced by this plugin.
 */

import { describe, expect, it } from 'vitest'
import { surveySystem } from '../system'
import { widgetOfType } from '../test-support'

// "mars"/"lunar-base" are deliberately NOT part of the closed Destination/FamilyPriority domains
// (checkpoint §1's `Destination`/`FamilyPriority` literal unions) — they exist only so a source can be
// *edited* to configure a `SurveyChoiceQuestion` with an option outside that domain (checkpoint §2:
// primitive State validation only constrains an answer to whatever `options` the source itself
// declares), exercising the "edited-but-domain-invalid source" regression below.
const destinationOptions = [{ value: 'tokyo', label: 'Tokyo' }, { value: 'mars', label: 'Mars' }]
const travelStyleOptions = [{ value: 'balanced', label: 'Balanced' }]
const familyPriorityOptions = [{ value: 'easy-transit', label: 'Easy transit' }, { value: 'lunar-base', label: 'Lunar base' }]

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

	// PR #19 review 4940219714, finding 3: `SurveyChoiceQuestion`'s primitive State validation only
	// constrains an answer to whatever `options` the *source* itself declares (checkpoint §2) — it has
	// no notion of the closed `Destination`/`TravelStyle`/`FamilyPriority` domains. An edited source can
	// therefore legitimately set `destination` to an option value like `"mars"`, which is a perfectly
	// valid State value but not a real `Destination`. Readiness must not report `success(true)` for
	// that survey merely because every required field happens to be non-null.
	it('fails when destination is an edited-but-domain-invalid option value (e.g. "mars"), even though State accepts it', () => {
		const runtime = createRuntime({ destination: 'mars' })
		const destination = widgetOfType(runtime, 'destination', 'SurveyChoiceQuestion')
		// Confirms this is a genuinely accepted State value, not a rejected one — the point of the
		// regression is that "domain-invalid" and "State-invalid" are different things here.
		expect(destination.state.answer.get())
			.toBe('mars')

		const readiness = widgetOfType(runtime, 'trip-readiness', 'TripReadiness')
		const result = readiness.properties.ready.get()
		expect(result.success)
			.toBe(false)
		if (result.success)
			throw new Error('expected a failure')
		// Caused directly by TripReadiness's own `destination` refinement (a `property-dependency`
		// wrapping a rejected `.validate()` on a `state-get` dependency) — not merely a downstream
		// `TripMetrics.estimatedBaselineCost`/`tripDays` cascade.
		expect(result.issues.some((issue) => {
			const source = issue.source
			return source.type === 'property-dependency' && source.dependency.operation.type === 'state-get' && source.dependency.operation.key === 'answer'
		}))
			.toBe(true)
	})

	// PR #19 review 4940630249 (final blocker): checkpoint §3 locks "hiding does not mutate source
	// topology and does not reset the child ... TripReadiness simply stops requiring the hidden branch".
	// While `children === 0` the family section (and `family-priority`) is hidden, so TripReadiness must
	// not judge that answer at all — including rejecting a domain-invalid value left over in it. This is
	// the flip side of the "visible + domain-invalid" case below: hidden state is retained but inert.
	it('succeeds when children is 0 (family section hidden) even though family-priority holds a domain-invalid value', () => {
		const runtime = createRuntime({ 'family-priority': 'lunar-base' })
		const familyPriority = widgetOfType(runtime, 'family-priority', 'SurveyChoiceQuestion')
		// Confirms the hidden answer is genuinely retained (not reset/cleared) — the point of the
		// regression is that TripReadiness must stop requiring/judging it, not that it disappears.
		expect(familyPriority.state.answer.get())
			.toBe('lunar-base')

		const readiness = widgetOfType(runtime, 'trip-readiness', 'TripReadiness')
		expect(readiness.properties.ready.get())
			.toEqual({ success: true, value: true })
	})

	it('fails when children > 0 (family section visible) and family-priority holds a domain-invalid value', () => {
		const runtime = createRuntime({ 'children': 2, 'family-priority': 'lunar-base' })
		const readiness = widgetOfType(runtime, 'trip-readiness', 'TripReadiness')

		const result = readiness.properties.ready.get()
		expect(result.success)
			.toBe(false)
	})
})
