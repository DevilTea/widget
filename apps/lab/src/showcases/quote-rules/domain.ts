/**
 * The quote's plain data and the money arithmetic. No Vue, no DOM, no Widget plugin in here: the plugins
 * (`./plugins/`), the headless evaluation (`./evaluate.ts`, which the Web Worker runs) and the renderers all
 * import it, so what the page shows and what the worker computes can never differ because of a second copy of a
 * formula.
 *
 * All money is whole **minor units** (cents) of the quote's currency. A percentage of an amount is rounded
 * half-up once, where it is applied.
 */

/** Text per language, `{ "en": "Flyers", "zh-TW": "傳單" }`. `en` is required; a missing language falls back to it. */
export type I18nText = Readonly<{ en: string } & Record<string, string>>

export const QUOTE_LANGUAGES = ['en', 'zh-TW'] as const

/** The text for `language`, or the English text when the document has none for it. */
export function localize(text: I18nText, language: string): string {
	return Object.hasOwn(text, language) ? text[language]! : text.en
}

/** A currency code: three capital letters. */
export const CURRENCY_CODE_PATTERN = /^[A-Z]{3}$/

/** What the keys of `papers` look like. */
export const PAPER_CODE_PATTERN = /^[a-z][a-z0-9-]*$/

export const MAX_QUANTITY = 100_000
export const MAX_CENTS = 100_000_000

/** `percent` percent of `cents`, rounded half-up to a whole minor unit. */
export function percentOf(cents: number, percent: number): number {
	return Math.round(cents * percent / 100)
}

export type RuleKind = 'discount' | 'surcharge' | 'fee' | 'tax'

/** One rule's effect on the quote: what its Property `adjustment` returns. Negative `cents` is a reduction. */
export interface Adjustment {
	/** The plugin type of the rule that produced it, such as `VolumeDiscount`. */
	readonly type: string
	readonly kind: RuleKind
	readonly label: I18nText
	/** `false` when the rule did not apply to these answers (it still reports `cents: 0`). */
	readonly applied: boolean
	/** The percentage the rule used, or `null` for a flat amount or a rule that did not apply. */
	readonly percent: number | null
	readonly cents: number
	/** A machine-readable note the renderer translates, or `null`. */
	readonly reason: AdjustmentReason | null
}

export type AdjustmentReason = 'free-over-threshold'

/** One Item's priced line: what its Property `line` returns. */
export interface ItemLine {
	readonly title: I18nText
	readonly quantity: number
	readonly paper: string
	readonly paperLabel: I18nText
	/** The price of one piece on this paper, in minor units. */
	readonly unitCents: number
	readonly cents: number
}

export interface QuoteLine extends ItemLine {
	readonly id: string
}

export interface QuoteAdjustment extends Adjustment {
	readonly id: string
}

/** The whole quote as plain JSON: the Quote widget's Property `quote`, and what the worker returns. */
export interface QuoteResult {
	readonly currency: string
	readonly lines: readonly QuoteLine[]
	readonly adjustments: readonly QuoteAdjustment[]
	readonly subtotalCents: number
	/** The amount the tax applies to: the subtotal plus every rule that is not the tax. */
	readonly taxableCents: number
	readonly totalCents: number
}

/** The answers a customer gave, by widget id and State name: the Quote widget's Property `answers`. */
export type QuoteAnswers = Readonly<Record<string, Readonly<Record<string, unknown>>>>

export function isPlainObject(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** The amount as text in the viewer's language, such as `€1,234.50`. */
export function formatMoney(cents: number, currency: string, language: string): string {
	try {
		return new Intl.NumberFormat(language, { style: 'currency', currency })
			.format(cents / 100)
	}
	catch {
		return `${(cents / 100).toFixed(2)} ${currency}`
	}
}

/** A signed amount (`+€5.00`, `−€5.00`); zero has no sign. */
export function formatSignedMoney(cents: number, currency: string, language: string): string {
	if (cents === 0)
		return formatMoney(0, currency, language)
	return `${cents > 0 ? '+' : '−'}${formatMoney(Math.abs(cents), currency, language)}`
}
