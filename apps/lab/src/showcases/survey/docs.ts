/**
 * The documentation of the survey plugins' config and value types, written once and referenced from the builders
 * (`defineTypeDocs` + `ref` for a type several members use, `defineFieldDocs` for a config). Core keeps it on
 * `plugin.docs`; the docs generator (`@deviltea/widget-docs-generator`) reads it from there.
 */

import type { TypeDocs } from '@deviltea/widget-core'
import type { MultipleChoiceConfig, MultipleChoiceRawConfig, NumericConfig, NumericRawConfig, QuestionConfigBase, QuestionRawBase, ResolvedOption, ShortAnswerConfig, ShortAnswerRawConfig, SingleChoiceConfig, SingleChoiceRawConfig, SurveyConfig, SurveyRawConfig } from './config'
import type { AnswerError, Condition, I18nText, LanguageName, OptionConfig, OptionState, OptionText, QuestionOutcome, QuestionText, Rule, SurveyResponse, SurveyText } from './domain'
import { defineFieldDocs, defineTypeDocs } from '@deviltea/widget-core'

// -------------------------------------------------------------------------------------------------
// Authored value types
// -------------------------------------------------------------------------------------------------

export const i18nTextDocs: TypeDocs<I18nText> = defineTypeDocs<I18nText>('I18nText', {
	description: 'Text per language: `{ "en": "...", "zh-TW": "..." }`. Must contain every language of the survey: at least one entry, each text at least one character.',
})

const QUESTION_ID = 'The id of another question in the same survey (its widget id), whose effective answer the condition reads: at least one character. It must exist, and conditions must not form a loop (`property-evaluation-cycle`). A question\'s `visibleWhen` and option conditions must not read the question itself, but its `required` and `rules` may.'

export const conditionDocs: TypeDocs<Condition> = defineTypeDocs<Condition>('Condition', {
	description: 'A condition on other questions\' answers: a leaf `{ question, op, value? }` or a combinator `{ all }` (every one holds), `{ any }` (at least one holds) or `{ not }`. A hidden question has no value: every condition reads it as unanswered.',
	fields: {
		question: { description: QUESTION_ID },
		op: { description: 'The test on the answer. `answered` holds when the question has an effective answer, `unanswered` when it has none (or is hidden). `equals` is true only for an identical answer; `notEquals` is also true for an unanswered or hidden question. `greaterThan` and `lessThan` compare a numeric answer: only a Numeric question can satisfy them; false for a hidden or unanswered question. `includes` is whether a MultipleChoice answer contains `value`; `excludes` is also true for an unanswered or hidden question.' },
		value: { description: 'What the answer is tested against: for `equals`/`notEquals`, a choice option value or short text, or a number for a numeric answer; for `greaterThan`/`lessThan`, the number the answer is compared with; for `includes`/`excludes`, one of that question\'s option values.' },
		all: { description: 'Holds when every listed condition holds. At least one.', items: { ref: () => conditionDocs } },
		any: { description: 'Holds when at least one listed condition holds. At least one.', items: { ref: () => conditionDocs } },
		not: { description: 'Holds when the inner condition does not hold.', ref: () => conditionDocs },
	},
})

export const ruleDocs: TypeDocs<Rule> = defineTypeDocs<Rule>('Rule', {
	description: 'A custom answer error: when `when` holds on a visible question, `message` is one of its `errors`.',
	fields: {
		when: { description: 'While the question is visible and this holds, the question\'s errors include `{ code: "rule", message }`.', ref: conditionDocs },
		message: { description: 'The error message, in every survey language.', ref: i18nTextDocs },
	},
})

export const optionConfigDocs: TypeDocs<OptionConfig> = defineTypeDocs<OptionConfig>('OptionConfig', {
	description: 'An option of a choice question. Options are config, not widgets.',
	fields: {
		value: { description: 'The stored answer for this option: at least one character. Unique within the question.' },
		label: { description: 'The option text, in every survey language.', ref: i18nTextDocs },
		visibleWhen: { description: 'Show the option only while this holds. A selected option that becomes hidden is dropped from the effective answer and reported as an invalid-option error.', ref: conditionDocs },
		enabledWhen: { description: 'Allow choosing the option only while this holds (it is shown disabled otherwise). A selected option that becomes disabled is dropped from the effective answer and reported as an invalid-option error.', ref: conditionDocs },
	},
})

export const resolvedOptionDocs: TypeDocs<ResolvedOption> = defineTypeDocs<ResolvedOption>('ResolvedOption', {
	description: 'An option with its conditions normalized: `null` means "always".',
	fields: {
		value: { description: 'The stored answer for this option.' },
		label: { description: 'The option text, in every survey language.', ref: i18nTextDocs },
		visibleWhen: { description: 'Show the option only while this holds; `null` means always.', ref: conditionDocs },
		enabledWhen: { description: 'Allow choosing the option only while this holds; `null` means always.', ref: conditionDocs },
	},
})

