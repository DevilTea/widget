/**
 * Config checkers and `resolve` helpers for the trip-budget plugins.
 *
 * Each plugin's `config.validate` calls its checker with Core's `ctx.addDiagnostic`, so a bad config is an
 * `invalid-widget-config` diagnostic with an exact config `path` and a machine-readable `reason` (see
 * `ConfigReason`). Checkers are collectors, not predicates: they report every problem they find and the
 * plugin decides validity from `ctx.hasAnyDiagnostic()`. Unknown keys are rejected.
 *
 * What a checker cannot see is another widget: whether `paidBy` or a participant names a real person, or
 * whether the trip has exactly one Currency, is a structure check in the plugins (`plugins/structure.ts`),
 * because only a structure validator receives the Blueprint.
 *
 * A widget whose config failed validation is compiled with `resolve(null)`. The fallback is marked
 * `recovered: true` so cross-widget checks can skip it instead of piling more diagnostics on top.
 */

import type { I18nText, RoundStep } from './domain'
import { CURRENCY_CODE_PATTERN, DEFAULT_ROUND_STEP, isRoundStep, PERSON_ID_PATTERN, ROUND_STEPS } from './domain'

// -------------------------------------------------------------------------------------------------
// Raw config (what the author writes) and resolved config (what the plugin reads)
// -------------------------------------------------------------------------------------------------

/** The authored config of a Trip. */
export interface TripRawConfig {
	/** The trip title. "en" is required; "zh-TW" is optional. */
	readonly title: I18nText
}

/** The authored config of a Currency. */
export interface CurrencyRawConfig {
	/**
	 * The currency the settlement is computed and shown in, a three-letter capital code such as `"EUR"`. It is always worth 1
	 * and must not appear in `rates`.
	 */
	readonly base: string
	/**
	 * How many base-currency units one unit of each other currency is worth, such as `{ "USD": 0.92 }`. An expense in a
	 * currency that is neither the base nor listed here cannot be converted: the conversion Method fails and the settlement
	 * fails with it.
	 */
	readonly rates: { readonly [code: string]: number }
	/**
	 * The starting "round transfers to" step in minor units: 1 = the cent, 100 = a whole unit, 500 = the nearest 5 units. A
	 * viewer can change it; Start over restores this value. Defaults to 1.
	 */
	readonly roundTransfersTo?: number
}

/** The authored config of a Person. */
export interface PersonRawConfig {
	/**
	 * The name shown for this person. The widget id (not the name) is what expenses refer to.
	 *
	 * @minLength 1
	 */
	readonly name: string
}

/** An equal split: the people in `among` share the amount equally (the leftover cents go to the first people listed). */
export interface EqualSplitRaw {
	/** `equal`. */
	readonly mode: 'equal'
	/** The ids of the Persons sharing the expense at the start (a viewer can tick and untick them). */
	readonly among: readonly string[]
}

/** A percent split: each person in `percents` pays that percentage. */
export interface PercentSplitRaw {
	/** `percent`. */
	readonly mode: 'percent'
	/** Person id -> percentage. The percentages must add up to 100 (the compiler reports a located diagnostic otherwise). */
	readonly percents: { readonly [personId: string]: number }
}

/** The authored config of an Expense. */
export interface ExpenseRawConfig {
	/** What the money was spent on. */
	readonly title: I18nText
	/**
	 * The starting amount, in `currency`. A viewer can change the amount, the payer and (for an equal split) who shares;
	 * "Reset this expense" restores these starting values.
	 *
	 * @minimum 0
	 */
	readonly amount: number
	/** The currency of the amount: the Currency widget's base or one of its rates. */
	readonly currency: string
	/**
	 * The id of the Person who paid at the start. It must exist in the same trip.
	 *
	 * @widgetRef Person
	 */
	readonly paidBy: string
	/** How the amount is shared: equally among some people, or by percentages that add up to 100. */
	readonly split: EqualSplitRaw | PercentSplitRaw
}

export interface TripConfig {
	readonly title: I18nText
	readonly recovered: boolean
}

export interface CurrencyConfig {
	readonly base: string
	/** The other currencies' rates (the base is not in it). */
	readonly rates: Readonly<Record<string, number>>
	/** The base first, then every other code in the order written. */
	readonly codes: readonly string[]
	readonly roundStep: RoundStep
	readonly recovered: boolean
}

