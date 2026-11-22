/**
 * Config checkers and `resolve` helpers for the survey-form plugins.
 *
 * Each plugin's `config.validate` calls its checker with Core's `ctx.addDiagnostic`, so a bad config is
 * an `invalid-widget-config` diagnostic with an exact config `path` and a machine-readable `reason`
 * (see `ConfigReason`). Checkers are collectors, not predicates: they report every problem they find,
 * and the plugin decides validity from `ctx.hasAnyDiagnostic()`. Unknown keys are rejected (the typical
 * AI typo is `visibleIf` for `visibleWhen`).
 *
 * What a checker cannot see is another widget: whether a condition's target exists, has a compatible
 * type, or whether the translations cover the survey's languages is a structure check in the plugins
 * (`plugins/check-question.ts`), because only a structure validator receives the Blueprint.
 *
 * `resolve*` map the raw config to the resolved one. A widget whose config failed validation is compiled
 * with `resolve(null)`; the fallback is marked `recovered: true` so cross-widget checks can skip it.
 * That marker is unambiguous because a question's raw config never admits `null`.
 */

import type { Condition, ConditionLeaf, ConfigPath, I18nText, OptionConfig, Rule, SupportedLanguage } from './domain'
import {
	ANSWER_OPS,
	conditionLeaves,
	EQUALITY_OPS,
	formatConfigPath,
	isPlainObject,
	isSupportedLanguage,
	MEMBERSHIP_OPS,
	ORDER_OPS,
	SUPPORTED_LANGUAGES,
} from './domain'

// -------------------------------------------------------------------------------------------------
// Raw config (what the author writes) and resolved config (what the plugin reads)
// -------------------------------------------------------------------------------------------------

/** What every question's authored config has. */
export interface QuestionRawBase {
	/** The question text shown to the respondent, in every survey language. */
	readonly label: I18nText
	/** Optional hint under the label, in every survey language. */
	readonly help?: I18nText
	/**
	 * Whether an answer is required: true or false, or a condition that makes it required only while it holds. Defaults to
	 * false. Required is reported regardless of visibility, but a hidden question never has errors.
	 */
	readonly required?: boolean | Condition
	/**
	 * Show the question only while this holds; absent means always visible. A hidden question has no value. The stored answer
	 * is kept while hidden and returns when the question is shown again.
	 */
	readonly visibleWhen?: Condition
	/** Custom answer errors beyond the built-in checks. */
	readonly rules?: readonly Rule[]
}

/** The authored config of a ShortAnswer. */
export type ShortAnswerRawConfig = QuestionRawBase & {
	/**
	 * Maximum number of characters after trimming surrounding whitespace. Longer answers get a max-length error.
	 *
	 * @integer
	 * @minimum 1
	 */
	readonly maxLength?: number
}
/** The authored config of a SingleChoice. */
export type SingleChoiceRawConfig = QuestionRawBase & {
	/**
	 * The options in display order. At least one; values must be unique.
	 *
	 * @minItems 1
	 */
	readonly options: readonly OptionConfig[]
}
/** The authored config of a MultipleChoice. */
export type MultipleChoiceRawConfig = QuestionRawBase & {
	/**
	 * The options in display order. At least one; values must be unique.
	 *
	 * @minItems 1
	 */
	readonly options: readonly OptionConfig[]
	/**
	 * Fewest options that must be selected once the question is answered; at most `maxSelected` and the number of options.
	 *
	 * @integer
	 * @minimum 0
	 */
	readonly minSelected?: number
	/**
	 * Most options that may be selected; at least `minSelected` and at most the number of options.
	 *
	 * @integer
	 * @minimum 1
	 */
	readonly maxSelected?: number
}
/** The authored config of a Numeric. */
export type NumericRawConfig = QuestionRawBase & {
	/** Smallest allowed answer. A smaller answer gets a min error. */
	readonly min?: number
	/** Largest allowed answer, not below `min`. A larger answer gets a max error. */
	readonly max?: number
	/** When true, only whole numbers are allowed. Defaults to false. */
	readonly integer?: boolean
}
/** The authored config of a Survey. */
export interface SurveyRawConfig {
	/** The survey title in every language listed in `languages`. */
	readonly title: I18nText
	/**
	 * The languages the survey is offered in; the first is the default. Every text in every question must be provided in each
	 * of them.
	 *
	 * @minItems 1
	 * @uniqueItems
	 */
	readonly languages: readonly SupportedLanguage[]
}

