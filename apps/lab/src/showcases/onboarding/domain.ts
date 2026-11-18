/**
 * Onboarding wizard ("Tidepool Makers" new-member onboarding) domain model: the pure, framework-free helpers and value
 * shapes the plugins (`./plugins/`), the config checkers (`./config.ts`), the simulated booking office
 * (`./booking-office.ts`) and the renderers share. Nothing here touches Core.
 *
 * Every value that crosses a Property, State, Method or Event boundary is plain JSON (strings, numbers, booleans,
 * arrays and objects of those), because the Inspector shows Event arguments and State as bounded value trees.
 */

// -------------------------------------------------------------------------------------------------
// Text
// -------------------------------------------------------------------------------------------------

/** Text per language, `{ "en": "...", "zh-TW": "..." }`. `en` is required; a missing language falls back to it. */
export interface I18nText { readonly [language: string]: string }

/** The text in `language`, or the English text when that language is missing. */
export function localize(text: I18nText, language: string): string {
	return Object.hasOwn(text, language) && typeof text[language] === 'string' && text[language] !== ''
		? text[language]
		: text.en ?? ''
}

export function isI18nText(input: unknown): input is I18nText {
	return typeof input === 'object' && input !== null && !Array.isArray(input) && typeof (input as { en?: unknown }).en === 'string'
		&& Object.values(input)
			.every(value => typeof value === 'string')
}

/** Fills `{name}` placeholders. A placeholder without a value stays as written. */
export function fill(template: string, values: Readonly<Record<string, string | number>>): string {
	return template.replace(/\{(\w+)\}/g, (whole, key: string) => Object.hasOwn(values, key) ? String(values[key]) : whole)
}

// -------------------------------------------------------------------------------------------------
// Dates, times, ids and e-mail addresses
// -------------------------------------------------------------------------------------------------

/** A widget-local id (an interest, a safety rule): a lowercase letter, then lowercase letters, digits and "-". */
export const OPTION_ID_PATTERN = /^[a-z][a-z0-9-]*$/
export const ISO_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/
export const TIME_PATTERN = /^(?:[01]\d|2[0-3]):[0-5]\d$/
export const EMAIL_PATTERN = /^[^\s@]+@[^\s@][^\s.@]*\.[^\s@]+$/

/** `true` for a real calendar date written `YYYY-MM-DD` (`2026-02-30` is not one). */
export function isIsoDate(input: unknown): input is string {
	if (typeof input !== 'string' || !ISO_DATE_PATTERN.test(input))
		return false
	const [year, month, day] = input.split('-')
		.map(Number) as [number, number, number]
	const date = new Date(Date.UTC(year, month - 1, day))
	return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day
}

export function isTime(input: unknown): input is string {
	return typeof input === 'string' && TIME_PATTERN.test(input)
}

export function isOptionId(input: unknown): input is string {
	return typeof input === 'string' && OPTION_ID_PATTERN.test(input)
}

export function isEmail(input: unknown): input is string {
	return typeof input === 'string' && EMAIL_PATTERN.test(input.trim())
}

/** A date such as `2026-12-05` in the viewer's language, always read in UTC so the viewer's time zone never moves it. */
export function formatDate(date: string, locale: string): string {
	if (!isIsoDate(date))
		return date
	return new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeZone: 'UTC' })
		.format(new Date(`${date}T00:00:00Z`))
}

/** A short description of a value for a message ("a string", "null", "an array"). */
export function describeValue(input: unknown): string {
	if (input === null)
		return 'null'
	if (Array.isArray(input))
		return 'an array'
	if (typeof input === 'number')
		return Number.isNaN(input) ? 'NaN' : String(input)
	return typeof input === 'object' ? 'an object' : typeof input
}

// -------------------------------------------------------------------------------------------------
// The wizard
// -------------------------------------------------------------------------------------------------

/** The plugin types a step of the wizard can be. */
export const STEP_TYPES = ['AccountStep', 'InterestsStep', 'SafetyStep', 'InductionStep'] as const
export type StepType = typeof STEP_TYPES[number]

export function isStepType(input: unknown): input is StepType {
	return typeof input === 'string' && (STEP_TYPES as readonly string[]).includes(input)
}