// -------------------------------------------------------------------------------------------------
// Runtime value types (Property values and State)
// -------------------------------------------------------------------------------------------------

export const answerErrorDocs: TypeDocs<AnswerError> = defineTypeDocs<AnswerError>('AnswerError', {
	description: 'One answer error. `rule` is the index of the custom rule that produced it, for `code: \'rule\'`.',
	fields: {
		code: { description: 'The error code: a built-in check (`required`, `min`, `max`, `integer`, `max-length`, `min-selected`, `max-selected`, `invalid-option`) or `rule`.' },
		message: { description: 'The error message in the active language.' },
		rule: { description: 'For `code: "rule"`, the index of the custom rule that produced it.' },
	},
})

export const optionTextDocs: TypeDocs<OptionText> = defineTypeDocs<OptionText>('OptionText', {
	description: 'An option\'s value and label in the active language.',
	fields: {
		value: { description: 'The stored answer for the option.' },
		label: { description: 'The option label in the active language.' },
	},
})

export const questionTextDocs: TypeDocs<QuestionText> = defineTypeDocs<QuestionText>('QuestionText', {
	description: 'A question\'s label, help and option labels in the active language. `options` is empty for non-choices.',
	fields: {
		label: { description: 'The question text.' },
		help: { description: 'The hint under the label, or `null` for none.' },
		options: { description: 'The option labels, in display order; empty for non-choices.', items: { ref: optionTextDocs } },
	},
})

export const optionStateDocs: TypeDocs<OptionState> = defineTypeDocs<OptionState>('OptionState', {
	description: 'Whether an option is shown and can be chosen now.',
	fields: {
		value: { description: 'The stored answer for the option.' },
		visible: { description: 'Whether its `visibleWhen` holds.' },
		enabled: { description: 'Whether its `enabledWhen` holds.' },
	},
})

export const questionOutcomeDocs: TypeDocs<QuestionOutcome> = defineTypeDocs<QuestionOutcome>('QuestionOutcome', {
	description: 'What a host reads per question: the four fixed members.',
	fields: {
		visible: { description: 'Whether the question is shown.' },
		required: { description: 'Whether an answer is required now.' },
		value: { description: 'The effective answer: `null` while hidden or unanswered.' },
		errors: { description: 'The answer errors; empty for a hidden question.', items: { ref: answerErrorDocs } },
	},
})

export const surveyResponseDocs: TypeDocs<SurveyResponse> = defineTypeDocs<SurveyResponse>('SurveyResponse', {
	description: 'The survey\'s answers as a host submits them.',
	fields: {
		language: { description: 'The active language.' },
		answers: { description: 'Each question\'s outcome, by question id.', values: { ref: questionOutcomeDocs } },
	},
})

export const languageNameDocs: TypeDocs<LanguageName> = defineTypeDocs<LanguageName>('LanguageName', {
	description: 'A survey language with its endonym.',
	fields: {
		code: { description: 'The language code: `en` or `zh-TW`.' },
		name: { description: 'The language\'s name in that language.' },
	},
})

export const surveyTextDocs: TypeDocs<SurveyText> = defineTypeDocs<SurveyText>('SurveyText', {
	description: 'The survey\'s own chrome text in the active language, so the form never mixes languages.',
	fields: {
		title: { description: 'The survey title.' },
		submit: { description: 'The label of the submit button.' },
		submitted: { description: 'The note that the answers were submitted.' },
		changedSinceSubmit: { description: 'The note that the answers changed since they were submitted.' },
		blocked: { description: 'The note that some answers have errors to fix before submitting.' },
		languages: { description: 'The survey\'s languages with their endonyms, for a language switch.', items: { ref: languageNameDocs } },
	},
})

// -------------------------------------------------------------------------------------------------
// Configs
// -------------------------------------------------------------------------------------------------

const questionRawBaseFields = {
	label: { description: 'The question text shown to the respondent, in every survey language.', ref: i18nTextDocs },
	help: { description: 'Optional hint under the label, in every survey language.', ref: i18nTextDocs },
	required: { description: 'Whether an answer is required: true or false, or a condition that makes it required only while it holds. Defaults to false. Required is reported regardless of visibility, but a hidden question never has errors.', ref: conditionDocs },
	visibleWhen: { description: 'Show the question only while this holds; absent means always visible. A hidden question has no value. The stored answer is kept while hidden and returns when the question is shown again.', ref: conditionDocs },
	rules: { description: 'Custom answer errors beyond the built-in checks.', items: { ref: ruleDocs } },
} as const

/** The docs every question's raw config shares, checked against `QuestionRawBase`. */
export const questionRawBaseDocs = defineFieldDocs<QuestionRawBase>()({ fields: questionRawBaseFields })

