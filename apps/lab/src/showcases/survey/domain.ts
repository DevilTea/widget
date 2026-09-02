/**
 * Showcase A ("Interactive Survey") domain model.
 *
 * Normative source: GitHub diagnostic #13 comment "Checkpoint — Showcase A: Interactive Survey (ACCEPTED)".
 * A deterministic, offline, single-destination leisure city-trip planning survey — a bounded semantic
 * demonstration, not a real travel-booking/recommendation service. Every constant here is a synthetic
 * Lab-private fixture; there is no network/API/pricing lookup. All domain calculation/validation lives
 * in the plugin semantics under `./plugins/`, never in Vue renderer glue (`./renderers/`).
 */

export type Destination = 'tokyo' | 'seoul' | 'bangkok'
export type TravelStyle = 'budget' | 'balanced' | 'comfort'
export type FamilyPriority = 'easy-transit' | 'kid-friendly' | 'relaxed-pace'

export const destinationValues: readonly Destination[] = ['tokyo', 'seoul', 'bangkok']
export const travelStyleValues: readonly TravelStyle[] = ['budget', 'balanced', 'comfort']
export const familyPriorityValues: readonly FamilyPriority[] = ['easy-transit', 'kid-friendly', 'relaxed-pace']

export function isDestination(value: unknown): value is Destination {
	return typeof value === 'string' && (destinationValues as readonly string[]).includes(value)
}

export function isTravelStyle(value: unknown): value is TravelStyle {
	return typeof value === 'string' && (travelStyleValues as readonly string[]).includes(value)
}

export function isFamilyPriority(value: unknown): value is FamilyPriority {
	return typeof value === 'string' && (familyPriorityValues as readonly string[]).includes(value)
}

/** Synthetic, illustrative-only daily cost fixture (Lab-private; not real travel pricing). */
export const dailyCost: Readonly<Record<Destination, number>> = {
	tokyo: 150,
	seoul: 125,
	bangkok: 90,
}

/** Synthetic, illustrative-only travel-style cost multiplier fixture. */
export const styleMultiplier: Readonly<Record<TravelStyle, number>> = {
	budget: 0.75,
	balanced: 1,
	comfort: 1.4,
}

/**
 * `estimatedBaselineCost = dailyCost[destination] × styleMultiplier[travelStyle] × travelerCount × tripDays`
 * (checkpoint §1). Kept as one named helper so `TripMetrics` never duplicates the formula.
 */
export function estimateBaselineCost(destination: Destination, travelStyle: TravelStyle, travelerCount: number, tripDays: number): number {
	return dailyCost[destination] * styleMultiplier[travelStyle] * travelerCount * tripDays
}

export type TripFit = 'comfortable' | 'workable' | 'tight'

export interface TripRecommendationResult {
	readonly destination: Destination
	readonly requestedStyle: TravelStyle
	readonly recommendedStyle: TravelStyle
	readonly fit: TripFit
	readonly tripDays: number
	readonly travelers: number
	readonly budget: number
	readonly estimatedBaselineCost: number
	readonly budgetGap: number
	readonly budgetPerPersonPerDay: number
	readonly notes: readonly string[]
}

/**
 * Structural runtime type guard for `TripRecommendationResult` — used by `TripSurvey.generateResult`'s
 * dependency `.validate()` refinement when reading `TripRecommendation.result` (an unknown-typed
 * cross-widget Property read; see `dep.widget(id)` in `@deviltea/widget-core`'s dependency grammar).
 */
export function isTripRecommendationResult(value: unknown): value is TripRecommendationResult {
	if (typeof value !== 'object' || value === null)
		return false
	const candidate = value as Record<string, unknown>
	return isDestination(candidate.destination)
		&& isTravelStyle(candidate.requestedStyle)
		&& isTravelStyle(candidate.recommendedStyle)
		&& (candidate.fit === 'comfortable' || candidate.fit === 'workable' || candidate.fit === 'tight')
		&& typeof candidate.tripDays === 'number'
		&& typeof candidate.travelers === 'number'
		&& typeof candidate.budget === 'number'
		&& typeof candidate.estimatedBaselineCost === 'number'
		&& typeof candidate.budgetGap === 'number'
		&& typeof candidate.budgetPerPersonPerDay === 'number'
		&& Array.isArray(candidate.notes)
}

export function isPlainObject(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value)
}

// -------------------------------------------------------------------------------------------------
// UTC-calendar-day date semantics (checkpoint §2 "Derived semantics" / §4 "Custom validation and
// Runtime-diagnostic demonstrations"). Calendar-date arithmetic, never local timestamp-duration arithmetic.
// -------------------------------------------------------------------------------------------------

const STRICT_CALENDAR_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/

/** Strict `YYYY-MM-DD` syntax *and* calendar validity (rejects e.g. `2027-02-30`). */
export function isValidCalendarDateString(value: string): boolean {
	if (!STRICT_CALENDAR_DATE_PATTERN.test(value))
		return false

	const [yearText, monthText, dayText] = value.split('-')
	const year = Number(yearText)
	const month = Number(monthText)
	const day = Number(dayText)
	const utcMs = Date.UTC(year, month - 1, day)
	const reconstructed = new Date(utcMs)
	return reconstructed.getUTCFullYear() === year
		&& reconstructed.getUTCMonth() === month - 1
		&& reconstructed.getUTCDate() === day
}

const MS_PER_DAY = 86_400_000

/**
 * The UTC calendar-day ordinal of a strict `YYYY-MM-DD` string (days since the Unix epoch, UTC).
 * Callers must validate with {@link isValidCalendarDateString} first.
 */
export function utcCalendarDayNumber(value: string): number {
	const [yearText, monthText, dayText] = value.split('-')
	return Date.UTC(Number(yearText), Number(monthText) - 1, Number(dayText)) / MS_PER_DAY
}

/**
 * `tripDays = UTC-calendar-day(return) - UTC-calendar-day(departure) + 1`, requiring `return` strictly
 * after `departure` (checkpoint §2 example: `2027-04-10` through `2027-04-14` = `5`). Returns `null`
 * when the ordering constraint is violated — the caller (`TripMetrics.tripDays`) is responsible for
 * turning that into a Runtime Diagnostic via `ctx.addDiagnostic(...)`.
 */
export function computeTripDays(departure: string, returnDate: string): number | null {
	const departureDay = utcCalendarDayNumber(departure)
	const returnDay = utcCalendarDayNumber(returnDate)
	if (returnDay <= departureDay)
		return null
	return returnDay - departureDay + 1
}
