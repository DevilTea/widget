/**
 * One document, two renderer packs: the pure, framework-free domain of the "workspace settings" page. Nothing here runs a
 * Runtime and nothing here knows how a widget is drawn: which control draws a field is the renderer pack's business, what the
 * field means (its limit, its message, which notification a confirmed action leaves) is written here.
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

/** Fills `{name}` placeholders. A placeholder without a value stays as written. */
export function fill(template: string, values: Readonly<Record<string, string | number>>): string {
	return template.replace(/\{(\w+)\}/g, (whole, key: string) => Object.hasOwn(values, key) ? String(values[key]) : whole)
}

export function isRecord(input: unknown): input is Record<string, unknown> {
	return typeof input === 'object' && input !== null && !Array.isArray(input)
}

export function isString(input: unknown): input is string {
	return typeof input === 'string'
}

export function isNumber(input: unknown): input is number {
	return typeof input === 'number'
}

export function isBoolean(input: unknown): input is boolean {
	return typeof input === 'boolean'
}

export function describeValue(input: unknown): string {
	if (input === null)
		return 'null'
	if (Array.isArray(input))
		return 'an array'
	if (typeof input === 'string')
		return `the string ${JSON.stringify(input)}`
	return typeof input === 'object' ? 'an object' : `${typeof input} ${String(input)}`
}

export function isI18nText(input: unknown): input is I18nText {
	return isRecord(input) && typeof input.en === 'string' && input.en.trim() !== '' && Object.values(input)
		.every(value => typeof value === 'string')
}

// -------------------------------------------------------------------------------------------------
// Appearance (the capability widget fields read)
// -------------------------------------------------------------------------------------------------

export const DENSITIES = ['comfortable', 'compact'] as const
export type Density = typeof DENSITIES[number]

/** `auto` follows the host's theme; the host's theme is not known to Core, so the pack resolves it with `resolveScheme`. */
export const MODES = ['auto', 'light', 'dark'] as const
export type Mode = typeof MODES[number]

export type Scheme = 'light' | 'dark'

export function isDensity(input: unknown): input is Density {
	return typeof input === 'string' && (DENSITIES as readonly string[]).includes(input)
}

export function isMode(input: unknown): input is Mode {
	return typeof input === 'string' && (MODES as readonly string[]).includes(input)
}

/** The colour scheme a pack draws in: the mode itself, or the host's theme for `auto`. */
export function resolveScheme(mode: Mode, hostTheme: Scheme): Scheme {
	return mode === 'auto' ? hostTheme : mode
}

// -------------------------------------------------------------------------------------------------
// Notifier (the capability widget a confirmed action reports to)
// -------------------------------------------------------------------------------------------------

export const TONES = ['info', 'success', 'danger'] as const
export type Tone = typeof TONES[number]

export function isTone(input: unknown): input is Tone {
	return typeof input === 'string' && (TONES as readonly string[]).includes(input)
}

export interface NotifierItem {
	readonly id: number
	readonly message: I18nText
	readonly tone: Tone
}

export function isNotifierItem(input: unknown): input is NotifierItem {
	return isRecord(input) && Number.isInteger(input.id) && (input.id as number) >= 1 && isI18nText(input.message) && isTone(input.tone)
		&& Object.keys(input)
			.every(key => key === 'id' || key === 'message' || key === 'tone')
}

export function isNotifierItems(input: unknown): input is readonly NotifierItem[] {
	return Array.isArray(input) && input.every(isNotifierItem) && new Set(input.map(item => item.id)).size === input.length
}

export const DEFAULT_NOTIFIER_LIMIT = 4

/** Appends a notification with the next free id and keeps only the newest `limit`. */
export function appendNotification(items: readonly NotifierItem[], message: I18nText, tone: Tone, limit: number): { readonly items: readonly NotifierItem[], readonly id: number } {
	const id = items.reduce((highest, item) => Math.max(highest, item.id), 0) + 1
	return { items: [...items, { id, message, tone }].slice(-limit), id }
}

/**
 * What the page announces. A `danger` notification is the page's alert (the newest one), every other tone is its status
 * (the newest one): so a page never has two alerts, and a status never replaces an alert.
 */
export interface Announcements {
	readonly alert: NotifierItem | null
	readonly status: NotifierItem | null
}

export function announcementsOf(items: readonly NotifierItem[]): Announcements {
	const newest = [...items].reverse()
	return {
		alert: newest.find(item => item.tone === 'danger') ?? null,
		status: newest.find(item => item.tone !== 'danger') ?? null,
	}
}

// -------------------------------------------------------------------------------------------------
// Fields
// -------------------------------------------------------------------------------------------------

export interface ChoiceOption {
	readonly value: string
	readonly label: I18nText
}

/** The length of a text as a person counts it (code points, not UTF-16 units). */
export function textLength(value: string): number {
	return Array.from(value).length
}

/** The message under a text field: why its value is not acceptable, or `null`. The value is always stored; this only says. */
export function textProblem(value: string, maxLength: number): I18nText | null {
	const length = textLength(value)
	if (length <= maxLength)
		return null
	return {
		'en': `Too long: ${length} of ${maxLength} characters allowed.`,
		'zh-TW': `太長了：最多 ${maxLength} 個字元，目前 ${length} 個。`,
	}
}

export function isChoiceOptions(input: unknown): input is readonly ChoiceOption[] {
	return Array.isArray(input) && input.every(option => isRecord(option) && typeof option.value === 'string' && isI18nText(option.label))
}