export interface PersonConfig {
	readonly name: string
	readonly recovered: boolean
}

export interface ExpenseConfig {
	readonly title: I18nText
	readonly amount: number
	readonly currency: string
	readonly paidBy: string
	readonly split:
		| { readonly mode: 'equal', readonly among: readonly string[] }
		| { readonly mode: 'percent', readonly percents: Readonly<Record<string, number>> }
	/** The people this expense names as sharing it: `among`, or the keys of `percents`. */
	readonly participants: readonly string[]
	readonly recovered: boolean
}

// -------------------------------------------------------------------------------------------------
// Key lists (the JSON Schemas must declare exactly these properties)
// -------------------------------------------------------------------------------------------------

export const TRIP_CONFIG_KEYS = ['title'] as const
export const CURRENCY_CONFIG_KEYS = ['base', 'rates', 'roundTransfersTo'] as const
export const PERSON_CONFIG_KEYS = ['name'] as const
export const EXPENSE_CONFIG_KEYS = ['title', 'amount', 'currency', 'paidBy', 'split'] as const
export const EQUAL_SPLIT_KEYS = ['mode', 'among'] as const
export const PERCENT_SPLIT_KEYS = ['mode', 'percents'] as const

// -------------------------------------------------------------------------------------------------
// Diagnostics
// -------------------------------------------------------------------------------------------------

export type ConfigPath = readonly (string | number)[]

/** The machine-readable `reason` of a config diagnostic. */
export type ConfigReason
	= | 'not-an-object'
		| 'unknown-key'
		| 'missing-key'
		| 'invalid-type'
		| 'empty-text'
		| 'out-of-range'
		| 'invalid-currency-code'
		| 'invalid-rate'
		| 'base-has-rate'
		| 'unsupported-round-step'
		| 'unknown-split-mode'
		| 'invalid-person-id'
		| 'empty-participants'
		| 'duplicate-participant'
		| 'percent-total'

export interface ConfigDiagnostic {
	readonly message: string
	readonly path?: ConfigPath
	readonly reason?: ConfigReason
}

type Report = (diagnostic: ConfigDiagnostic) => void

export function isPlainObject(input: unknown): input is Record<string, unknown> {
	return typeof input === 'object' && input !== null && !Array.isArray(input)
}

export function formatConfigPath(path: ConfigPath): string {
	return path.length === 0
		? 'config'
		: `config.${path.map(String)
			.join('.')}`
}

function describe(input: unknown): string {
	if (input === null)
		return 'null'
	if (Array.isArray(input))
		return 'an array'
	return typeof input === 'object' ? 'an object' : typeof input
}

/** Checks `input` is a plain object with exactly the allowed keys (every key of `required` present). */
function checkObject(input: unknown, allowed: readonly string[], required: readonly string[], path: ConfigPath, report: Report): Record<string, unknown> | null {
	if (!isPlainObject(input)) {
		report({ message: `${formatConfigPath(path)} must be an object, got ${describe(input)}.`, path, reason: 'not-an-object' })
		return null
	}
	for (const key of Object.keys(input)) {
		if (!allowed.includes(key))
			report({ message: `${formatConfigPath([...path, key])} is not a known key. Expected: ${allowed.join(', ')}.`, path: [...path, key], reason: 'unknown-key' })
	}
	for (const key of required) {
		if (!Object.hasOwn(input, key))
			report({ message: `${formatConfigPath([...path, key])} is required.`, path: [...path, key], reason: 'missing-key' })
	}
	return input
}

function checkText(input: unknown, path: ConfigPath, report: Report): void {
	if (!isPlainObject(input)) {
		report({ message: `${formatConfigPath(path)} must be text per language such as { "en": "..." }, got ${describe(input)}.`, path, reason: 'invalid-type' })
		return
	}
	if (typeof input.en !== 'string' || input.en.trim() === '') {
		report({ message: `${formatConfigPath([...path, 'en'])} must be a non-empty string: "en" is the language every other one falls back to.`, path: [...path, 'en'], reason: 'empty-text' })
	}
	for (const [language, value] of Object.entries(input)) {
		if (language !== 'en' && typeof value !== 'string')
			report({ message: `${formatConfigPath([...path, language])} must be a string.`, path: [...path, language], reason: 'invalid-type' })
	}
}

