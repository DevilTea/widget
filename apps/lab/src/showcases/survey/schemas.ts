/**
 * Draft 2020-12 JSON Schemas for the survey-form plugins' configs. They are passive authoring metadata
 * (`config.schema`): Core never validates against them, and the Catalog and AI context show them. They
 * state *shape* only; the compiler enforces the rest and reports it as located diagnostics:
 * - the target question of a condition exists, is a question, and has a type the operator fits;
 * - an option value used in a condition exists in the target;
 * - every text covers every language of the survey;
 * - question ids match `^[a-z][a-z0-9-]*$` and sit in a `Survey`;
 * - no condition cycle (`property-evaluation-cycle`).
 *
 * One schema per plugin shares `$defs` (`I18nText`, `Condition`, `Rule`, `Option`). The descriptions are
 * written for a reader that has not seen the code, such as an AI generating a survey: what a field does,
 * and the rule that a hidden question has no value. A unit test pins that each schema's top-level
 * `properties` equal the exported key lists of `./config.ts` and that the `Condition` operator enums
 * equal the operator lists of `./domain.ts`.
 */

import type { WidgetConfigJsonSchema } from '@deviltea/widget-core'
import { WIDGET_CONFIG_JSON_SCHEMA_DIALECT } from '@deviltea/widget-core'
import { ANSWER_OPS, EQUALITY_OPS, MEMBERSHIP_OPS, ORDER_OPS, SUPPORTED_LANGUAGES } from './domain'

const HIDDEN_NOTE = 'A hidden question has no value: every condition reads it as unanswered (answered, equals, greaterThan, lessThan and includes are false; unanswered, notEquals and excludes are true).'

const questionId = {
	type: 'string',
	minLength: 1,
	description: 'The id of another question in the same survey (its widget id). The condition reads that question\'s effective answer. The id must exist. Conditions must not form a loop: if question A\'s "visibleWhen" or an option\'s "visibleWhen"/"enabledWhen" reads question B, then B\'s own "visibleWhen" and options must not read A back, directly or through other questions (the compiler reports a property-evaluation-cycle). A question\'s "visibleWhen" and option conditions must not read the question itself, but its "required" and "rules" may.',
} as const

const I18nTextSchema = {
	type: 'object',
	minProperties: 1,
	additionalProperties: { type: 'string', minLength: 1 },
	description: `Text per language, such as { "en": "...", "zh-TW": "..." }. It must contain every language listed in the Survey's "languages" (${SUPPORTED_LANGUAGES.join(', ')} are supported); a missing language is reported as a located diagnostic.`,
} as const satisfies WidgetConfigJsonSchema

/**
 * `oneOf` has seven mutually exclusive branches: four leaf operator groups (told apart by the `op` enum)
 * and the combinators `all`, `any` and `not` (told apart by their single key).
 */
const ConditionSchema = {
	description: `A condition on other questions' answers: a leaf { "question", "op", "value"? } or a combinator { "all": [...] } (every one holds), { "any": [...] } (at least one holds) or { "not": condition }. ${HIDDEN_NOTE}`,
	oneOf: [
		{
			type: 'object',
			additionalProperties: false,
			required: ['question', 'op'],
			description: 'Leaf without a value: "answered" holds when the question has an effective answer, "unanswered" when it has none (or is hidden).',
			properties: {
				question: questionId,
				op: { enum: [...ANSWER_OPS] },
			},
		},
		{
			type: 'object',
			additionalProperties: false,
			required: ['question', 'op', 'value'],
			description: 'Leaf comparing the answer with a string (a choice option value or short text) or a number (a numeric answer). "equals" is true only for an identical answer; "notEquals" is also true for an unanswered or hidden question.',
			properties: {
				question: questionId,
				op: { enum: [...EQUALITY_OPS] },
				value: { type: ['string', 'number'] },
			},
		},
		{
			type: 'object',
			additionalProperties: false,
			required: ['question', 'op', 'value'],
			description: 'Leaf comparing a numeric answer with a number. Only a Numeric question can satisfy it; it is false for a hidden or unanswered question.',
			properties: {
				question: questionId,
				op: { enum: [...ORDER_OPS] },
				value: { type: 'number' },
			},
		},
		{
			type: 'object',
			additionalProperties: false,
			required: ['question', 'op', 'value'],
			description: 'Leaf testing whether a MultipleChoice answer contains an option value. "value" must be one of that question\'s option values. "excludes" is also true for an unanswered or hidden question.',
			properties: {
				question: questionId,
				op: { enum: [...MEMBERSHIP_OPS] },
				value: { type: 'string' },
			},
		},
		{
			type: 'object',
			additionalProperties: false,
			required: ['all'],
			description: 'Holds when every listed condition holds.',
			properties: {
				all: { type: 'array', minItems: 1, items: { $ref: '#/$defs/Condition' } },
			},
		},
		{
			type: 'object',
			additionalProperties: false,
			required: ['any'],
			description: 'Holds when at least one listed condition holds.',
			properties: {
				any: { type: 'array', minItems: 1, items: { $ref: '#/$defs/Condition' } },
			},
		},
		{
			type: 'object',
			additionalProperties: false,
			required: ['not'],
			description: 'Holds when the inner condition does not hold.',
			properties: {
				not: { $ref: '#/$defs/Condition' },
			},
		},
	],
} as const satisfies WidgetConfigJsonSchema

