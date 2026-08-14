/**
 * `TripRecommendation` (checkpoint §2) — `config + properties`.
 *
 * Locked dependency-failure semantics (checkpoint C2): `result` reads `TripReadiness.ready` first. If
 * readiness is a `property-result` failure, core's dependency propagation (issue #10 §12) makes
 * `result` fail with the corresponding `property-dependency` failure the instant `deps.ready()` is
 * called — this Property must not go on to compute and return a fallback/partial recommendation for a
 * not-ready survey. `compute` therefore returns an inert dummy value immediately after observing
 * `!readyResult.success`; that value is never observed by any consumer (failure exposes no usable
 * value), it only satisfies the declared `TripRecommendationResult` return type.
 *
 * Recommendation logic (fit thresholds, style downgrade table, family notes) is the deterministic,
 * Lab-private model locked in checkpoint §2.
 */

import type { WidgetInterfaces } from '@deviltea/widget-core'
import type { TravelStyle, TripFit, TripRecommendationResult } from '../domain'
import { createWidgetPlugin } from '@deviltea/widget-core'
import { isDestination, isFamilyPriority, isPlainObject, isTravelStyle } from '../domain'

export interface TripRecommendationConfig {
	readonly readinessId: string
	readonly metricsId: string
	readonly budgetId: string
	readonly destinationId: string
	readonly travelStyleId: string
	readonly childrenId: string
	readonly familyPriorityId: string
}

export interface TripRecommendationInterfaces extends WidgetInterfaces {
	config: {
		raw: TripRecommendationConfig
		resolved: TripRecommendationConfig
	}
	properties: {
		result: TripRecommendationResult
	}
}

const CONFIG_ID_KEYS = ['readinessId', 'metricsId', 'budgetId', 'destinationId', 'travelStyleId', 'childrenId', 'familyPriorityId'] as const

function isTripRecommendationConfig(input: unknown): input is TripRecommendationConfig {
	return isPlainObject(input) && CONFIG_ID_KEYS.every(key => typeof input[key] === 'string')
}

function isNumber(value: unknown): value is number {
	return typeof value === 'number'
}

/** An inert placeholder — only ever returned on a failure path, where no consumer observes it. */
const DUMMY_RESULT: TripRecommendationResult = {
	destination: 'tokyo',
	requestedStyle: 'balanced',
	recommendedStyle: 'balanced',
	fit: 'tight',
	tripDays: 0,
	travelers: 0,
	budget: 0,
	estimatedBaselineCost: 0,
	budgetGap: 0,
	budgetPerPersonPerDay: 0,
	notes: [],
}

function recommendedStyleFor(requestedStyle: TravelStyle, fit: TripFit): TravelStyle {
	if (fit !== 'tight')
		return requestedStyle
	if (requestedStyle === 'comfort')
		return 'balanced'
	if (requestedStyle === 'balanced')
		return 'budget'
	return 'budget'
}

function familyNotes(children: number, familyPriority: string | null): readonly string[] {
	if (children <= 0)
		return []

	const notes: string[] = [`Traveling with ${children} ${children === 1 ? 'child' : 'children'}.`]
	if (isFamilyPriority(familyPriority)) {
		switch (familyPriority) {
			case 'easy-transit':
				notes.push('Prioritize easy-transit routes and short transfers.')
				break
			case 'kid-friendly':
				notes.push('Prioritize kid-friendly activities and dining.')
				break
			case 'relaxed-pace':
				notes.push('Keep a relaxed daily pace with buffer time.')
				break
		}
	}
	return notes
}

export const TripRecommendationPlugin = createWidgetPlugin('TripRecommendation')
	.interfaces<TripRecommendationInterfaces>()
	.config({
		validate: (input): input is TripRecommendationConfig => isTripRecommendationConfig(input),
		resolve: raw => ({
			readinessId: raw?.readinessId ?? '',
			metricsId: raw?.metricsId ?? '',
			budgetId: raw?.budgetId ?? '',
			destinationId: raw?.destinationId ?? '',
			travelStyleId: raw?.travelStyleId ?? '',
			childrenId: raw?.childrenId ?? '',
			familyPriorityId: raw?.familyPriorityId ?? '',
		}),
	})
	.properties(properties =>
		properties.result({
			registerDeps: ({ dep, config }) => ({
				ready: dep.widget(config.readinessId).properties.get('ready')
					.validate((value): value is boolean => typeof value === 'boolean'),
				tripDays: dep.widget(config.metricsId).properties.get('tripDays')
					.validate(isNumber),
				travelerCount: dep.widget(config.metricsId).properties.get('travelerCount')
					.validate(isNumber),
				budgetPerPersonPerDay: dep.widget(config.metricsId).properties.get('budgetPerPersonPerDay')
					.validate(isNumber),
				estimatedBaselineCost: dep.widget(config.metricsId).properties.get('estimatedBaselineCost')
					.validate(isNumber),
				budget: dep.widget(config.budgetId).state.get('answer')
					.validate(isNumber),
				destination: dep.widget(config.destinationId).state.get('answer')
					.validate(isDestination),
				travelStyle: dep.widget(config.travelStyleId).state.get('answer')
					.validate(isTravelStyle),
				children: dep.widget(config.childrenId).state.get('answer')
					.validate(isNumber),
				familyPriority: dep.widget(config.familyPriorityId).state.get('answer'),
			}),
			compute: ({ deps }) => {
				const readyResult = deps.ready()
				if (!readyResult.success)
					return DUMMY_RESULT

				const tripDaysResult = deps.tripDays()
				const travelerCountResult = deps.travelerCount()
				const budgetPerPersonPerDayResult = deps.budgetPerPersonPerDay()
				const estimatedBaselineCostResult = deps.estimatedBaselineCost()
				const budgetResult = deps.budget()
				const destinationResult = deps.destination()
				const travelStyleResult = deps.travelStyle()
				const childrenResult = deps.children()
				if (
					!tripDaysResult.success
					|| !travelerCountResult.success
					|| !budgetPerPersonPerDayResult.success
					|| !estimatedBaselineCostResult.success
					|| !budgetResult.success
					|| !destinationResult.success
					|| !travelStyleResult.success
					|| !childrenResult.success
				) {
					return DUMMY_RESULT
				}

				const familyPriorityResult = deps.familyPriority()
				const familyPriority = familyPriorityResult.success && typeof familyPriorityResult.value === 'string' ? familyPriorityResult.value : null

				const budget = budgetResult.value
				const estimatedBaselineCost = estimatedBaselineCostResult.value
				const requestedStyle = travelStyleResult.value
				const ratio = estimatedBaselineCost > 0 ? budget / estimatedBaselineCost : 0
				const fit: TripFit = ratio >= 1.20 ? 'comfortable' : ratio >= 0.95 ? 'workable' : 'tight'
				const recommendedStyle = recommendedStyleFor(requestedStyle, fit)
				const children = childrenResult.value

				const result: TripRecommendationResult = {
					destination: destinationResult.value,
					requestedStyle,
					recommendedStyle,
					fit,
					tripDays: tripDaysResult.value,
					travelers: travelerCountResult.value,
					budget,
					estimatedBaselineCost,
					budgetGap: budget - estimatedBaselineCost,
					budgetPerPersonPerDay: budgetPerPersonPerDayResult.value,
					notes: familyNotes(children, familyPriority),
				}
				return result
			},
		}))
	.done()
