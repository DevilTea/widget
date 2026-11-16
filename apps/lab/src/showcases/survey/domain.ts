/**
 * Survey-form showcase ("Maker Space open day sign-up") domain model: the pure, framework-free helpers
 * that the plugins (`./plugins/`), the config checkers (`./config.ts`) and the evaluation function share.
 * Nothing here touches Core; every function is a plain function of plain JSON values, so it can be
 * tested without a Runtime.
 *
 * The semantic rules a host (a Vue renderer or a backend) must agree on live in the plugins, never in
 * renderers. What is shared lives here:
 * - the condition grammar and its evaluation (`evaluateCondition`) and the question ids it names
 *   (`conditionTargets`), which the plugins lower into declared dependencies on another question's
 *   `value` Property;
 * - text in the survey's active language (`pickText`, `surveyText`) and the built-in answer error
 *   messages (`builtinError`, `ruleErrors`), in `en` and `zh-TW`;
 * - the value shapes that cross Property boundaries (`AnswerValue`, `AnswerError`, `SurveyResponse`)
 *   with their guards.
 *
 * A hidden question has no value: its effective answer is `null`, which every operator treats as
 * "unanswered" (see `evaluateCondition`).
 */

// -------------------------------------------------------------------------------------------------
// Languages and question types
// -------------------------------------------------------------------------------------------------

/** The languages the built-in messages cover. A survey's `languages` must be a subset, first = default. */
export const SUPPORTED_LANGUAGES = ['en', 'zh-TW'] as const
export type SupportedLanguage = typeof SUPPORTED_LANGUAGES[number]

/** The language's name in that language, for a language switch. */
const LANGUAGE_ENDONYMS: Readonly<Record<SupportedLanguage, string>> = {
	'en': 'English',
	'zh-TW': '繁體中文',
}

export const QUESTION_TYPES = ['ShortAnswer', 'SingleChoice', 'MultipleChoice', 'Numeric'] as const
export type QuestionType = typeof QUESTION_TYPES[number]

export function isQuestionType(input: unknown): input is QuestionType {
	return typeof input === 'string' && (QUESTION_TYPES as readonly string[]).includes(input)
}

export function isSupportedLanguage(input: unknown): input is SupportedLanguage {
	return typeof input === 'string' && (SUPPORTED_LANGUAGES as readonly string[]).includes(input)
}

// -------------------------------------------------------------------------------------------------
// Authored value types (these appear inside raw plugin config, so they must stay JSON-domain friendly)
// -------------------------------------------------------------------------------------------------
//
// `Condition`, `LeafCondition`, `Rule` and `I18nText` are deliberately *type aliases without optional
// properties*: Core's `.interfaces<>()` JSON-domain check stops at `[Value] extends [JsonValue]`, and an
// alias of this shape satisfies it without recursing into the (recursive) `Condition`. `OptionConfig`
// has optional properties; it is only ever used as a property type inside a raw config, where Core
// handles optional keys itself.

/** Text per language: `{ "en": "...", "zh-TW": "..." }`. Must contain every language of the survey. */
export interface I18nText { readonly [language: string]: string }

export type LeafCondition
	= | { readonly question: string, readonly op: 'answered' | 'unanswered' }
		| { readonly question: string, readonly op: 'equals' | 'notEquals', readonly value: string | number }
		| { readonly question: string, readonly op: 'greaterThan' | 'lessThan', readonly value: number }
		| { readonly question: string, readonly op: 'includes' | 'excludes', readonly value: string }

export type Condition
	= | LeafCondition
		| { readonly all: readonly Condition[] }
		| { readonly any: readonly Condition[] }
		| { readonly not: Condition }

/** A custom answer error: when `when` holds on a visible question, `message` is one of its `errors`. */
export interface Rule { readonly when: Condition, readonly message: I18nText }

/** An option of a choice question. Options are config, not widgets. */
export interface OptionConfig {
	readonly value: string
	readonly label: I18nText
	readonly visibleWhen?: Condition
	readonly enabledWhen?: Condition
}

