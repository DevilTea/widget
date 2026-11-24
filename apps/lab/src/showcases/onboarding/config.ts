/**
 * Config checkers and `resolve` helpers for the onboarding plugins.
 *
 * Each plugin's `config.validate` calls its checker with Core's `ctx.addDiagnostic`, so a bad config is an
 * `invalid-widget-config` diagnostic with an exact config `path` and a machine-readable `reason`. Checkers are
 * collectors: they report every problem they find and the plugin decides validity from `ctx.hasAnyDiagnostic()`.
 * Unknown keys are rejected.
 *
 * A widget whose config failed validation is compiled with `resolve(null)`; the fallback is marked `recovered: true`.
 */

import type { I18nText } from './domain'
import { describeValue, isEmail, isIsoDate, isOptionId, isTime } from './domain'

// -------------------------------------------------------------------------------------------------
// Raw config (what the author writes) and resolved config (what the plugin reads)
// -------------------------------------------------------------------------------------------------

export interface OnboardingRawConfig {
	readonly title: I18nText
	readonly startStep?: number
}

export interface AccountRawConfig {
	readonly title: I18nText
	readonly prefill?: {
		readonly name?: string
		readonly email?: string
	}
}

export interface InterestOptionRaw {
	readonly id: string
	readonly label: I18nText
}

export interface InterestsRawConfig {
	readonly title: I18nText
	readonly options: readonly InterestOptionRaw[]
	readonly minimum?: number
	readonly preselected?: readonly string[]
}

export interface SafetyRuleRaw {
	readonly id: string
	readonly text: I18nText
}

export interface SafetyRawConfig {
	readonly title: I18nText
	readonly rules: readonly SafetyRuleRaw[]
	readonly acknowledged?: readonly string[]
}

export interface InductionRawConfig {
	readonly title: I18nText
	readonly days: readonly string[]
	readonly times: readonly string[]
}

export interface OnboardingConfig {
	readonly title: I18nText
	readonly startStep: number
	readonly recovered: boolean
}

export interface AccountConfig {
	readonly title: I18nText
	readonly name: string
	readonly email: string
	readonly recovered: boolean
}

export interface InterestsConfig {
	readonly title: I18nText
	readonly options: readonly InterestOptionRaw[]
	readonly minimum: number
	readonly preselected: readonly string[]
	readonly recovered: boolean
}

export interface SafetyConfig {
	readonly title: I18nText
	readonly rules: readonly SafetyRuleRaw[]
	readonly acknowledged: readonly string[]
	readonly recovered: boolean
}

export interface InductionConfig {
	readonly title: I18nText
	readonly days: readonly string[]
	readonly times: readonly string[]
	readonly recovered: boolean
}

// -------------------------------------------------------------------------------------------------
// Key lists (the JSON Schemas must declare exactly these properties)
// -------------------------------------------------------------------------------------------------

export const ONBOARDING_CONFIG_KEYS = ['title', 'startStep'] as const
export const ACCOUNT_CONFIG_KEYS = ['title', 'prefill'] as const
export const ACCOUNT_PREFILL_KEYS = ['name', 'email'] as const
export const INTERESTS_CONFIG_KEYS = ['title', 'options', 'minimum', 'preselected'] as const
export const INTEREST_OPTION_KEYS = ['id', 'label'] as const
export const SAFETY_CONFIG_KEYS = ['title', 'rules', 'acknowledged'] as const
export const SAFETY_RULE_KEYS = ['id', 'text'] as const
export const INDUCTION_CONFIG_KEYS = ['title', 'days', 'times'] as const

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
		| 'invalid-id'
		| 'duplicate-id'
		| 'unknown-id'
		| 'invalid-date'
		| 'invalid-time'
		| 'empty-list'
		| 'duplicate-entry'
		| 'invalid-email'

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

function checkObject(input: unknown, allowed: readonly string[], required: readonly string[], path: ConfigPath, report: Report): Record<string, unknown> | null {
	if (!isPlainObject(input)) {
		report({ message: `${formatConfigPath(path)} must be an object, got ${describeValue(input)}.`, path, reason: 'not-an-object' })
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
		report({ message: `${formatConfigPath(path)} must be text per language such as { "en": "..." }, got ${describeValue(input)}.`, path, reason: 'invalid-type' })
		return
	}
	if (typeof input.en !== 'string' || input.en.trim() === '')
		report({ message: `${formatConfigPath([...path, 'en'])} must be a non-empty string: "en" is the language every other one falls back to.`, path: [...path, 'en'], reason: 'empty-text' })
	for (const [language, value] of Object.entries(input)) {
		if (language !== 'en' && typeof value !== 'string')
			report({ message: `${formatConfigPath([...path, language])} must be a string.`, path: [...path, language], reason: 'invalid-type' })
	}
}