/** What the root knows of one step: read from the step's own Properties. */
export interface StepSummary {
	readonly id: string
	readonly type: string
	readonly title: I18nText
	readonly complete: boolean
	/** What is still missing, as machine-readable codes (`name`, `email`, `interests`, `rule:<id>`, `booking`, ...). */
	readonly missing: readonly string[]
}

/** Where the wizard is, and how far the visitor may go. */
export interface Progress {
	readonly count: number
	/** The index of the current step. */
	readonly current: number
	readonly currentId: string | null
	readonly stepIds: readonly string[]
	/** The first step that is not complete, or -1 when every step is. */
	readonly firstIncomplete: number
	/** The furthest step the visitor may enter: the first incomplete one (or the last when all are complete). */
	readonly furthest: number
	readonly allComplete: boolean
}

/** How the visitor changed step. */
export type StepChangeBy = 'next' | 'back' | 'jump'

/** The payload of the root's `stepChanged` Event. */
export interface StepChange {
	readonly from: string
	readonly to: string
	readonly fromIndex: number
	readonly toIndex: number
	readonly by: StepChangeBy
}

/** The payload of the root's `completed` Event: every step's own `answers`, by step id. */
export interface Completion {
	readonly answers: { readonly [stepId: string]: unknown }
}

// -------------------------------------------------------------------------------------------------
// The induction booking
// -------------------------------------------------------------------------------------------------

export const BOOKING_STATUSES = ['idle', 'requesting', 'confirmed', 'declined'] as const
export type BookingStatus = typeof BOOKING_STATUSES[number]

export function isBookingStatus(input: unknown): input is BookingStatus {
	return typeof input === 'string' && (BOOKING_STATUSES as readonly string[]).includes(input)
}

export interface Slot {
	readonly date: string
	readonly time: string
}

export function isSlot(input: unknown): input is Slot {
	return typeof input === 'object' && input !== null && isIsoDate((input as { date?: unknown }).date) && isTime((input as { time?: unknown }).time)
}

export function isNullableSlot(input: unknown): input is Slot | null {
	return input === null || isSlot(input)
}

/** What the booking office answers for a request. */
export type BookingOutcome
	= | { readonly status: 'confirmed', readonly reference: string }
		| { readonly status: 'declined', readonly reason: string }

export function isBookingOutcome(input: unknown): input is BookingOutcome {
	if (typeof input !== 'object' || input === null)
		return false
	const outcome = input as { status?: unknown, reference?: unknown, reason?: unknown }
	return (outcome.status === 'confirmed' && typeof outcome.reference === 'string' && outcome.reference !== '')
		|| (outcome.status === 'declined' && typeof outcome.reason === 'string' && outcome.reason !== '')
}

/** The payload of the induction's `slotRequested` Event: what the host is asked to book. */
export interface SlotRequest extends Slot {
	/** The ticket of this request: an answer is applied only while it is still the newest. */
	readonly ticket: number
}

/** The payload of `slotConfirmed`. */
export interface SlotConfirmation extends SlotRequest {
	readonly reference: string
}

/** The payload of `slotDeclined`. */
export interface SlotDeclined extends SlotRequest {
	readonly reason: string
}

/** The payload of `slotCancelled`: the request or booking the visitor gave up. */
export interface SlotCancelled extends SlotRequest {
	/** `true` when the booking had been confirmed already, `false` when the request was still waiting for an answer. */
	readonly wasConfirmed: boolean
}

/** What the induction step contributes to the `completed` Event. */
export interface InductionAnswers {
	readonly slot: Slot | null
	readonly reference: string | null
}

/** What the account step contributes. */
export interface AccountAnswers {
	readonly name: string
	readonly email: string
}

export function isStringArray(input: unknown): input is readonly string[] {
	return Array.isArray(input) && input.every(item => typeof item === 'string')
}

export function isBoolean(input: unknown): input is boolean {
	return typeof input === 'boolean'
}

export function isNumber(input: unknown): input is number {
	return typeof input === 'number' && Number.isFinite(input)
}

export function isString(input: unknown): input is string {
	return typeof input === 'string'
}
