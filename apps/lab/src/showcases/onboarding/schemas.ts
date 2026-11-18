/**
 * Draft 2020-12 JSON Schemas for the onboarding plugins' configs. They are passive authoring metadata
 * (`config.schema`): Core never validates against them, and the Catalog and the Structure editor show them. They state
 * shape only; the config checkers (`./config.ts`) enforce the rest and report it as located diagnostics:
 * - ids are unique within their list, and `preselected`/`acknowledged` name ids of the same list;
 * - `minimum` is not more than the number of options;
 * - every day is a real calendar date, every time is a real time of day.
 *
 * A unit test pins that each schema's top-level `properties` equal the key lists of `./config.ts`.
 */

import type { WidgetConfigJsonSchema } from '@deviltea/widget-core'
import { WIDGET_CONFIG_JSON_SCHEMA_DIALECT } from '@deviltea/widget-core'
import { ISO_DATE_PATTERN, OPTION_ID_PATTERN, TIME_PATTERN } from './domain'

const I18nTextSchema = {
	type: 'object',
	required: ['en'],
	additionalProperties: { type: 'string' },
	description: 'Text per language, such as { "en": "Account", "zh-TW": "帳號" }. "en" is required; a missing language falls back to it. The Preview offers en and zh-TW.',
} as const satisfies WidgetConfigJsonSchema

const optionId = {
	type: 'string',
	pattern: OPTION_ID_PATTERN.source,
	description: 'An id: a lowercase letter, then lowercase letters, digits and "-". Unique within its list.',
} as const satisfies WidgetConfigJsonSchema

export const onboardingConfigSchema = {
	$schema: WIDGET_CONFIG_JSON_SCHEMA_DIALECT,
	type: 'object',
	additionalProperties: false,
	required: ['title'],
	properties: {
		title: { ...I18nTextSchema, description: 'The title of the wizard.' },
		startStep: { type: 'integer', minimum: 0, description: 'The index of the step the wizard opens on, counted from 0. Defaults to 0. Opening on a later step does not make the earlier ones complete: the wizard still lets the visitor go back, and Next and Finish still check the steps.' },
	},
} as const satisfies WidgetConfigJsonSchema

export const accountConfigSchema = {
	$schema: WIDGET_CONFIG_JSON_SCHEMA_DIALECT,
	type: 'object',
	additionalProperties: false,
	required: ['title'],
	properties: {
		title: { ...I18nTextSchema, description: 'The title of the step.' },
		prefill: {
			type: 'object',
			additionalProperties: false,
			properties: {
				name: { type: 'string', description: 'The name filled in at the start.' },
				email: { type: 'string', description: 'The e-mail address filled in at the start (empty or an address).' },
			},
			description: 'Values filled in at the start. A viewer can change them.',
		},
	},
} as const satisfies WidgetConfigJsonSchema

export const interestsConfigSchema = {
	$schema: WIDGET_CONFIG_JSON_SCHEMA_DIALECT,
	type: 'object',
	additionalProperties: false,
	required: ['title', 'options'],
	properties: {
		title: { ...I18nTextSchema, description: 'The title of the step.' },
		options: {
			type: 'array',
			minItems: 1,
			items: {
				type: 'object',
				additionalProperties: false,
				required: ['id', 'label'],
				properties: {
					id: optionId,
					label: { ...I18nTextSchema, description: 'What the visitor reads for this interest.' },
				},
			},
			description: 'The interests the visitor can pick from.',
		},
		minimum: { type: 'integer', minimum: 0, description: 'How many interests the visitor must pick before the step is complete. Defaults to 1; it cannot be more than the number of options.' },
		preselected: { type: 'array', uniqueItems: true, items: optionId, description: 'The ids picked at the start; each must be the id of an option.' },
	},
} as const satisfies WidgetConfigJsonSchema

export const safetyConfigSchema = {
	$schema: WIDGET_CONFIG_JSON_SCHEMA_DIALECT,
	type: 'object',
	additionalProperties: false,
	required: ['title', 'rules'],
	properties: {
		title: { ...I18nTextSchema, description: 'The title of the step.' },
		rules: {
			type: 'array',
			minItems: 1,
			items: {
				type: 'object',
				additionalProperties: false,
				required: ['id', 'text'],
				properties: {
					id: optionId,
					text: { ...I18nTextSchema, description: 'The safety rule the visitor acknowledges.' },
				},
			},
			description: 'The safety rules the visitor must acknowledge, one by one, before the step is complete.',
		},
		acknowledged: { type: 'array', uniqueItems: true, items: optionId, description: 'The ids of the rules acknowledged at the start; each must be the id of a rule.' },
	},
} as const satisfies WidgetConfigJsonSchema

export const inductionConfigSchema = {
	$schema: WIDGET_CONFIG_JSON_SCHEMA_DIALECT,
	type: 'object',
	additionalProperties: false,
	required: ['title', 'days', 'times'],
	properties: {
		title: { ...I18nTextSchema, description: 'The title of the step.' },
		days: {
			type: 'array',
			minItems: 1,
			uniqueItems: true,
			items: { type: 'string', pattern: ISO_DATE_PATTERN.source },
			description: 'The days an induction can be booked, written YYYY-MM-DD. Requesting any other date is an invalid Method call. The Method\'s own checks use this config; whether the booking office still has room is not known here (the host asks it).',
		},
		times: {
			type: 'array',
			minItems: 1,
			uniqueItems: true,
			items: { type: 'string', pattern: TIME_PATTERN.source },
			description: 'The start times offered on each day, written HH:MM.',
		},
	},
} as const satisfies WidgetConfigJsonSchema
