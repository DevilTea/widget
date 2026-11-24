/**
 * The quote's plain data and the money arithmetic. No Vue, no DOM, no Widget plugin in here: the plugins
 * (`./plugins/`), the headless evaluation (`./evaluate.ts`, which the Web Worker runs) and the renderers all
 * import it, so what the page shows and what the worker computes can never differ because of a second copy of a
 * formula.
 *
 * All money is whole **minor units** (cents) of the quote's currency. A percentage of an amount is rounded
 * half-up once, where it is applied.
 */

export interface I18nText {
	readonly en: string
	readonly [language: string]: string
}

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

/**
 * `percent` percent of `cents`, rounded half-up (half away from zero) to a whole minor unit. A percentage counts to two
 * decimals (hundredths of a percent, `9.2` is 920): the arithmetic is then on integers only, so a result that is exactly
 * half a unit (375 x 9.2% = 34.5) rounds up as it says, which `Math.round(cents * percent / 100)` does not (it gets 34).
 * The product is a BigInt: a large subtotal times a percentage in hundredths (up to 300% is 30000) passes 2^53, where
 * a Number product would already be rounded before the division.
 */
export function percentOf(cents: number, percent: number): number {
	const product = BigInt(cents) * BigInt(Math.round(percent * 100))
	const magnitude = (product < 0n ? -product : product) + 5000n
	const rounded = Number(magnitude / 10000n)
	// `+ 0` turns a -0 into 0.
	return (product < 0n ? -rounded : rounded) + 0
}

/**
 * What a rule does to the quote: `discount` (VolumeDiscount), `surcharge` (RushSurcharge), `fee` (Delivery) or `tax`
 * (SalesTax).
 */
export type RuleKind = 'discount' | 'surcharge' | 'fee' | 'tax'

export interface Adjustment {
	readonly type: string
	readonly kind: RuleKind
	readonly label: I18nText
	readonly applied: boolean
	readonly percent: number | null
	readonly cents: number
	readonly reason: AdjustmentReason | null
}

/** Why an applied rule charges nothing: `free-over-threshold` is a Delivery whose courier fee is waived. */
export type AdjustmentReason = 'free-over-threshold'

export interface ItemLine {
	readonly title: I18nText
	readonly quantity: number
	readonly paper: string
	readonly paperLabel: I18nText
	readonly unitCents: number
	readonly cents: number
}

export interface QuoteLine extends ItemLine {
	readonly id: string
}

export interface QuoteAdjustment extends Adjustment {
	readonly id: string
}

export interface QuoteResult {
	readonly currency: string
	readonly lines: readonly QuoteLine[]
	readonly adjustments: readonly QuoteAdjustment[]
	readonly subtotalCents: number
	readonly taxableCents: number
	readonly totalCents: number
}

/** The answers a customer gave, by widget id and State name: the Quote widget's Property `answers`. */
export type QuoteAnswers = Readonly<Record<string, Readonly<Record<string, unknown>>>>

export function isPlainObject(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/**
 * The amount as text in the viewer's language, such as `€1,234.50`. "Minor unit" is the currency's own: the number of
 * decimals comes from the currency (`Intl`: 2 for EUR, 0 for JPY, 3 for KWD), so 500 is `¥500` but `€5.00`. Only the text
 * is formatted here; the quote JSON stays integers of minor units, the same in every locale.
 */
export function formatMoney(cents: number, currency: string, language: string): string {
	try {
		const format = new Intl.NumberFormat(language, { style: 'currency', currency })
		return format.format(cents / 10 ** (format.resolvedOptions().maximumFractionDigits ?? 2))
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