/** An option with its conditions normalized: `null` means "always". */
export interface ResolvedOption {
	readonly value: string
	readonly label: I18nText
	readonly visibleWhen: Condition | null
	readonly enabledWhen: Condition | null
}

export interface QuestionConfigBase {
	readonly label: I18nText
	readonly help: I18nText | null
	readonly required: boolean | Condition
	readonly visibleWhen: Condition | null
	readonly rules: readonly Rule[]
	/** `true` only for the fallback produced by `resolve(null)`: the real config failed validation. */
	readonly recovered: boolean
}

export type ShortAnswerConfig = QuestionConfigBase & { readonly maxLength: number | null }
export type SingleChoiceConfig = QuestionConfigBase & { readonly options: readonly ResolvedOption[] }
export type MultipleChoiceConfig = QuestionConfigBase & {
	readonly options: readonly ResolvedOption[]
	readonly minSelected: number | null
	readonly maxSelected: number | null
}
export type NumericConfig = QuestionConfigBase & {
	readonly min: number | null
	readonly max: number | null
	readonly integer: boolean
}
export interface SurveyConfig {
	readonly title: I18nText
	readonly languages: readonly string[]
	readonly recovered: boolean
}

// -------------------------------------------------------------------------------------------------
// Key lists (the JSON Schemas must declare exactly these properties)
// -------------------------------------------------------------------------------------------------

export const QUESTION_CONFIG_KEYS = ['label', 'help', 'required', 'visibleWhen', 'rules'] as const
export const SHORT_ANSWER_CONFIG_KEYS = [...QUESTION_CONFIG_KEYS, 'maxLength'] as const
export const SINGLE_CHOICE_CONFIG_KEYS = [...QUESTION_CONFIG_KEYS, 'options'] as const
export const MULTIPLE_CHOICE_CONFIG_KEYS = [...QUESTION_CONFIG_KEYS, 'options', 'minSelected', 'maxSelected'] as const
export const NUMERIC_CONFIG_KEYS = [...QUESTION_CONFIG_KEYS, 'min', 'max', 'integer'] as const
export const SURVEY_CONFIG_KEYS = ['title', 'languages'] as const
export const OPTION_KEYS = ['value', 'label', 'visibleWhen', 'enabledWhen'] as const
export const RULE_KEYS = ['when', 'message'] as const

// -------------------------------------------------------------------------------------------------
// Diagnostics
// -------------------------------------------------------------------------------------------------

/** The machine-readable `reason` of a config diagnostic. */
export type ConfigReason
	= | 'not-an-object'
		| 'unknown-key'
		| 'missing-key'
		| 'invalid-type'
		| 'empty-text'
		| 'missing-translation'
		| 'invalid-condition'
		| 'unknown-op'
		| 'invalid-condition-value'
		| 'empty-condition-list'
		| 'empty-options'
		| 'duplicate-option-value'
		| 'out-of-range'
		| 'min-greater-than-max'
		| 'exceeds-options'
		| 'empty-languages'
		| 'duplicate-language'
		| 'unsupported-language'

export interface ConfigDiagnostic {
	readonly message: string
	readonly path?: ConfigPath
	readonly reason?: ConfigReason
}

/** Core's `ctx.addDiagnostic` for a config `validate` callback satisfies this. */
export type AddConfigDiagnostic = (diagnostic: ConfigDiagnostic) => void

/** A config checker: reports every problem with `add`, never throws, returns nothing. */
export type ConfigChecker = (input: unknown, add: AddConfigDiagnostic) => void

function report(add: AddConfigDiagnostic, path: ConfigPath, reason: ConfigReason, message: string): void {
	add({ message: `${formatConfigPath(path) === '' ? 'config' : formatConfigPath(path)}: ${message}`, path, reason })
}

const CONDITION_OPS: readonly string[] = [...ANSWER_OPS, ...EQUALITY_OPS, ...ORDER_OPS, ...MEMBERSHIP_OPS]

// -------------------------------------------------------------------------------------------------
// Building blocks
// -------------------------------------------------------------------------------------------------