function checkCurrencyCode(input: unknown, path: ConfigPath, report: Report): input is string {
	if (typeof input !== 'string' || !CURRENCY_CODE_PATTERN.test(input)) {
		report({ message: `${formatConfigPath(path)} must be a three-letter capital currency code such as "EUR".`, path, reason: 'invalid-currency-code' })
		return false
	}
	return true
}

function checkPersonId(input: unknown, path: ConfigPath, report: Report): input is string {
	if (typeof input !== 'string' || !PERSON_ID_PATTERN.test(input)) {
		report({ message: `${formatConfigPath(path)} must be a person id: a lowercase letter, then lowercase letters, digits and "-".`, path, reason: 'invalid-person-id' })
		return false
	}
	return true
}

// -------------------------------------------------------------------------------------------------
// Checkers
// -------------------------------------------------------------------------------------------------

export function checkTripConfig(input: unknown, report: Report): void {
	const object = checkObject(input, TRIP_CONFIG_KEYS, ['title'], [], report)
	if (object !== null && Object.hasOwn(object, 'title'))
		checkText(object.title, ['title'], report)
}

export function checkPersonConfig(input: unknown, report: Report): void {
	const object = checkObject(input, PERSON_CONFIG_KEYS, ['name'], [], report)
	if (object === null || !Object.hasOwn(object, 'name'))
		return
	if (typeof object.name !== 'string' || object.name.trim() === '')
		report({ message: 'config.name must be a non-empty string.', path: ['name'], reason: 'empty-text' })
}

export function checkCurrencyConfig(input: unknown, report: Report): void {
	const object = checkObject(input, CURRENCY_CONFIG_KEYS, ['base', 'rates'], [], report)
	if (object === null)
		return
	const base = Object.hasOwn(object, 'base') && checkCurrencyCode(object.base, ['base'], report) ? object.base : null
	if (Object.hasOwn(object, 'rates')) {
		if (!isPlainObject(object.rates)) {
			report({ message: `config.rates must be an object of rates such as { "USD": 0.92 }, got ${describe(object.rates)}.`, path: ['rates'], reason: 'invalid-type' })
		}
		else {
			for (const [code, rate] of Object.entries(object.rates)) {
				if (!CURRENCY_CODE_PATTERN.test(code))
					report({ message: `${formatConfigPath(['rates', code])} is not a three-letter capital currency code.`, path: ['rates', code], reason: 'invalid-currency-code' })
				else if (code === base)
					report({ message: `${formatConfigPath(['rates', code])} must not exist: the base currency is always worth 1.`, path: ['rates', code], reason: 'base-has-rate' })
				if (typeof rate !== 'number' || !Number.isFinite(rate) || rate <= 0)
					report({ message: `${formatConfigPath(['rates', code])} must be a number greater than 0.`, path: ['rates', code], reason: 'invalid-rate' })
			}
		}
	}
	if (Object.hasOwn(object, 'roundTransfersTo') && !isRoundStep(object.roundTransfersTo))
		report({ message: `config.roundTransfersTo must be one of ${ROUND_STEPS.join(', ')} (minor units: the cent, a whole unit, the nearest 5 units).`, path: ['roundTransfersTo'], reason: 'unsupported-round-step' })
}

export function checkExpenseConfig(input: unknown, report: Report): void {
	const object = checkObject(input, EXPENSE_CONFIG_KEYS, EXPENSE_CONFIG_KEYS, [], report)
	if (object === null)
		return
	if (Object.hasOwn(object, 'title'))
		checkText(object.title, ['title'], report)
	if (Object.hasOwn(object, 'amount') && (typeof object.amount !== 'number' || !Number.isFinite(object.amount) || object.amount < 0))
		report({ message: 'config.amount must be a number that is not negative.', path: ['amount'], reason: 'out-of-range' })
	if (Object.hasOwn(object, 'currency'))
		checkCurrencyCode(object.currency, ['currency'], report)
	if (Object.hasOwn(object, 'paidBy'))
		checkPersonId(object.paidBy, ['paidBy'], report)
	if (Object.hasOwn(object, 'split'))
		checkSplit(object.split, report)
}