const OPTIONS = { description: 'The options in display order. At least one; values must be unique.', items: { ref: optionConfigDocs } } as const

export const shortAnswerRawConfigDocs = defineFieldDocs<ShortAnswerRawConfig>()({
	description: 'The authored config of a ShortAnswer.',
	fields: {
		...questionRawBaseFields,
		maxLength: { description: 'Maximum number of characters after trimming surrounding whitespace: a whole number, at least 1. Longer answers get a max-length error.' },
	},
})

export const singleChoiceRawConfigDocs = defineFieldDocs<SingleChoiceRawConfig>()({
	description: 'The authored config of a SingleChoice.',
	fields: { ...questionRawBaseFields, options: OPTIONS },
})

export const multipleChoiceRawConfigDocs = defineFieldDocs<MultipleChoiceRawConfig>()({
	description: 'The authored config of a MultipleChoice.',
	fields: {
		...questionRawBaseFields,
		options: OPTIONS,
		minSelected: { description: 'Fewest options that must be selected once the question is answered, a whole number of at least 0; at most `maxSelected` and the number of options.' },
		maxSelected: { description: 'Most options that may be selected, a whole number of at least 1; at least `minSelected` and at most the number of options.' },
	},
})

export const numericRawConfigDocs = defineFieldDocs<NumericRawConfig>()({
	description: 'The authored config of a Numeric.',
	fields: {
		...questionRawBaseFields,
		min: { description: 'Smallest allowed answer. A smaller answer gets a min error.' },
		max: { description: 'Largest allowed answer, not below `min`. A larger answer gets a max error.' },
		integer: { description: 'When true, only whole numbers are allowed. Defaults to false.' },
	},
})

export const surveyRawConfigDocs = defineFieldDocs<SurveyRawConfig>()({
	description: 'The authored config of a Survey.',
	fields: {
		title: { description: 'The survey title in every language listed in `languages`.', ref: i18nTextDocs },
		languages: { description: 'The languages the survey is offered in, each once (at least one); the first is the default. Every text in every question must be provided in each of them.' },
	},
})

const questionConfigBaseFields = {
	label: { description: 'The question text, in every survey language.', ref: i18nTextDocs },
	help: { description: 'The hint under the label, or `null` for none.', ref: i18nTextDocs },
	required: { description: 'Whether an answer is required, or the condition that makes it required.', ref: conditionDocs },
	visibleWhen: { description: 'Show the question only while this holds; `null` means always visible.', ref: conditionDocs },
	rules: { description: 'Custom answer errors beyond the built-in checks.', items: { ref: ruleDocs } },
	recovered: { description: '`true` only for the fallback produced by `resolve(null)`: the real config failed validation.' },
} as const

/** The docs every question's resolved config shares, checked against `QuestionConfigBase`. */
export const questionConfigBaseDocs = defineFieldDocs<QuestionConfigBase>()({ fields: questionConfigBaseFields })

const RESOLVED_OPTIONS = { description: 'The options in display order, with their conditions normalized.', items: { ref: resolvedOptionDocs } } as const

export const shortAnswerConfigDocs = defineFieldDocs<ShortAnswerConfig>()({
	description: 'The resolved config of a ShortAnswer.',
	fields: { ...questionConfigBaseFields, maxLength: { description: 'Maximum number of characters, or `null` for no limit.' } },
})

export const singleChoiceConfigDocs = defineFieldDocs<SingleChoiceConfig>()({
	description: 'The resolved config of a SingleChoice.',
	fields: { ...questionConfigBaseFields, options: RESOLVED_OPTIONS },
})

export const multipleChoiceConfigDocs = defineFieldDocs<MultipleChoiceConfig>()({
	description: 'The resolved config of a MultipleChoice.',
	fields: {
		...questionConfigBaseFields,
		options: RESOLVED_OPTIONS,
		minSelected: { description: 'Fewest options that must be selected, or `null` for no minimum.' },
		maxSelected: { description: 'Most options that may be selected, or `null` for no maximum.' },
	},
})

export const numericConfigDocs = defineFieldDocs<NumericConfig>()({
	description: 'The resolved config of a Numeric.',
	fields: {
		...questionConfigBaseFields,
		min: { description: 'Smallest allowed answer, or `null` for none.' },
		max: { description: 'Largest allowed answer, or `null` for none.' },
		integer: { description: 'Whether only whole numbers are allowed.' },
	},
})

export const surveyConfigDocs = defineFieldDocs<SurveyConfig>()({
	description: 'The resolved config of a Survey.',
	fields: {
		title: { description: 'The survey title in every survey language.', ref: i18nTextDocs },
		languages: { description: 'The languages the survey is offered in; the first is the default.' },
		recovered: { description: '`true` only for the fallback produced by `resolve(null)`: the real config failed validation.' },
	},
})