/** Rejects every own key of `input` not in `allowed`, at `[...path, key]`. */
function checkKnownKeys(input: Record<string, unknown>, allowed: readonly string[], path: ConfigPath, add: AddConfigDiagnostic): void {
	for (const key of Object.keys(input)) {
		if (!allowed.includes(key))
			report(add, [...path, key], 'unknown-key', `unknown key "${key}"; allowed keys: ${allowed.join(', ')}.`)
	}
}

function checkRequiredKey(input: Record<string, unknown>, key: string, path: ConfigPath, add: AddConfigDiagnostic): boolean {
	if (Object.hasOwn(input, key) && input[key] !== undefined)
		return true
	report(add, [...path, key], 'missing-key', `"${key}" is required.`)
	return false
}

/** A non-empty map of language to non-empty text. */
function checkI18nText(input: unknown, path: ConfigPath, add: AddConfigDiagnostic): input is I18nText {
	if (!isPlainObject(input)) {
		report(add, path, 'invalid-type', 'must be an object mapping a language to its text, such as { "en": "...", "zh-TW": "..." }.')
		return false
	}
	const languages = Object.keys(input)
	if (languages.length === 0) {
		report(add, path, 'empty-text', 'must contain at least one language.')
		return false
	}
	let valid = true
	for (const language of languages) {
		const text = input[language]
		if (typeof text !== 'string') {
			report(add, [...path, language], 'invalid-type', 'must be a string.')
			valid = false
		}
		else if (text === '') {
			report(add, [...path, language], 'empty-text', 'must not be empty.')
			valid = false
		}
	}
	return valid
}

function isFiniteNumber(input: unknown): input is number {
	return typeof input === 'number' && Number.isFinite(input)
}

/** `question` plus `op` plus the `value` that `op` takes. */
function checkLeaf(input: Record<string, unknown>, path: ConfigPath, add: AddConfigDiagnostic): void {
	checkKnownKeys(input, ['question', 'op', 'value'], path, add)
	if (typeof input.question !== 'string' || input.question === '')
		report(add, [...path, 'question'], 'invalid-type', 'must be the id of another question (a non-empty string).')
	if (!Object.hasOwn(input, 'op')) {
		report(add, [...path, 'op'], 'missing-key', `"op" is required; one of ${CONDITION_OPS.join(', ')}.`)
		return
	}
	const op = input.op
	if (typeof op !== 'string' || !CONDITION_OPS.includes(op)) {
		report(add, [...path, 'op'], 'unknown-op', `unknown operator ${JSON.stringify(op)}; use one of ${CONDITION_OPS.join(', ')}.`)
		return
	}
	const hasValue = Object.hasOwn(input, 'value')
	if ((ANSWER_OPS as readonly string[]).includes(op)) {
		if (hasValue)
			report(add, [...path, 'value'], 'invalid-condition-value', `"${op}" takes no "value".`)
	}
	else if ((EQUALITY_OPS as readonly string[]).includes(op)) {
		if (!(typeof input.value === 'string' || isFiniteNumber(input.value)))
			report(add, [...path, 'value'], 'invalid-condition-value', `"${op}" needs a string or number "value".`)
	}
	else if ((ORDER_OPS as readonly string[]).includes(op)) {
		if (!isFiniteNumber(input.value))
			report(add, [...path, 'value'], 'invalid-condition-value', `"${op}" needs a number "value".`)
	}
	else if (typeof input.value !== 'string') {
		report(add, [...path, 'value'], 'invalid-condition-value', `"${op}" needs a string "value" (an option value).`)
	}
}

/**
 * How many levels deep a condition may nest. Core bounds the authored JSON depth (256) but still calls
 * `validate`, so the checker bounds its own recursion: a deeper condition is reported, not descended into,
 * and the checker never throws. `evaluateCondition`, `conditionTargets` and `conditionLeaves` recurse
 * without a bound because they only ever see configs this checker accepted.
 */
export const MAX_CONDITION_DEPTH = 64

const CONDITION_KEYS = ['question', 'op', 'value', 'all', 'any', 'not']