/** A list of ids (each a known id); duplicates and unknown ids are reported at their index. */
function checkIdList(input: unknown, path: ConfigPath, known: readonly string[], report: Report): void {
	if (!Array.isArray(input)) {
		report({ message: `${formatConfigPath(path)} must be a list of ids, got ${describeValue(input)}.`, path, reason: 'invalid-type' })
		return
	}
	const seen = new Set<unknown>()
	input.forEach((id: unknown, index) => {
		const at = [...path, index]
		if (typeof id !== 'string')
			report({ message: `${formatConfigPath(at)} must be an id string, got ${describeValue(id)}.`, path: at, reason: 'invalid-type' })
		else if (!known.includes(id))
			report({ message: `${formatConfigPath(at)} names "${id}", which is not one of: ${known.join(', ')}.`, path: at, reason: 'unknown-id' })
		else if (seen.has(id))
			report({ message: `${formatConfigPath(at)} repeats "${id}".`, path: at, reason: 'duplicate-entry' })
		seen.add(id)
	})
}

/** The ids of a list of `{ id, ... }` entries that are valid, for cross-checks; every id problem is reported on the way. */
function checkEntries(input: unknown, path: ConfigPath, keys: readonly string[], textKey: string, report: Report): readonly string[] {
	if (!Array.isArray(input)) {
		report({ message: `${formatConfigPath(path)} must be a list, got ${describeValue(input)}.`, path, reason: 'invalid-type' })
		return []
	}
	if (input.length === 0)
		report({ message: `${formatConfigPath(path)} must have at least one entry.`, path, reason: 'empty-list' })
	const ids: string[] = []
	input.forEach((entry: unknown, index) => {
		const at = [...path, index]
		const object = checkObject(entry, keys, keys, at, report)
		if (object === null)
			return
		if (Object.hasOwn(object, 'id')) {
			if (!isOptionId(object.id))
				report({ message: `${formatConfigPath([...at, 'id'])} must be an id: a lowercase letter, then lowercase letters, digits and "-".`, path: [...at, 'id'], reason: 'invalid-id' })
			else if (ids.includes(object.id))
				report({ message: `${formatConfigPath([...at, 'id'])} repeats "${object.id}": ids are unique within the list.`, path: [...at, 'id'], reason: 'duplicate-id' })
			else
				ids.push(object.id)
		}
		if (Object.hasOwn(object, textKey))
			checkText(object[textKey], [...at, textKey], report)
	})
	return ids
}

function checkStringList(input: unknown, path: ConfigPath, valid: (value: unknown) => boolean, reason: 'invalid-date' | 'invalid-time', expected: string, report: Report): void {
	if (!Array.isArray(input)) {
		report({ message: `${formatConfigPath(path)} must be a list, got ${describeValue(input)}.`, path, reason: 'invalid-type' })
		return
	}
	if (input.length === 0)
		report({ message: `${formatConfigPath(path)} must have at least one entry.`, path, reason: 'empty-list' })
	const seen = new Set<unknown>()
	input.forEach((value: unknown, index) => {
		const at = [...path, index]
		if (!valid(value))
			report({ message: `${formatConfigPath(at)} must be ${expected}, got ${typeof value === 'string' ? JSON.stringify(value) : describeValue(value)}.`, path: at, reason })
		else if (seen.has(value))
			report({ message: `${formatConfigPath(at)} repeats "${String(value)}".`, path: at, reason: 'duplicate-entry' })
		seen.add(value)
	})
}

// -------------------------------------------------------------------------------------------------
// Checkers
// -------------------------------------------------------------------------------------------------

export function checkOnboardingConfig(input: unknown, report: Report): void {
	const object = checkObject(input, ONBOARDING_CONFIG_KEYS, ['title'], [], report)
	if (object === null)
		return
	if (Object.hasOwn(object, 'title'))
		checkText(object.title, ['title'], report)
	if (Object.hasOwn(object, 'startStep') && !(Number.isInteger(object.startStep) && (object.startStep as number) >= 0))
		report({ message: 'config.startStep must be a whole number from 0 (the first step).', path: ['startStep'], reason: 'out-of-range' })
}