function checkSplit(input: unknown, report: Report): void {
	if (!isPlainObject(input)) {
		report({ message: `config.split must be an object, got ${describe(input)}.`, path: ['split'], reason: 'not-an-object' })
		return
	}
	if (input.mode === 'equal') {
		checkObject(input, EQUAL_SPLIT_KEYS, EQUAL_SPLIT_KEYS, ['split'], report)
		if (!Object.hasOwn(input, 'among'))
			return
		if (!Array.isArray(input.among)) {
			report({ message: 'config.split.among must be a list of person ids.', path: ['split', 'among'], reason: 'invalid-type' })
			return
		}
		if (input.among.length === 0)
			report({ message: 'config.split.among must name at least one person.', path: ['split', 'among'], reason: 'empty-participants' })
		const seen = new Set<unknown>()
		input.among.forEach((id: unknown, index: number) => {
			if (!checkPersonId(id, ['split', 'among', index], report))
				return
			if (seen.has(id))
				report({ message: `${formatConfigPath(['split', 'among', index])} repeats "${id}".`, path: ['split', 'among', index], reason: 'duplicate-participant' })
			seen.add(id)
		})
	}
	else if (input.mode === 'percent') {
		checkObject(input, PERCENT_SPLIT_KEYS, PERCENT_SPLIT_KEYS, ['split'], report)
		if (!Object.hasOwn(input, 'percents'))
			return
		if (!isPlainObject(input.percents)) {
			report({ message: 'config.split.percents must be an object of percentages such as { "ana": 60, "ben": 40 }.', path: ['split', 'percents'], reason: 'invalid-type' })
			return
		}
		const entries = Object.entries(input.percents)
		if (entries.length === 0)
			report({ message: 'config.split.percents must name at least one person.', path: ['split', 'percents'], reason: 'empty-participants' })
		let total = 0
		let numeric = true
		for (const [id, percent] of entries) {
			checkPersonId(id, ['split', 'percents', id], report)
			if (typeof percent !== 'number' || !Number.isFinite(percent) || percent < 0 || percent > 100) {
				report({ message: `${formatConfigPath(['split', 'percents', id])} must be a number from 0 to 100.`, path: ['split', 'percents', id], reason: 'out-of-range' })
				numeric = false
			}
			else {
				total += percent
			}
		}
		if (numeric && entries.length > 0 && Math.abs(total - 100) > 1e-9)
			report({ message: `config.split.percents add up to ${Number(total.toFixed(6))}, not 100.`, path: ['split', 'percents'], reason: 'percent-total' })
	}
	else {
		report({ message: 'config.split.mode must be "equal" or "percent".', path: ['split', 'mode'], reason: 'unknown-split-mode' })
	}
}

// -------------------------------------------------------------------------------------------------
// Resolve (raw config -> resolved config). `null` is the recovery input of a config that failed validation.
// -------------------------------------------------------------------------------------------------

export function resolveTripConfig(raw: TripRawConfig | null): TripConfig {
	return raw === null ? { title: { en: '' }, recovered: true } : { title: raw.title, recovered: false }
}

export function resolvePersonConfig(raw: PersonRawConfig | null): PersonConfig {
	return raw === null ? { name: '', recovered: true } : { name: raw.name, recovered: false }
}

export function resolveCurrencyConfig(raw: CurrencyRawConfig | null): CurrencyConfig {
	if (raw === null)
		return { base: 'EUR', rates: {}, codes: ['EUR'], roundStep: DEFAULT_ROUND_STEP, recovered: true }
	return {
		base: raw.base,
		rates: raw.rates,
		codes: [raw.base, ...Object.keys(raw.rates)],
		roundStep: isRoundStep(raw.roundTransfersTo) ? raw.roundTransfersTo : DEFAULT_ROUND_STEP,
		recovered: false,
	}
}

export function resolveExpenseConfig(raw: ExpenseRawConfig | null): ExpenseConfig {
	if (raw === null)
		return { title: { en: '' }, amount: 0, currency: 'EUR', paidBy: '', split: { mode: 'equal', among: [] }, participants: [], recovered: true }
	const split = raw.split.mode === 'equal'
		? { mode: 'equal' as const, among: raw.split.among }
		: { mode: 'percent' as const, percents: raw.split.percents }
	return {
		title: raw.title,
		amount: raw.amount,
		currency: raw.currency,
		paidBy: raw.paidBy,
		split,
		participants: split.mode === 'equal' ? split.among : Object.keys(split.percents),
		recovered: false,
	}
}

/** `true` for the fallback a failed config resolves to. */
export function isRecovered(node: object): boolean {
	const config = (node as { readonly config?: unknown }).config
	return isPlainObject(config) && config.recovered === true
}