/** Operators that take no `value`. */
export const ANSWER_OPS = ['answered', 'unanswered'] as const
/** Operators comparing the answer with a string or number. */
export const EQUALITY_OPS = ['equals', 'notEquals'] as const
/** Operators comparing a numeric answer with a number. */
export const ORDER_OPS = ['greaterThan', 'lessThan'] as const
/** Operators testing whether a multiple-choice answer holds a string. */
export const MEMBERSHIP_OPS = ['includes', 'excludes'] as const

export type ConditionOp = typeof ANSWER_OPS[number] | typeof EQUALITY_OPS[number] | typeof ORDER_OPS[number] | typeof MEMBERSHIP_OPS[number]

// -------------------------------------------------------------------------------------------------
// Runtime value types (Property values and State)
// -------------------------------------------------------------------------------------------------

/** A question's effective answer: `null` while hidden or unanswered. */
export type AnswerValue = string | number | readonly string[] | null

/** One answer error. `rule` is the index of the custom rule that produced it, for `code: 'rule'`. */
export interface AnswerError { readonly code: string, readonly message: string, readonly rule?: number }

export interface OptionText { readonly value: string, readonly label: string }

/** A question's label, help and option labels in the active language. `options` is empty for non-choices. */
export interface QuestionText {
	readonly label: string
	readonly help: string | null
	readonly options: readonly OptionText[]
}

export interface OptionState { readonly value: string, readonly visible: boolean, readonly enabled: boolean }

/** What a host reads per question: the four fixed members. */
export interface QuestionOutcome {
	readonly visible: boolean
	readonly required: boolean
	readonly value: AnswerValue
	readonly errors: readonly AnswerError[]
}

export interface SurveyResponse {
	readonly language: string
	readonly answers: { readonly [questionId: string]: QuestionOutcome }
}

export interface LanguageName { readonly code: string, readonly name: string }

/** The survey's own chrome text in the active language, so the form never mixes languages. */
export interface SurveyText {
	readonly title: string
	readonly submit: string
	readonly submitted: string
	readonly changedSinceSubmit: string
	readonly blocked: string
	/** The survey's languages with their endonyms, for a language switch. */
	readonly languages: readonly LanguageName[]
}

// -------------------------------------------------------------------------------------------------
// Guards
// -------------------------------------------------------------------------------------------------

export function isPlainObject(input: unknown): input is Record<string, unknown> {
	if (typeof input !== 'object' || input === null || Array.isArray(input))
		return false
	const prototype = Object.getPrototypeOf(input)
	return prototype === Object.prototype || prototype === null
}

function isStringArray(input: unknown): input is readonly string[] {
	return Array.isArray(input) && input.every(item => typeof item === 'string')
}

export function isAnswerValue(input: unknown): input is AnswerValue {
	return input === null || typeof input === 'string' || (typeof input === 'number' && Number.isFinite(input)) || isStringArray(input)
}

function isAnswerError(input: unknown): input is AnswerError {
	return isPlainObject(input)
		&& typeof input.code === 'string'
		&& typeof input.message === 'string'
		&& (input.rule === undefined || (typeof input.rule === 'number' && Number.isInteger(input.rule)))
}

export function isAnswerErrors(input: unknown): input is readonly AnswerError[] {
	return Array.isArray(input) && input.every(isAnswerError)
}

function isQuestionOutcome(input: unknown): input is QuestionOutcome {
	return isPlainObject(input)
		&& typeof input.visible === 'boolean'
		&& typeof input.required === 'boolean'
		&& isAnswerValue(input.value)
		&& isAnswerErrors(input.errors)
}

export function isSurveyResponse(input: unknown): input is SurveyResponse {
	return isPlainObject(input)
		&& typeof input.language === 'string'
		&& isPlainObject(input.answers)
		&& Object.values(input.answers)
			.every(isQuestionOutcome)
}

// -------------------------------------------------------------------------------------------------
// Conditions
// -------------------------------------------------------------------------------------------------