export function checkAccountConfig(input: unknown, report: Report): void {
	const object = checkObject(input, ACCOUNT_CONFIG_KEYS, ['title'], [], report)
	if (object === null)
		return
	if (Object.hasOwn(object, 'title'))
		checkText(object.title, ['title'], report)
	if (!Object.hasOwn(object, 'prefill'))
		return
	const prefill = checkObject(object.prefill, ACCOUNT_PREFILL_KEYS, [], ['prefill'], report)
	if (prefill === null)
		return
	if (Object.hasOwn(prefill, 'name') && typeof prefill.name !== 'string')
		report({ message: 'config.prefill.name must be a string.', path: ['prefill', 'name'], reason: 'invalid-type' })
	if (Object.hasOwn(prefill, 'email') && (typeof prefill.email !== 'string' || (prefill.email !== '' && !isEmail(prefill.email))))
		report({ message: 'config.prefill.email must be empty or an e-mail address such as "sam@example.org".', path: ['prefill', 'email'], reason: 'invalid-email' })
}

export function checkInterestsConfig(input: unknown, report: Report): void {
	const object = checkObject(input, INTERESTS_CONFIG_KEYS, ['title', 'options'], [], report)
	if (object === null)
		return
	if (Object.hasOwn(object, 'title'))
		checkText(object.title, ['title'], report)
	const ids = Object.hasOwn(object, 'options') ? checkEntries(object.options, ['options'], INTEREST_OPTION_KEYS, 'label', report) : []
	if (Object.hasOwn(object, 'minimum')) {
		const minimum = object.minimum
		if (!Number.isInteger(minimum) || (minimum as number) < 0)
			report({ message: 'config.minimum must be a whole number, 0 or more.', path: ['minimum'], reason: 'out-of-range' })
		else if (Object.hasOwn(object, 'options') && Array.isArray(object.options) && (minimum as number) > ids.length)
			report({ message: `config.minimum is ${String(minimum)}, but only ${ids.length} options exist: nobody could complete this step.`, path: ['minimum'], reason: 'out-of-range' })
	}
	if (Object.hasOwn(object, 'preselected'))
		checkIdList(object.preselected, ['preselected'], ids, report)
}

export function checkSafetyConfig(input: unknown, report: Report): void {
	const object = checkObject(input, SAFETY_CONFIG_KEYS, ['title', 'rules'], [], report)
	if (object === null)
		return
	if (Object.hasOwn(object, 'title'))
		checkText(object.title, ['title'], report)
	const ids = Object.hasOwn(object, 'rules') ? checkEntries(object.rules, ['rules'], SAFETY_RULE_KEYS, 'text', report) : []
	if (Object.hasOwn(object, 'acknowledged'))
		checkIdList(object.acknowledged, ['acknowledged'], ids, report)
}

export function checkInductionConfig(input: unknown, report: Report): void {
	const object = checkObject(input, INDUCTION_CONFIG_KEYS, INDUCTION_CONFIG_KEYS, [], report)
	if (object === null)
		return
	if (Object.hasOwn(object, 'title'))
		checkText(object.title, ['title'], report)
	if (Object.hasOwn(object, 'days'))
		checkStringList(object.days, ['days'], isIsoDate, 'invalid-date', 'a real date written YYYY-MM-DD', report)
	if (Object.hasOwn(object, 'times'))
		checkStringList(object.times, ['times'], isTime, 'invalid-time', 'a time written HH:MM', report)
}

// -------------------------------------------------------------------------------------------------
// Resolve (raw config -> resolved config). `null` is the recovery input of a config that failed validation.
// -------------------------------------------------------------------------------------------------

const NO_TEXT: I18nText = { en: '' }

export function resolveOnboardingConfig(raw: OnboardingRawConfig | null): OnboardingConfig {
	return raw === null
		? { title: NO_TEXT, startStep: 0, recovered: true }
		: { title: raw.title, startStep: raw.startStep ?? 0, recovered: false }
}

export function resolveAccountConfig(raw: AccountRawConfig | null): AccountConfig {
	return raw === null
		? { title: NO_TEXT, name: '', email: '', recovered: true }
		: { title: raw.title, name: raw.prefill?.name ?? '', email: raw.prefill?.email ?? '', recovered: false }
}

export function resolveInterestsConfig(raw: InterestsRawConfig | null): InterestsConfig {
	return raw === null
		? { title: NO_TEXT, options: [], minimum: 0, preselected: [], recovered: true }
		: { title: raw.title, options: raw.options, minimum: raw.minimum ?? 1, preselected: raw.preselected ?? [], recovered: false }
}

export function resolveSafetyConfig(raw: SafetyRawConfig | null): SafetyConfig {
	return raw === null
		? { title: NO_TEXT, rules: [], acknowledged: [], recovered: true }
		: { title: raw.title, rules: raw.rules, acknowledged: raw.acknowledged ?? [], recovered: false }
}

export function resolveInductionConfig(raw: InductionRawConfig | null): InductionConfig {
	return raw === null
		? { title: NO_TEXT, days: [], times: [], recovered: true }
		: { title: raw.title, days: raw.days, times: raw.times, recovered: false }
}