/** A condition: a leaf, or exactly one of `all`, `any`, `not`. `depth` is 1 for the outermost condition. */
function checkCondition(input: unknown, path: ConfigPath, add: AddConfigDiagnostic, depth = 1): void {
	if (depth > MAX_CONDITION_DEPTH) {
		report(add, path, 'invalid-condition', `conditions may nest at most ${MAX_CONDITION_DEPTH} levels deep; simplify this condition.`)
		return
	}
	if (!isPlainObject(input)) {
		report(add, path, 'invalid-condition', 'must be an object: { "question", "op", "value"? } or one of { "all": [...] }, { "any": [...] }, { "not": {...} }.')
		return
	}
	const kinds = ['question', 'all', 'any', 'not'].filter(key => Object.hasOwn(input, key))
	if (kinds.length === 0) {
		// One diagnostic: a misspelled "question" is the usual cause, so name the unknown keys here.
		const unknown = Object.keys(input)
			.filter(key => !CONDITION_KEYS.includes(key))
		report(add, path, 'invalid-condition', `must have exactly one of "question", "all", "any" or "not" (found none${unknown.length === 0
			? ''
			: `; unknown key ${unknown.map(key => `"${key}"`)
				.join(', ')}`}).`)
		return
	}
	if (kinds.length > 1) {
		report(add, path, 'invalid-condition', `must have exactly one of "question", "all", "any" or "not" (found ${kinds.map(kind => `"${kind}"`)
			.join(', ')}).`)
		checkKnownKeys(input, CONDITION_KEYS, path, add)
		return
	}
	const kind = kinds[0]!
	if (kind === 'question') {
		checkLeaf(input, path, add)
		return
	}
	checkKnownKeys(input, [kind], path, add)
	if (kind === 'not') {
		checkCondition(input.not, [...path, 'not'], add, depth + 1)
		return
	}
	const list = input[kind]
	if (!Array.isArray(list)) {
		report(add, [...path, kind], 'invalid-type', 'must be an array of conditions.')
		return
	}
	if (list.length === 0)
		report(add, [...path, kind], 'empty-condition-list', 'must contain at least one condition.')
	list.forEach((item, index) => checkCondition(item, [...path, kind, index], add, depth + 1))
}

function checkOptionalCondition(input: Record<string, unknown>, key: string, path: ConfigPath, add: AddConfigDiagnostic): void {
	if (Object.hasOwn(input, key) && input[key] !== undefined)
		checkCondition(input[key], [...path, key], add)
}

function checkRules(input: unknown, path: ConfigPath, add: AddConfigDiagnostic): void {
	if (!Array.isArray(input)) {
		report(add, path, 'invalid-type', 'must be an array of rules { "when": condition, "message": text }.')
		return
	}
	input.forEach((rule, index) => {
		const rulePath = [...path, index]
		if (!isPlainObject(rule)) {
			report(add, rulePath, 'not-an-object', 'must be an object { "when": condition, "message": text }.')
			return
		}
		checkKnownKeys(rule, RULE_KEYS, rulePath, add)
		if (checkRequiredKey(rule, 'when', rulePath, add))
			checkCondition(rule.when, [...rulePath, 'when'], add)
		if (checkRequiredKey(rule, 'message', rulePath, add))
			checkI18nText(rule.message, [...rulePath, 'message'], add)
	})
}

/** The keys every question shares: `label`, `help`, `required`, `visibleWhen`, `rules`. */
function checkQuestionBase(input: Record<string, unknown>, add: AddConfigDiagnostic): void {
	if (checkRequiredKey(input, 'label', [], add))
		checkI18nText(input.label, ['label'], add)
	if (Object.hasOwn(input, 'help') && input.help !== undefined)
		checkI18nText(input.help, ['help'], add)
	if (Object.hasOwn(input, 'required') && input.required !== undefined && typeof input.required !== 'boolean') {
		if (isPlainObject(input.required))
			checkCondition(input.required, ['required'], add)
		else
			report(add, ['required'], 'invalid-condition', 'must be true, false, or a condition object { "question", "op", "value"? } that makes the question required while it holds.')
	}
	checkOptionalCondition(input, 'visibleWhen', [], add)
	if (Object.hasOwn(input, 'rules') && input.rules !== undefined)
		checkRules(input.rules, ['rules'], add)
}

/** Reports `input` unless it is an object; returns it as one otherwise. */
function asConfigObject(input: unknown, add: AddConfigDiagnostic): Record<string, unknown> | null {
	if (isPlainObject(input))
		return input
	report(add, [], 'not-an-object', 'must be an object.')
	return null
}

