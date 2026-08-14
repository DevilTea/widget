/**
 * `TripReadiness` (checkpoint §2) — `config + properties`.
 *
 * Locked failure semantics (checkpoint C1): `ready` is not a normal `true | false` status value. A
 * semantically ready survey completes successfully with `true`; a not-ready survey calls
 * `ctx.addIssue(...)` for every missing/contextually-invalid answer, so the Property completes as a
 * `property-result` failure carrying those issues. The successful-`false` branch is never used — the
 * returned literal `true` at the end of `compute` is only ever observed on the success path; on
 * failure it is discarded (issue #10 §12: failure exposes no usable value).
 *
 * `tripDays` is read from `TripMetrics` as a Property→Property dependency purely to fold "derived
 * metric validity" into readiness (checkpoint §1). Its own failure (invalid date ordering) is not
 * re-reported here with a second `addIssue` — core's dependency propagation already inserts a
 * `property-dependency` Issue into this Property's own collector automatically the moment the failing
 * dependency is read (issue #10 §12), which is exactly the "derived metric validity" signal.
 */

import type { WidgetInterfaces } from '@deviltea/widget-core'
import { createWidgetPlugin } from '@deviltea/widget-core'
import { isPlainObject } from '../domain'

export interface TripReadinessConfig {
	readonly departureId: string
	readonly returnId: string
	readonly adultsId: string
	readonly childrenId: string
	readonly budgetId: string
	readonly destinationId: string
	readonly travelStyleId: string
	readonly familyPriorityId: string
	readonly metricsId: string
}

export interface TripReadinessInterfaces extends WidgetInterfaces {
	config: {
		raw: TripReadinessConfig
		resolved: TripReadinessConfig
	}
	properties: {
		ready: boolean
	}
}

const CONFIG_ID_KEYS = [
	'departureId',
	'returnId',
	'adultsId',
	'childrenId',
	'budgetId',
	'destinationId',
	'travelStyleId',
	'familyPriorityId',
	'metricsId',
] as const

function isTripReadinessConfig(input: unknown): input is TripReadinessConfig {
	return isPlainObject(input) && CONFIG_ID_KEYS.every(key => typeof input[key] === 'string')
}

export const TripReadinessPlugin = createWidgetPlugin('TripReadiness')
	.interfaces<TripReadinessInterfaces>()
	.config({
		validate: (input): input is TripReadinessConfig => isTripReadinessConfig(input),
		resolve: raw => ({
			departureId: raw?.departureId ?? '',
			returnId: raw?.returnId ?? '',
			adultsId: raw?.adultsId ?? '',
			childrenId: raw?.childrenId ?? '',
			budgetId: raw?.budgetId ?? '',
			destinationId: raw?.destinationId ?? '',
			travelStyleId: raw?.travelStyleId ?? '',
			familyPriorityId: raw?.familyPriorityId ?? '',
			metricsId: raw?.metricsId ?? '',
		}),
	})
	.properties(properties =>
		properties.ready({
			registerDeps: ({ dep, config }) => ({
				departure: dep.widget(config.departureId).state.get('answer'),
				returnDate: dep.widget(config.returnId).state.get('answer'),
				adults: dep.widget(config.adultsId).state.get('answer'),
				children: dep.widget(config.childrenId).state.get('answer'),
				budget: dep.widget(config.budgetId).state.get('answer'),
				destination: dep.widget(config.destinationId).state.get('answer'),
				travelStyle: dep.widget(config.travelStyleId).state.get('answer'),
				familyPriority: dep.widget(config.familyPriorityId).state.get('answer'),
				tripDays: dep.widget(config.metricsId).properties.get('tripDays'),
			}),
			compute: ({ deps, addIssue }) => {
				const departure = deps.departure()
				const returnDate = deps.returnDate()
				const adults = deps.adults()
				const children = deps.children()
				const budget = deps.budget()
				const destination = deps.destination()
				const travelStyle = deps.travelStyle()
				const familyPriority = deps.familyPriority()
				// Read (but do not re-report): a `TripMetrics.tripDays` failure automatically becomes a
				// `property-dependency` Issue on this Property via core's dependency propagation.
				deps.tripDays()

				if (!departure.success || departure.value === null)
					addIssue({ message: 'Departure date is required.' })
				if (!returnDate.success || returnDate.value === null)
					addIssue({ message: 'Return date is required.' })
				if (!adults.success || adults.value === null)
					addIssue({ message: 'Number of adults is required.' })
				if (!children.success || children.value === null)
					addIssue({ message: 'Number of children is required.' })
				if (!budget.success || budget.value === null)
					addIssue({ message: 'Trip budget is required.' })
				if (!destination.success || destination.value === null)
					addIssue({ message: 'Destination is required.' })
				if (!travelStyle.success || travelStyle.value === null)
					addIssue({ message: 'Travel style is required.' })

				const childrenCount = children.success && typeof children.value === 'number' ? children.value : 0
				if (childrenCount > 0 && (!familyPriority.success || familyPriority.value === null))
					addIssue({ message: 'Family priority is required when traveling with children.' })

				// Only ever observed on the success path (checkpoint C1); a not-ready survey's failure is
				// carried entirely by the `addIssue(...)` calls above.
				return true
			},
		}))
	.done()