/** Distinct question ids a condition reads, in first-use order. `null` reads nothing. */
export function conditionTargets(condition: Condition | null, into = new Set<string>()): Set<string> {
	if (condition === null)
		return into
	if ('question' in condition)
		into.add(condition.question)
	else if ('all' in condition)
		condition.all.forEach(item => conditionTargets(item, into))
	else if ('any' in condition)
		condition.any.forEach(item => conditionTargets(item, into))
	else
		conditionTargets(condition.not, into)
	return into
}

/**
 * Evaluates a condition against the effective answers (`read(questionId)`). A hidden or unanswered
 * question reads as `null`: `answered`, `equals`, `greaterThan`, `lessThan` and `includes` are false for
 * it; `unanswered`, `notEquals` and `excludes` are true. An operator applied to an answer of another
 * shape (`greaterThan` on a string, `includes` on a number) is false, except `excludes`, which is true.
 */
export function evaluateCondition(condition: Condition, read: (questionId: string) => AnswerValue): boolean {
	if ('all' in condition)
		return condition.all.every(item => evaluateCondition(item, read))
	if ('any' in condition)
		return condition.any.some(item => evaluateCondition(item, read))
	if ('not' in condition)
		return !evaluateCondition(condition.not, read)
	const value = read(condition.question)
	switch (condition.op) {
		case 'answered': return value !== null
		case 'unanswered': return value === null
		case 'equals': return value === condition.value
		case 'notEquals': return value !== condition.value
		case 'greaterThan': return typeof value === 'number' && value > condition.value
		case 'lessThan': return typeof value === 'number' && value < condition.value
		case 'includes': return Array.isArray(value) && value.includes(condition.value)
		case 'excludes': return !Array.isArray(value) || !value.includes(condition.value)
	}
}

/** A path inside a config value, as used by diagnostics: `['visibleWhen', 'all', 1]`. */
export type ConfigPath = readonly (string | number)[]

export interface ConditionLeaf { readonly path: ConfigPath, readonly leaf: LeafCondition }

/**
 * Every leaf of a condition with its config path, in document order. `path` is the path of `condition`
 * itself (for example `['visibleWhen']`), so a leaf under its second `all` entry is at
 * `['visibleWhen', 'all', 1]`. Structure diagnostics put this path in their message.
 */
export function conditionLeaves(condition: Condition, path: ConfigPath): ConditionLeaf[] {
	if ('question' in condition)
		return [{ path, leaf: condition }]
	if ('all' in condition)
		return condition.all.flatMap((item, index) => conditionLeaves(item, [...path, 'all', index]))
	if ('any' in condition)
		return condition.any.flatMap((item, index) => conditionLeaves(item, [...path, 'any', index]))
	return conditionLeaves(condition.not, [...path, 'not'])
}

/** `['options', 2, 'label']` -> `options[2].label`, for messages. */
export function formatConfigPath(path: ConfigPath): string {
	return path.reduce<string>((text, segment) => typeof segment === 'number'
		? `${text}[${segment}]`
		: text === '' ? segment : `${text}.${segment}`, '')
}

// -------------------------------------------------------------------------------------------------
// Text and messages
// -------------------------------------------------------------------------------------------------

/**
 * `text[language]`, or `''` when the survey language has no text. Translations are required to be
 * complete (a structure diagnostic), so there is no fallback to another language. Only own keys count,
 * so a language such as `constructor` never reads an inherited member.
 */
export function pickText(text: I18nText, language: string): string {
	return Object.hasOwn(text, language) && typeof text[language] === 'string' ? text[language] : ''
}

/** Every built-in answer error code. Custom rules use the code `rule`. */
export const BUILTIN_ERROR_CODES = ['required', 'min', 'max', 'integer', 'max-length', 'min-selected', 'max-selected', 'invalid-option'] as const
export type BuiltinErrorCode = typeof BUILTIN_ERROR_CODES[number]

