/**
 * `TripReadiness` (checkpoint §2) — `config + properties`.
 *
 * Locked failure semantics (checkpoint C1): `ready` is not a normal `true | false` status value. A
 * semantically ready survey completes successfully with `true`; a not-ready survey calls
 * `ctx.addDiagnostic(...)` for every missing/contextually-invalid answer, so the Property completes as a
 * `property-result` failure carrying those diagnostics. The successful-`false` branch is never used — the
 * returned literal `true` at the end of `compute` is only ever observed on the ok path; on
 * failure it is discarded (diagnostic #10 §12: failure exposes no usable value).
 *
 * `tripDays` is read from `TripMetrics` as a Property→Property dependency purely to fold "derived
 * metric validity" into readiness (checkpoint §1). Its own failure (invalid date ordering) is not
 * re-reported here with a second `addDiagnostic` — core's dependency propagation already inserts a
 * `property-dependency` Diagnostic into this Property's own collector automatically the moment the failing
 * dependency is read (diagnostic #10 §12), which is exactly the "derived metric validity" signal.
 *
 * `destination`/`travelStyle`/`familyPriority` are read through `dep.widget(...).state.get('answer')`
 * `.validate()` refinements to their closed domain literals (`isDestination`/`isTravelStyle`/
 * `isFamilyPriority`), not just a bare non-null check: Source is editable, and `SurveyChoiceQuestion`'s
 * own primitive State validation only constrains an answer to whatever `options` the *source* declares
 * for that widget (checkpoint §2) — it has no notion of the closed `Destination`/`TravelStyle`/
 * `FamilyPriority` domains. An edited-but-domain-invalid source (e.g. a `destination` option/default of
 * `"mars"`) is therefore a perfectly valid *State* value that must still make `ready` fail: a refinement
 * rejection here fails this Property automatically via the same core dependency propagation as the
 * `tripDays` case above (no manual `addDiagnostic` needed), so `ok(true)` continues to mean the survey
 * is genuinely semantically ready — required answers *and* derived metric/domain validity — never just
 * "every required field happens to be non-null" (checkpoint §1 "required answers + conditional family
 * requirement + derived metric validity → readiness").
 *
 * `familyPriority` is declared as an unconditional dependency edge (the *static* Blueprint dependency
 * graph never changes based on runtime state), but `deps.familyPriority()` — the callable that actually
 * performs the read and runs its `.validate()` refinement — is only ever *invoked* when
 * `childrenCount > 0`. This is deliberate and locked (checkpoint §3 "hiding does not mutate source
 * topology and does not reset the child ... `TripReadiness` simply stops requiring the hidden branch"):
 * when the family section is hidden (`children === 0`), `TripReadiness` must not require *or judge* that
 * answer at all, so an edited-but-domain-invalid value left over in a hidden `family-priority` must never
 * affect `ready`. Reading it unconditionally (as this Property used to) would run the refinement
 * regardless of `children`, failing `ready` even while the field is hidden and unrequired — invoking the
 * dependency read only inside the `childrenCount > 0` branch in `compute` is what keeps a hidden domain-
 * invalid value inert while still failing readiness the moment that branch becomes visible.
 */

import type { WidgetInterfaces } from '@deviltea/widget-core'
import { createWidgetPlugin } from '@deviltea/widget-core'
import { isDestination, isFamilyPriority, isPlainObject, isTravelStyle } from '../domain'

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
	.description('Trip readiness widget')
	.interfaces<TripReadinessInterfaces>()
	.config({
		description: 'Trip readiness configuration',
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
				destination: dep.widget(config.destinationId).state.get('answer')
					.validate((value): value is string | null => value === null || isDestination(value)),
				travelStyle: dep.widget(config.travelStyleId).state.get('answer')
					.validate((value): value is string | null => value === null || isTravelStyle(value)),
				familyPriority: dep.widget(config.familyPriorityId).state.get('answer')
					.validate((value): value is string | null => value === null || isFamilyPriority(value)),
				tripDays: dep.widget(config.metricsId).properties.get('tripDays'),
			}),
			compute: ({ deps, addDiagnostic }) => {
				const departure = deps.departure()
				const returnDate = deps.returnDate()
				const adults = deps.adults()
				const children = deps.children()
				const budget = deps.budget()
				const destination = deps.destination()
				const travelStyle = deps.travelStyle()
				// Read (but do not re-report): a `TripMetrics.tripDays` failure automatically becomes a
				// `property-dependency` Diagnostic on this Property via core's dependency propagation.
				deps.tripDays()

				if (!departure.ok || departure.value === null)
					addDiagnostic({ message: 'Departure date is required.' })
				if (!returnDate.ok || returnDate.value === null)
					addDiagnostic({ message: 'Return date is required.' })
				if (!adults.ok || adults.value === null)
					addDiagnostic({ message: 'Number of adults is required.' })
				if (!children.ok || children.value === null)
					addDiagnostic({ message: 'Number of children is required.' })
				if (!budget.ok || budget.value === null)
					addDiagnostic({ message: 'Trip budget is required.' })
				if (!destination.ok || destination.value === null)
					addDiagnostic({ message: 'Destination is required.' })
				if (!travelStyle.ok || travelStyle.value === null)
					addDiagnostic({ message: 'Travel style is required.' })

				const childrenCount = children.ok && typeof children.value === 'number' ? children.value : 0
				// `deps.familyPriority()` is intentionally only invoked in this branch — see the file
				// header. When the family section is hidden (`childrenCount === 0`), this Property must
				// never read (and so never judge, via the dependency's own `.validate()` refinement) the
				// hidden `family-priority` answer at all.
				if (childrenCount > 0) {
					const familyPriority = deps.familyPriority()
					if (!familyPriority.ok || familyPriority.value === null)
						addDiagnostic({ message: 'Family priority is required when traveling with children.' })
				}

				// Only ever observed on the ok path (checkpoint C1); a not-ready survey's failure is
				// carried entirely by the `addDiagnostic(...)` calls above.
				return true
			},
		}))
	.done()
