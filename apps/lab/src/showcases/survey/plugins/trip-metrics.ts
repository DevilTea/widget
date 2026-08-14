/**
 * `TripMetrics` (checkpoint §2): `config + properties`, the survey's derived-calculation hub. Every
 * Property is side-effect-free and reads other widgets' State/Properties exclusively through
 * `registerDeps` — never Vue `computed()` or renderer-local math (checkpoint §3).
 *
 * `tripDays` is also the showcase's cross-field Property validation demonstration (checkpoint §4.2):
 * calendar-valid individual dates with `return <= departure` add a Runtime Issue and fail as
 * `property-result`; `travelerCount`/`budgetPerPersonPerDay`/`estimatedBaselineCost` then read
 * `tripDays` as a Property→Property dependency, so a `tripDays` failure cascades into their own
 * `property-dependency` failures automatically (issue #10 §12) — this module never re-detects that
 * failure itself.
 */

import type { WidgetInterfaces } from '@deviltea/widget-core'
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
	.interfaces<TripMetricsInterfaces>()
	.config({
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
				compute: ({ deps, addIssue }) => {
					const departureResult = deps.departure()
					const returnResult = deps.returnDate()
					if (!departureResult.success || !returnResult.success)
						return 0

					const departure = departureResult.value
					const returnDate = returnResult.value
					if (departure === null || returnDate === null || !isValidCalendarDateString(departure) || !isValidCalendarDateString(returnDate)) {
						addIssue({ message: 'Departure and return dates are both required to compute trip days.' })
						return 0
					}

					const tripDays = computeTripDays(departure, returnDate)
					if (tripDays === null) {
						addIssue({ message: 'Return date must be strictly after the departure date.' })
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
				compute: ({ deps }) => {
					const adultsResult = deps.adults()
					const childrenResult = deps.children()
					const adults = adultsResult.success ? (adultsResult.value ?? 0) : 0
					const children = childrenResult.success ? (childrenResult.value ?? 0) : 0
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
				compute: ({ deps }) => {
					const budgetResult = deps.budget()
					const tripDaysResult = deps.tripDays()
					const travelerCountResult = deps.travelerCount()
					if (!budgetResult.success || !tripDaysResult.success || !travelerCountResult.success)
						return 0

					const budget = budgetResult.value ?? 0
					const tripDays = tripDaysResult.value ?? 0
					const travelerCount = travelerCountResult.value ?? 0
					if (tripDays <= 0 || travelerCount <= 0)
						return 0
					return budget / (travelerCount * tripDays)
				},
			})
			.estimatedBaselineCost({
				registerDeps: ({ dep, config }) => ({
					destination: dep.widget(config.destinationId).state.get('answer')
						.validate((value): value is string | null => value === null || isDestination(value)),
					travelStyle: dep.widget(config.travelStyleId).state.get('answer')
						.validate((value): value is string | null => value === null || isTravelStyle(value)),
					tripDays: dep.self.properties.get('tripDays'),
					travelerCount: dep.self.properties.get('travelerCount'),
				}),
				compute: ({ deps }) => {
					const destinationResult = deps.destination()
					const travelStyleResult = deps.travelStyle()
					const tripDaysResult = deps.tripDays()
					const travelerCountResult = deps.travelerCount()
					if (!destinationResult.success || !travelStyleResult.success || !tripDaysResult.success || !travelerCountResult.success)
						return 0

					const destination = destinationResult.value
					const travelStyle = travelStyleResult.value
					if (destination === null || travelStyle === null || !isDestination(destination) || !isTravelStyle(travelStyle))
						return 0

					const tripDays = tripDaysResult.value ?? 0
					const travelerCount = travelerCountResult.value ?? 0
					return estimateBaselineCost(destination, travelStyle, travelerCount, tripDays)
				},
			}))
	.done()