/** `{min}`-style parameters are replaced by `builtinError`. */
export const BUILTIN_MESSAGES: Readonly<Record<SupportedLanguage, Readonly<Record<BuiltinErrorCode, string>>>> = {
	'en': {
		'required': 'This question is required.',
		'min': 'Must be at least {min}.',
		'max': 'Must be at most {max}.',
		'integer': 'Must be a whole number.',
		'max-length': 'Must be at most {max} characters.',
		'min-selected': 'Select at least {min}.',
		'max-selected': 'Select at most {max}.',
		'invalid-option': 'The selected option is not available.',
	},
	'zh-TW': {
		'required': '此題為必填。',
		'min': '不可小於 {min}。',
		'max': '不可大於 {max}。',
		'integer': '請輸入整數。',
		'max-length': '最多 {max} 個字元。',
		'min-selected': '至少選擇 {min} 項。',
		'max-selected': '最多選擇 {max} 項。',
		'invalid-option': '所選的選項目前無法使用。',
	},
}

const DEFAULT_LANGUAGE: SupportedLanguage = 'en'

/** The catalog for a language, falling back to English for a language the catalogs do not cover. */
function catalogFor<Catalog>(catalogs: Readonly<Record<SupportedLanguage, Catalog>>, language: string): Catalog {
	return isSupportedLanguage(language) ? catalogs[language] : catalogs[DEFAULT_LANGUAGE]
}

/** A built-in answer error in `language`; `{name}` placeholders are replaced from `params`. */
export function builtinError(code: BuiltinErrorCode, language: string, params: Readonly<Record<string, number>> = {}): AnswerError {
	const template = catalogFor(BUILTIN_MESSAGES, language)[code]
	const message = template.replace(/\{(\w+)\}/g, (placeholder, name: string) => Object.hasOwn(params, name) ? String(params[name]) : placeholder)
	return { code, message }
}

/**
 * The custom errors of a question: one `{ code: 'rule', message, rule: index }` per rule whose `when`
 * holds, in rule order. The caller decides whether the question is visible (a hidden one has no errors).
 */
export function ruleErrors(rules: readonly Rule[], read: (questionId: string) => AnswerValue, language: string): AnswerError[] {
	return rules.flatMap((rule, index) => evaluateCondition(rule.when, read)
		? [{ code: 'rule', message: pickText(rule.message, language), rule: index }]
		: [])
}

const SURVEY_CHROME: Readonly<Record<SupportedLanguage, Omit<SurveyText, 'title' | 'languages'>>> = {
	'en': {
		submit: 'Submit',
		submitted: 'Submitted',
		changedSinceSubmit: 'Answers changed since you submitted',
		blocked: 'Some answers have errors. Fix them before submitting.',
	},
	'zh-TW': {
		submit: '送出',
		submitted: '已送出',
		changedSinceSubmit: '送出後答案已變更',
		blocked: '部分答案有錯誤，請修正後再送出。',
	},
}

/** The survey's title and chrome in `language`, plus its languages with their endonyms. */
export function surveyText(config: { readonly title: I18nText, readonly languages: readonly string[] }, language: string): SurveyText {
	return {
		title: pickText(config.title, language),
		...catalogFor(SURVEY_CHROME, language),
		languages: config.languages.map(code => ({ code, name: isSupportedLanguage(code) ? LANGUAGE_ENDONYMS[code] : code })),
	}
}

// -------------------------------------------------------------------------------------------------
// Comparing answers
// -------------------------------------------------------------------------------------------------

/** JSON equality of two effective answers; arrays compare by element, in order. */
export function sameAnswerValue(a: AnswerValue, b: AnswerValue): boolean {
	if (Array.isArray(a) || Array.isArray(b))
		return Array.isArray(a) && Array.isArray(b) && a.length === b.length && a.every((item, index) => item === b[index])
	return a === b
}

/**
 * Whether two responses hold the same effective `value` for every question. Language, visibility,
 * requiredness and error messages are ignored; a question present in only one response counts as a
 * difference. Used to tell whether the live response moved since the submitted snapshot.
 */
export function sameAnswerValues(a: SurveyResponse, b: SurveyResponse): boolean {
	const idsA = Object.keys(a.answers)
	const idsB = Object.keys(b.answers)
	return idsA.length === idsB.length
		&& idsA.every(id => Object.hasOwn(b.answers, id) && sameAnswerValue(a.answers[id]!.value, b.answers[id]!.value))
}
