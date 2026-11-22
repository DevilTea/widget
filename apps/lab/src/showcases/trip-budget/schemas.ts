/**
 * Draft 2020-12 JSON Schemas for the trip-budget plugins' configs. They are passive authoring metadata
 * (handed to the Lab by plugin type as `tripBudgetConfigSchemas`; Core 0.3 carries no config schema): Core never validates
 * against them, and the Catalog and AI context show them. They state
 * shape* only; the compiler enforces the rest and reports it as located diagnostics:
 * - the percentages of a percent split add up to 100;
 * - `paidBy` and every participant name a Person of the same trip;
 * - the trip has exactly one Currency, and every widget sits in the right slot of a Trip;
 * - no Property loop (`property-evaluation-cycle`).
 *
 * A unit test pins that each schema's top-level `properties` equal the key lists of `./config.ts`.
 */

import type { ConfigJsonSchema, ConfigSchemaMap } from '../../showcase-host'
import { CONFIG_JSON_SCHEMA_DIALECT } from '../../showcase-host'
import { CURRENCY_CODE_PATTERN, PERSON_ID_PATTERN, ROUND_STEPS } from './domain'

const I18nTextSchema = {
	type: 'object',
	required: ['en'],
	additionalProperties: { type: 'string' },
	description: 'Text per language, such as { "en": "Hotel", "zh-TW": "旅館" }. "en" is required; a missing language falls back to it. The trip offers en and zh-TW.',
} as const satisfies ConfigJsonSchema

const currencyCode = {
	type: 'string',
	pattern: CURRENCY_CODE_PATTERN.source,
	description: 'A three-letter capital currency code such as "EUR".',
} as const satisfies ConfigJsonSchema

const personId = {
	type: 'string',
	pattern: PERSON_ID_PATTERN.source,
	description: 'The widget id of a Person in the same trip (lowercase letters, digits and "-").',
} as const satisfies ConfigJsonSchema

export const tripConfigSchema = {
	$schema: CONFIG_JSON_SCHEMA_DIALECT,
	type: 'object',
	additionalProperties: false,
	required: ['title'],
	properties: {
		title: { ...I18nTextSchema, description: 'The trip title. "en" is required; "zh-TW" is optional.' },
	},
} as const satisfies ConfigJsonSchema

export const personConfigSchema = {
	$schema: CONFIG_JSON_SCHEMA_DIALECT,
	type: 'object',
	additionalProperties: false,
	required: ['name'],
	properties: {
		name: { type: 'string', minLength: 1, description: 'The name shown for this person. The widget id (not the name) is what expenses refer to.' },
	},
} as const satisfies ConfigJsonSchema

export const currencyConfigSchema = {
	$schema: CONFIG_JSON_SCHEMA_DIALECT,
	type: 'object',
	additionalProperties: false,
	required: ['base', 'rates'],
	properties: {
		base: { ...currencyCode, description: 'The currency the settlement is computed and shown in. It is always worth 1 and must not appear in "rates".' },
		rates: {
			type: 'object',
			propertyNames: { pattern: CURRENCY_CODE_PATTERN.source },
			additionalProperties: { type: 'number', exclusiveMinimum: 0 },
			description: 'How many base-currency units one unit of each other currency is worth, such as { "USD": 0.92 }. An expense in a currency that is neither the base nor listed here cannot be converted: the conversion Method fails and the settlement fails with it.',
		},
		roundTransfersTo: {
			enum: [...ROUND_STEPS],
			description: 'The starting "round transfers to" step in minor units: 1 = the cent, 100 = a whole unit, 500 = the nearest 5 units. A viewer can change it; Start over restores this value. Defaults to 1.',
		},
	},
} as const satisfies ConfigJsonSchema

export const expenseConfigSchema = {
	$schema: CONFIG_JSON_SCHEMA_DIALECT,
	type: 'object',
	additionalProperties: false,
	required: ['title', 'amount', 'currency', 'paidBy', 'split'],
	properties: {
		title: { ...I18nTextSchema, description: 'What the money was spent on.' },
		amount: { type: 'number', minimum: 0, description: 'The starting amount, in "currency". A viewer can change the amount, the payer and (for an equal split) who shares; "Reset this expense" restores these starting values.' },
		currency: { ...currencyCode, description: 'The currency of the amount: the Currency widget\'s base or one of its rates.' },
		paidBy: { ...personId, description: 'The Person who paid at the start. It must exist in the same trip.' },
		split: {
			description: 'How the amount is shared. "equal": the people in "among" share it equally (the leftover cents go to the first people listed). "percent": each person in "percents" pays that percentage, and the percentages must add up to 100.',
			oneOf: [
				{
					type: 'object',
					additionalProperties: false,
					required: ['mode', 'among'],
					properties: {
						mode: { const: 'equal' },
						among: { type: 'array', minItems: 1, uniqueItems: true, items: personId, description: 'The people sharing the expense at the start (a viewer can tick and untick them).' },
					},
				},
				{
					type: 'object',
					additionalProperties: false,
					required: ['mode', 'percents'],
					properties: {
						mode: { const: 'percent' },
						percents: {
							type: 'object',
							propertyNames: { pattern: PERSON_ID_PATTERN.source },
							additionalProperties: { type: 'number', minimum: 0, maximum: 100 },
							description: 'Person id -> percentage. The percentages must add up to 100 (the compiler reports a located diagnostic otherwise).',
						},
					},
				},
			],
		},
	},
} as const satisfies ConfigJsonSchema

/** Plugin type to config schema, for the Lab's Catalog and Structure editor. */
export const tripBudgetConfigSchemas = {
	Trip: tripConfigSchema,
	Person: personConfigSchema,
	Currency: currencyConfigSchema,
	Expense: expenseConfigSchema,
} as const satisfies ConfigSchemaMap