/** `options`: a non-empty array of `{ value, label, visibleWhen?, enabledWhen? }` with unique values. */
function checkOptions(input: Record<string, unknown>, add: AddConfigDiagnostic): void {
	if (!checkRequiredKey(input, 'options', [], add))
		return
	const options = input.options
	if (!Array.isArray(options)) {
		report(add, ['options'], 'invalid-type', 'must be an array of options { "value", "label", "visibleWhen"?, "enabledWhen"? }.')
		return
	}
	if (options.length === 0) {
		report(add, ['options'], 'empty-options', 'must contain at least one option.')
		return
	}
	const seen = new Set<string>()
	options.forEach((option, index) => {
		const path: ConfigPath = ['options', index]
		if (!isPlainObject(option)) {
			report(add, path, 'not-an-object', 'must be an object { "value", "label", "visibleWhen"?, "enabledWhen"? }.')
			return
		}
		checkKnownKeys(option, OPTION_KEYS, path, add)
		if (checkRequiredKey(option, 'value', path, add)) {
			if (typeof option.value !== 'string' || option.value === '')
				report(add, [...path, 'value'], 'invalid-type', 'must be a non-empty string.')
			else if (seen.has(option.value))
				report(add, [...path, 'value'], 'duplicate-option-value', `duplicates the value "${option.value}" of an earlier option.`)
			else
				seen.add(option.value)
		}
		if (checkRequiredKey(option, 'label', path, add))
			checkI18nText(option.label, [...path, 'label'], add)
		checkOptionalCondition(option, 'visibleWhen', path, add)
		checkOptionalCondition(option, 'enabledWhen', path, add)
	})
}

type NumberRule = 'number' | 'positive-integer' | 'non-negative-integer'

/** An optional numeric key; returns the number when it is valid so callers can compare bounds. */
function checkOptionalNumber(input: Record<string, unknown>, key: string, rule: NumberRule, add: AddConfigDiagnostic): number | null {
	if (!Object.hasOwn(input, key) || input[key] === undefined)
		return null
	const value = input[key]
	if (!isFiniteNumber(value)) {
		report(add, [key], 'invalid-type', 'must be a number.')
		return null
	}
	if (rule === 'positive-integer' && !(Number.isInteger(value) && value >= 1)) {
		report(add, [key], 'out-of-range', 'must be a positive integer.')
		return null
	}
	if (rule === 'non-negative-integer' && !(Number.isInteger(value) && value >= 0)) {
		report(add, [key], 'out-of-range', 'must be a non-negative integer.')
		return null
	}
	return value
}

// -------------------------------------------------------------------------------------------------
// Per-plugin checkers
// -------------------------------------------------------------------------------------------------

export const checkShortAnswerConfig: ConfigChecker = (input, add) => {
	const config = asConfigObject(input, add)
	if (config === null)
		return
	checkKnownKeys(config, SHORT_ANSWER_CONFIG_KEYS, [], add)
	checkQuestionBase(config, add)
	checkOptionalNumber(config, 'maxLength', 'positive-integer', add)
}

export const checkSingleChoiceConfig: ConfigChecker = (input, add) => {
	const config = asConfigObject(input, add)
	if (config === null)
		return
	checkKnownKeys(config, SINGLE_CHOICE_CONFIG_KEYS, [], add)
	checkQuestionBase(config, add)
	checkOptions(config, add)
}

export const checkMultipleChoiceConfig: ConfigChecker = (input, add) => {
	const config = asConfigObject(input, add)
	if (config === null)
		return
	checkKnownKeys(config, MULTIPLE_CHOICE_CONFIG_KEYS, [], add)
	checkQuestionBase(config, add)
	checkOptions(config, add)
	const minSelected = checkOptionalNumber(config, 'minSelected', 'non-negative-integer', add)
	const maxSelected = checkOptionalNumber(config, 'maxSelected', 'positive-integer', add)
	const optionCount = Array.isArray(config.options) ? config.options.length : null
	if (minSelected !== null && maxSelected !== null && minSelected > maxSelected)
		report(add, ['maxSelected'], 'min-greater-than-max', `must not be less than minSelected (${minSelected}).`)
	if (optionCount !== null && optionCount > 0) {
		if (maxSelected !== null && maxSelected > optionCount)
			report(add, ['maxSelected'], 'exceeds-options', `must not exceed the number of options (${optionCount}).`)
		if (minSelected !== null && minSelected > optionCount)
			report(add, ['minSelected'], 'exceeds-options', `must not exceed the number of options (${optionCount}).`)
	}
}

