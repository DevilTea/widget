/**
 * `TripMetrics` (checkpoint §2): `config + properties`, the survey's derived-calculation hub. Every
 * Property is side-effect-free and reads other widgets' State/Properties exclusively through
 * `registerDeps` — never Vue `computed()` or renderer-local math (checkpoint §3).
 *
 * `tripDays` is also the showcase's cross-field Property validation demonstration (checkpoint §4.2):
 * calendar-valid individual dates with `return <= departure` add a Runtime Diagnostic and fail as
 * `property-result`; `travelerCount`/`budgetPerPersonPerDay`/`estimatedBaselineCost` then read
 * `tripDays` as a Property→Property dependency, so a `tripDays` failure cascades into their own
 * `property-dependency` failures automatically (diagnostic #10 §12) — this module never re-detects that
 * failure itself.
 *
 * Diagnostic #26 Finding 2 (GPT adversarial review round 1): every Property here must fail — via `addDiagnostic`,
 * never a silent `?? 0` fallback — whenever a genuinely missing (`null`) nullable answer is a real
 * prerequisite for its computation. `adults`/`children`/`budget` are cleared to `null` by
 * `SurveyNumberQuestion`'s own "empty input" State; `destination`/`travel-style` are cleared to `null`
 * by `SurveyChoiceQuestion`'s "— select —" option (`../renderers/SurveyChoiceQuestionRenderer.vue`) — so
 * every one of these `null`s is a real, user-reachable Preview state, not a defensive-only case. Treating
 * a missing prerequisite as `0` used to make the derived metric look like a legitimate reading of "zero"
 * rather than "unknown/unavailable," which is exactly the fabricated-value defect diagnostic #26 exists to
 * fix — the earlier revision only fixed this for `tripDays`'s own date-ordering failure and the
 * dependency-propagated failures it cascades into, leaving these other nullable leaf reads unfixed.
 * `useProperties()` projects any failed Property to `null` regardless of why it failed, so
 * `TripMetricsRenderer.vue` needs no renderer-side distinction between "a dependency failed" and "a
 * direct nullable answer is missing" — both already render as `'Unavailable'`.
 */

import type { WidgetInterfaces } from '@deviltea/widget-core'
import type { Destination, TravelStyle } from '../domain'
import { createWidgetPlugin } from '@deviltea/widget-core'
import { computeTripDays, estimateBaselineCost, isDestination, isPlainObject, isTravelStyle, isValidCalendarDateString } from '../domain'

export interface TripMetricsConfig {
	readonly departureId: string
	readonly returnId: string
	readonly adultsId: string
	readonly childrenId: string
	readonly budgetId: string
	readonly destinationId: string
	readonly travelStyleId: string
}

export interface TripMetricsInterfaces extends WidgetInterfaces {
	config: {
		raw: TripMetricsConfig
		resolved: TripMetricsConfig
	}
	properties: {
		tripDays: number
		travelerCount: number
		budgetPerPersonPerDay: number
		estimatedBaselineCost: number
	}
}

const CONFIG_ID_KEYS = ['departureId', 'returnId', 'adultsId', 'childrenId', 'budgetId', 'destinationId', 'travelStyleId'] as const

function isTripMetricsConfig(input: unknown): input is TripMetricsConfig {
	return isPlainObject(input) && CONFIG_ID_KEYS.every(key => typeof input[key] === 'string')
}

function isNullableString(value: unknown): value is string | null {
	return value === null || typeof value === 'string'
}

function isNullableNumber(value: unknown): value is number | null {
	return value === null || typeof value === 'number'
}