const RuleSchema = {
	type: 'object',
	additionalProperties: false,
	required: ['when', 'message'],
	description: 'A custom answer error. While the question is visible and "when" holds, the question\'s errors include { code: "rule", message } in the active language. Rules read effective answers, so a rule about a hidden question never fires.',
	properties: {
		when: { $ref: '#/$defs/Condition' },
		message: { $ref: '#/$defs/I18nText' },
	},
} as const satisfies WidgetConfigJsonSchema

const OptionSchema = {
	type: 'object',
	additionalProperties: false,
	required: ['value', 'label'],
	description: 'One option of a choice question. Options are part of the question\'s config, not separate widgets.',
	properties: {
		value: { type: 'string', minLength: 1, description: 'The stored answer for this option. Unique within the question.' },
		label: { $ref: '#/$defs/I18nText' },
		visibleWhen: { $ref: '#/$defs/Condition', description: 'Show the option only while this holds. A selected option that becomes hidden is dropped from the effective answer and reported as an invalid-option error.' },
		enabledWhen: { $ref: '#/$defs/Condition', description: 'Allow choosing the option only while this holds (it is shown disabled otherwise). A selected option that becomes disabled is dropped from the effective answer and reported as an invalid-option error.' },
	},
} as const satisfies WidgetConfigJsonSchema

const SHARED_DEFS = {
	I18nText: I18nTextSchema,
	Condition: ConditionSchema,
	Rule: RuleSchema,
	Option: OptionSchema,
} as const

type DefName = keyof typeof SHARED_DEFS

function defs<const Names extends readonly DefName[]>(...names: Names): { readonly [Name in Names[number]]: typeof SHARED_DEFS[Name] } {
	return Object.fromEntries(names.map(name => [name, SHARED_DEFS[name]])) as never
}

/** The properties every question config shares. */
const questionProperties = {
	label: { $ref: '#/$defs/I18nText', description: 'The question text shown to the respondent, in every survey language.' },
	help: { $ref: '#/$defs/I18nText', description: 'Optional hint under the label, in every survey language.' },
	required: {
		description: 'Whether an answer is required. true or false, or a condition that makes it required only while it holds (for example only for on-site visitors). Defaults to false. Required is reported regardless of visibility, but a hidden question never has errors.',
		oneOf: [{ type: 'boolean' }, { $ref: '#/$defs/Condition' }],
	},
	visibleWhen: { $ref: '#/$defs/Condition', description: `Show the question only while this holds; absent means always visible. ${HIDDEN_NOTE} The stored answer is kept while hidden and returns when the question is shown again.` },
	rules: {
		type: 'array',
		items: { $ref: '#/$defs/Rule' },
		description: 'Custom answer errors beyond the built-in checks.',
	},
} as const satisfies Record<string, WidgetConfigJsonSchema>

function questionSchema<Properties extends Record<string, WidgetConfigJsonSchema>, const Names extends readonly DefName[]>(
	required: readonly string[],
	extra: Properties,
	names: Names,
) {
	return {
		$schema: WIDGET_CONFIG_JSON_SCHEMA_DIALECT,
		type: 'object',
		additionalProperties: false,
		required: [...required],
		properties: { ...questionProperties, ...extra },
		$defs: defs(...names),
	} as const satisfies WidgetConfigJsonSchema
}

const optionsProperty = {
	type: 'array',
	minItems: 1,
	items: { $ref: '#/$defs/Option' },
	description: 'The options in display order. At least one; values must be unique.',
} as const satisfies WidgetConfigJsonSchema

export const shortAnswerConfigSchema = questionSchema(['label'], {
	maxLength: { type: 'integer', minimum: 1, description: 'Maximum number of characters after trimming surrounding whitespace. Longer answers get a max-length error.' },
}, ['I18nText', 'Condition', 'Rule'])

export const singleChoiceConfigSchema = questionSchema(['label', 'options'], {
	options: optionsProperty,
}, ['I18nText', 'Condition', 'Rule', 'Option'])

export const multipleChoiceConfigSchema = questionSchema(['label', 'options'], {
	options: optionsProperty,
	minSelected: { type: 'integer', minimum: 0, description: 'Fewest options that must be selected once the question is answered; at most "maxSelected" and the number of options.' },
	maxSelected: { type: 'integer', minimum: 1, description: 'Most options that may be selected; at least "minSelected" and at most the number of options.' },
}, ['I18nText', 'Condition', 'Rule', 'Option'])

export const numericConfigSchema = questionSchema(['label'], {
	min: { type: 'number', description: 'Smallest allowed answer. A smaller answer gets a min error.' },
	max: { type: 'number', description: 'Largest allowed answer, not below "min". A larger answer gets a max error.' },
	integer: { type: 'boolean', description: 'When true, only whole numbers are allowed. Defaults to false.' },
}, ['I18nText', 'Condition', 'Rule'])

export const surveyConfigSchema = {
	$schema: WIDGET_CONFIG_JSON_SCHEMA_DIALECT,
	type: 'object',
	additionalProperties: false,
	required: ['title', 'languages'],
	properties: {
		title: { $ref: '#/$defs/I18nText', description: 'The survey title in every language listed in "languages".' },
		languages: {
			type: 'array',
			minItems: 1,
			uniqueItems: true,
			items: { enum: [...SUPPORTED_LANGUAGES] },
			description: 'The languages the survey is offered in; the first is the default. Every text in every question must be provided in each of them.',
		},
	},
	$defs: defs('I18nText'),
} as const satisfies WidgetConfigJsonSchema