export const checkNumericConfig: ConfigChecker = (input, add) => {
	const config = asConfigObject(input, add)
	if (config === null)
		return
	checkKnownKeys(config, NUMERIC_CONFIG_KEYS, [], add)
	checkQuestionBase(config, add)
	const min = checkOptionalNumber(config, 'min', 'number', add)
	const max = checkOptionalNumber(config, 'max', 'number', add)
	if (min !== null && max !== null && min > max)
		report(add, ['max'], 'min-greater-than-max', `must not be less than min (${min}).`)
	if (Object.hasOwn(config, 'integer') && config.integer !== undefined && typeof config.integer !== 'boolean')
		report(add, ['integer'], 'invalid-type', 'must be a boolean.')
}

export const checkSurveyConfig: ConfigChecker = (input, add) => {
	const config = asConfigObject(input, add)
	if (config === null)
		return
	checkKnownKeys(config, SURVEY_CONFIG_KEYS, [], add)
	const titleValid = checkRequiredKey(config, 'title', [], add) && checkI18nText(config.title, ['title'], add)
	const languages = checkLanguages(config, add)
	if (titleValid && languages !== null) {
		const title = config.title as I18nText
		for (const language of languages) {
			if (!Object.hasOwn(title, language))
				report(add, ['title', language], 'missing-translation', `the title has no "${language}" text.`)
		}
	}
}

/** `languages`: a non-empty array of unique supported languages. Returns the valid list, or `null`. */
function checkLanguages(config: Record<string, unknown>, add: AddConfigDiagnostic): readonly string[] | null {
	if (!checkRequiredKey(config, 'languages', [], add))
		return null
	const languages = config.languages
	if (!Array.isArray(languages)) {
		report(add, ['languages'], 'invalid-type', `must be an array of languages; supported: ${SUPPORTED_LANGUAGES.join(', ')}.`)
		return null
	}
	if (languages.length === 0) {
		report(add, ['languages'], 'empty-languages', 'must list at least one language; the first is the default.')
		return null
	}
	let valid = true
	const seen = new Set<string>()
	languages.forEach((language, index) => {
		if (typeof language !== 'string') {
			report(add, ['languages', index], 'invalid-type', 'must be a string.')
			valid = false
		}
		else if (!isSupportedLanguage(language)) {
			report(add, ['languages', index], 'unsupported-language', `"${language}" is not supported; use ${SUPPORTED_LANGUAGES.map(supported => `"${supported}"`)
				.join(' or ')}.`)
			valid = false
		}
		else if (seen.has(language)) {
			report(add, ['languages', index], 'duplicate-language', `"${language}" is listed twice.`)
			valid = false
		}
		else {
			seen.add(language)
		}
	})
	return valid ? languages as readonly string[] : null
}

// -------------------------------------------------------------------------------------------------
// resolve
// -------------------------------------------------------------------------------------------------

function resolveBase(raw: QuestionRawBase): QuestionConfigBase {
	return {
		label: raw.label,
		help: raw.help ?? null,
		required: raw.required ?? false,
		visibleWhen: raw.visibleWhen ?? null,
		rules: raw.rules ?? [],
		recovered: false,
	}
}

const RECOVERED_BASE: QuestionConfigBase = { label: {}, help: null, required: false, visibleWhen: null, rules: [], recovered: true }

function resolveOptions(options: readonly OptionConfig[]): readonly ResolvedOption[] {
	return options.map(option => ({
		value: option.value,
		label: option.label,
		visibleWhen: option.visibleWhen ?? null,
		enabledWhen: option.enabledWhen ?? null,
	}))
}

/** `resolve(null)` is only reached for recovery: a question's raw config never admits `null`. */
export function resolveShortAnswerConfig(raw: ShortAnswerRawConfig | null): ShortAnswerConfig {
	return raw === null
		? { ...RECOVERED_BASE, maxLength: null }
		: { ...resolveBase(raw), maxLength: raw.maxLength ?? null }
}