export const TripMetricsPlugin = createWidgetPlugin('TripMetrics')
	.description('Trip metrics widget')
	.interfaces<TripMetricsInterfaces>()
	.config({
		description: 'Trip metrics configuration',
		validate: (input): input is TripMetricsConfig => isTripMetricsConfig(input),
		resolve: raw => ({
			departureId: raw?.departureId ?? '',
			returnId: raw?.returnId ?? '',
			adultsId: raw?.adultsId ?? '',
			childrenId: raw?.childrenId ?? '',
			budgetId: raw?.budgetId ?? '',
			destinationId: raw?.destinationId ?? '',
			travelStyleId: raw?.travelStyleId ?? '',
		}),
	})
	.properties(properties =>
		properties
			.tripDays({
				registerDeps: ({ dep, config }) => ({
					departure: dep.widget(config.departureId).state.get('answer')
						.validate(isNullableString),
					returnDate: dep.widget(config.returnId).state.get('answer')
						.validate(isNullableString),
				}),
				compute: ({ deps, addDiagnostic }) => {
					const departureResult = deps.departure()
					const returnResult = deps.returnDate()
					if (!departureResult.ok || !returnResult.ok)
						return 0

					const departure = departureResult.value
					const returnDate = returnResult.value
					if (departure === null || returnDate === null || !isValidCalendarDateString(departure) || !isValidCalendarDateString(returnDate)) {
						addDiagnostic({ message: 'Departure and return dates are both required to compute trip days.' })
						return 0
					}

					const tripDays = computeTripDays(departure, returnDate)
					if (tripDays === null) {
						addDiagnostic({ message: 'Return date must be strictly after the departure date.' })
						return 0
					}
					return tripDays
				},
			})
			.travelerCount({
				registerDeps: ({ dep, config }) => ({
					adults: dep.widget(config.adultsId).state.get('answer')
						.validate(isNullableNumber),
					children: dep.widget(config.childrenId).state.get('answer')
						.validate(isNullableNumber),
				}),
				compute: ({ deps, addDiagnostic }) => {
					const adultsResult = deps.adults()
					const childrenResult = deps.children()
					if (!adultsResult.ok || !childrenResult.ok)
						return 0

					const adults = adultsResult.value
					const children = childrenResult.value
					// `null` is a genuinely missing answer (a cleared number input), not a "zero travelers"
					// reading — fail rather than silently treat it as 0 (diagnostic #26 Finding 2).
					if (adults === null || children === null) {
						addDiagnostic({ message: 'Number of adults and number of children are both required to compute the traveler count.' })
						return 0
					}

					return adults + children
				},
			})
			.budgetPerPersonPerDay({
				registerDeps: ({ dep, config }) => ({
					budget: dep.widget(config.budgetId).state.get('answer')
						.validate(isNullableNumber),
					tripDays: dep.self.properties.get('tripDays'),
					travelerCount: dep.self.properties.get('travelerCount'),
				}),
				compute: ({ deps, addDiagnostic }) => {
					const budgetResult = deps.budget()
					// A `tripDays`/`travelerCount` failure already reports its own `property-dependency`
					// diagnostic on this Property automatically the moment it is read (diagnostic #10 §12) — this
					// module never re-detects that failure itself.
					const tripDaysResult = deps.tripDays()
					const travelerCountResult = deps.travelerCount()
					if (!budgetResult.ok || !tripDaysResult.ok || !travelerCountResult.ok)
						return 0

					const budget = budgetResult.value
					// `null` is a genuinely missing answer (a cleared budget input) — fail rather than
					// silently treat it as 0 (diagnostic #26 Finding 2).
					if (budget === null) {
						addDiagnostic({ message: 'Trip budget is required to compute budget per person per day.' })
						return 0
					}

					// `dep.self.properties.get(...)` types its value as possibly `null` unconditionally (a
					// framework-typing artifact of self-reads, not a real outcome here): `tripDays`/
					// `travelerCount` are declared `number` — never `number | null` — in their own
					// interfaces, and neither Property's own `compute` ever returns `null` on ok, so
					// `?? 0` below can never actually substitute a value; it only satisfies the type
					// checker for a branch that cannot be reached at runtime.
					const tripDays = tripDaysResult.value ?? 0
					const travelerCount = travelerCountResult.value ?? 0
					// `tripDays` never legitimately succeeds at <= 0 (its own `compute` fails whenever
					// `return` is not strictly after `departure`), but `travelerCount` can legitimately
					// succeed at exactly 0 under a config that allows a 0-adults answer — dividing by zero
					// travelers/days is not a valid "0" reading either, so fail rather than fabricate one
					// (diagnostic #26 Finding 2).
					if (tripDays <= 0 || travelerCount <= 0) {
						addDiagnostic({ message: 'Trip days and traveler count must both be greater than zero to compute budget per person per day.' })
						return 0
					}
					return budget / (travelerCount * tripDays)
				},
			})
			.estimatedBaselineCost({
				registerDeps: ({ dep, config }) => ({
					destination: dep.widget(config.destinationId).state.get('answer')
						.validate((value): value is Destination | null => value === null || isDestination(value)),
					travelStyle: dep.widget(config.travelStyleId).state.get('answer')
						.validate((value): value is TravelStyle | null => value === null || isTravelStyle(value)),
					tripDays: dep.self.properties.get('tripDays'),
					travelerCount: dep.self.properties.get('travelerCount'),
				}),
				compute: ({ deps, addDiagnostic }) => {
					const destinationResult = deps.destination()
					const travelStyleResult = deps.travelStyle()
					// A `tripDays`/`travelerCount` failure already reports its own `property-dependency`
					// diagnostic on this Property automatically the moment it is read (diagnostic #10 §12) — this
					// module never re-detects that failure itself.
					const tripDaysResult = deps.tripDays()
					const travelerCountResult = deps.travelerCount()
					if (!destinationResult.ok || !travelStyleResult.ok || !tripDaysResult.ok || !travelerCountResult.ok)
						return 0

					// `.validate()` above already only lets `null` or a genuine `Destination`/`TravelStyle`
					// through, so `null` here is the one remaining case: a cleared/unselected choice
					// ("— select —") — a genuinely missing answer, not a "zero-cost" reading.
					const destination = destinationResult.value
					const travelStyle = travelStyleResult.value
					if (destination === null || travelStyle === null) {
						addDiagnostic({ message: 'Destination and travel style are both required to estimate the baseline cost.' })
						return 0
					}

					// See `budgetPerPersonPerDay`'s comment: `?? 0` here only satisfies the type checker
					// for a self-read branch that cannot actually occur (`tripDays`/`travelerCount` never
					// return `null` on ok) — a 0-traveler/0-day estimate is itself a legitimate `0`
					// (multiplication, not division), so no additional failure guard is needed here.
					return estimateBaselineCost(destination, travelStyle, travelerCountResult.value ?? 0, tripDaysResult.value ?? 0)
				},
			}))
	.done()