export function resolveSingleChoiceConfig(raw: SingleChoiceRawConfig | null): SingleChoiceConfig {
	return raw === null
		? { ...RECOVERED_BASE, options: [] }
		: { ...resolveBase(raw), options: resolveOptions(raw.options) }
}

export function resolveMultipleChoiceConfig(raw: MultipleChoiceRawConfig | null): MultipleChoiceConfig {
	return raw === null
		? { ...RECOVERED_BASE, options: [], minSelected: null, maxSelected: null }
		: { ...resolveBase(raw), options: resolveOptions(raw.options), minSelected: raw.minSelected ?? null, maxSelected: raw.maxSelected ?? null }
}

export function resolveNumericConfig(raw: NumericRawConfig | null): NumericConfig {
	return raw === null
		? { ...RECOVERED_BASE, min: null, max: null, integer: false }
		: { ...resolveBase(raw), min: raw.min ?? null, max: raw.max ?? null, integer: raw.integer ?? false }
}

export function resolveSurveyConfig(raw: SurveyRawConfig | null): SurveyConfig {
	return raw === null
		? { title: {}, languages: [], recovered: true }
		: { title: raw.title, languages: raw.languages, recovered: false }
}

// -------------------------------------------------------------------------------------------------
// Reading a compile-view node
// -------------------------------------------------------------------------------------------------

function configOf(node: object): Record<string, unknown> | null {
	const config = (node as { readonly config?: unknown }).config
	return isPlainObject(config) ? config : null
}

/**
 * Whether a compile-view node's config is the `resolve(null)` fallback (its real config failed
 * validation). `false` for an unresolved node, a node without config, and a real config.
 */
export function isRecovered(node: object): boolean {
	return configOf(node)?.recovered === true
}

/**
 * The languages of a resolved, non-recovered `Survey` root (first is the default), else `null`: the
 * root is not a Survey, did not resolve, or its config failed validation.
 */
export function surveyLanguagesOf(root: object): readonly string[] | null {
	const candidate = root as { readonly resolved?: unknown, readonly type?: unknown }
	if (candidate.resolved !== true || candidate.type !== 'Survey')
		return null
	const config = configOf(root)
	if (config === null || config.recovered === true || !Array.isArray(config.languages))
		return null
	return config.languages as readonly string[]
}

// -------------------------------------------------------------------------------------------------
// Enumerating a resolved question config (structure checks)
// -------------------------------------------------------------------------------------------------

/** A resolved question config, with `options` when the type has them. */
export type QuestionConfig = QuestionConfigBase & { readonly options?: readonly ResolvedOption[] }

export interface ConfigText { readonly path: ConfigPath, readonly text: I18nText }

/**
 * Every text of a resolved question config with its config path, in document order: `label`, `help`,
 * each `options[i].label`, each `rules[j].message`. Used for `missing-translation`.
 */
export function questionTexts(config: QuestionConfig): ConfigText[] {
	return [
		{ path: ['label'], text: config.label },
		...(config.help === null ? [] : [{ path: ['help'], text: config.help }]),
		...(config.options ?? []).map((option, index) => ({ path: ['options', index, 'label'], text: option.label })),
		...config.rules.map((rule, index) => ({ path: ['rules', index, 'message'], text: rule.message })),
	]
}

/**
 * Every leaf condition of a resolved question config with its config path, in document order:
 * `required` (when it is a condition), `visibleWhen`, each option's `visibleWhen` and `enabledWhen`, and
 * each rule's `when`.
 */
export function questionConditionLeaves(config: QuestionConfig): ConditionLeaf[] {
	return [
		...(typeof config.required === 'boolean' ? [] : conditionLeaves(config.required, ['required'])),
		...(config.visibleWhen === null ? [] : conditionLeaves(config.visibleWhen, ['visibleWhen'])),
		...(config.options ?? []).flatMap((option, index) => [
			...(option.visibleWhen === null ? [] : conditionLeaves(option.visibleWhen, ['options', index, 'visibleWhen'])),
			...(option.enabledWhen === null ? [] : conditionLeaves(option.enabledWhen, ['options', index, 'enabledWhen'])),
		]),
		...config.rules.flatMap((rule, index) => conditionLeaves(rule.when, ['rules', index, 'when'])),
	]
}
