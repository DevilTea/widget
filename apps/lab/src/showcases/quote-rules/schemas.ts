/**
 * The schemas of the quote's plugins, written once with Valibot (a Standard Schema v1 library) and used three ways:
 *
 * - the **validator** of every plugin's `config` and of the State a customer writes (`guard()` in
 *   `./standard-schema.ts` turns a schema into the predicate Core takes; the library's own messages become the
 *   Core diagnostics, verbatim);
 * - the **TypeScript types** of the raw configs (`InferInput<...>`, read from the schema's Standard Schema types);
 * - the passive **config JSON Schema** (`config.schema`, Draft 2020-12), read from the same schema object through
 *   Standard JSON Schema (`~standard.jsonSchema`), so the Catalog and the Structure editor offer controls for
 *   exactly what the validator accepts. Valibot exposes it through `toStandardJsonSchema()` from
 *   `@valibot/to-json-schema`, which every config schema below goes through. Core never runs the JSON Schema, and a
 *   refinement it cannot express would be missing from it: JSON-Schema-valid does not imply Widget-valid.
 *
 * Every object is a `strictObject`: the plain object form silently strips unknown keys, so a misspelt key would
 * validate. This is the only file of the showcase that imports the library (the headless evaluation and the Worker
 * bundle it, which is why `./allowed-packages.json` lists both packages).
 *
 * Valibot was chosen over Zod for its size: the quote system is part of the Lab shell's eager bundle (the shell
 * compiles every showcase's documents), and the Core guide measures Valibot at about a tenth of Zod 4 classic.
 *
 * What the schemas deliberately do not say, so that it stays a rule of the plugin and not of the data:
 * - that a paper named by an Item exists (`Item.line` reports `unknown-paper`);
 * - that the discount tiers start at 1 (the buggy-rule preset relies on that gap, see `plugins/volume-discount.ts`).
 */

import type { InferInput } from './standard-schema'
import { toStandardJsonSchema } from '@valibot/to-json-schema'
import * as v from 'valibot'
import { CURRENCY_CODE_PATTERN, MAX_CENTS, MAX_QUANTITY, PAPER_CODE_PATTERN } from './domain'
import { jsonSchemaOf } from './standard-schema'

/** `description` is what the Catalog and the Structure editor show next to the field. */
function described<Schema extends v.GenericSchema>(schema: Schema, description: string) {
	return v.pipe(schema, v.description(description))
}

const TEXT_DESCRIPTION = 'Text per language, such as { "en": "Flyers", "zh-TW": "傳單" }. "en" is required; a missing language falls back to it. The quote offers en and zh-TW.'

function text(description: string = TEXT_DESCRIPTION) {
	return described(v.objectWithRest({ en: v.pipe(v.string(), v.minLength(1)) }, v.string()), description)
}

function cents(description: string) {
	return described(v.pipe(v.number(), v.integer(), v.minValue(0), v.maxValue(MAX_CENTS)), description)
}

function percent(description: string, max = 100) {
	return described(v.pipe(v.number(), v.minValue(0), v.maxValue(max)), description)
}

const paperCode = v.pipe(v.string(), v.regex(PAPER_CODE_PATTERN))

// ---------------------------------------------------------------------------------------------------------
// Config

export const quoteConfigSchema = toStandardJsonSchema(v.strictObject({
	title: text('The quote title.'),
	currency: described(v.pipe(v.string(), v.regex(CURRENCY_CODE_PATTERN)), 'A three-letter capital currency code such as "EUR". Every amount of the quote is in whole minor units (cents) of it.'),
}))

export const itemConfigSchema = toStandardJsonSchema(v.strictObject({
	title: text('What is being printed.'),
	unitCents: cents('The price of one piece on the cheapest paper, in minor units.'),
	papers: described(v.record(paperCode, v.strictObject({
		label: text('The paper\'s name.'),
		extraCents: cents('What one piece costs more on this paper, in minor units.'),
	})), 'The papers a customer can choose, by code (lowercase letters, digits and "-"). The option the customer picks is State `paper`; a code that is not listed here makes `line` fail.'),
	quantity: v.optional(described(v.pipe(v.number(), v.integer(), v.minValue(1), v.maxValue(MAX_QUANTITY)), 'The starting quantity. A customer can change it; Start over restores this value. Defaults to 1.')),
	paper: v.optional(described(paperCode, 'The starting paper (a key of "papers"). Defaults to the first one.')),
}))

export const volumeDiscountConfigSchema = toStandardJsonSchema(v.strictObject({
	label: text('The name of the discount on the quote.'),
	tiers: described(v.pipe(v.array(v.strictObject({
		minQuantity: described(v.pipe(v.number(), v.integer(), v.minValue(1), v.maxValue(MAX_QUANTITY)), 'From this total number of pieces on.'),
		percent: percent('The percentage taken off the subtotal.'),
	})), v.minLength(1)), 'Volume tiers in ascending order of "minQuantity". The tier with the largest "minQuantity" that the total quantity reaches applies.'),
}))

export const rushSurchargeConfigSchema = toStandardJsonSchema(v.strictObject({
	label: text('The name of the surcharge on the quote.'),
	percent: percent('The percentage of the subtotal added when rush production is on.', 300),
	enabled: v.optional(described(v.boolean(), 'Whether rush production starts switched on. Defaults to false.')),
}))

export const deliveryConfigSchema = toStandardJsonSchema(v.strictObject({
	label: text('The name of the delivery line on the quote.'),
	courierCents: cents('The courier fee, in minor units.'),
	freeOverCents: v.optional(cents('A subtotal, in minor units, from which courier delivery is free.')),
	method: v.optional(described(v.picklist(['pickup', 'courier']), 'The starting delivery method. Defaults to "pickup".')),
}))

export const salesTaxConfigSchema = toStandardJsonSchema(v.strictObject({
	label: text('The name of the tax line on the quote.'),
	percent: percent('The tax rate, applied to the subtotal plus every other rule (delivery included).'),
}))

export type QuoteRawConfig = InferInput<typeof quoteConfigSchema>
export type ItemRawConfig = InferInput<typeof itemConfigSchema>
export type VolumeDiscountRawConfig = InferInput<typeof volumeDiscountConfigSchema>
export type RushSurchargeRawConfig = InferInput<typeof rushSurchargeConfigSchema>
export type DeliveryRawConfig = InferInput<typeof deliveryConfigSchema>
export type SalesTaxRawConfig = InferInput<typeof salesTaxConfigSchema>

// ---------------------------------------------------------------------------------------------------------
// State a customer writes

export const quantitySchema = v.pipe(v.number(), v.integer(), v.minValue(1), v.maxValue(MAX_QUANTITY))

export const paperSchema = v.pipe(v.string(), v.minLength(1))

export const enabledSchema = v.boolean()

export const deliveryMethodSchema = v.picklist(['pickup', 'courier'])

// ---------------------------------------------------------------------------------------------------------
// Config JSON Schemas, from the very same objects

export const quoteConfigJsonSchema = jsonSchemaOf(quoteConfigSchema)
export const itemConfigJsonSchema = jsonSchemaOf(itemConfigSchema)
export const volumeDiscountConfigJsonSchema = jsonSchemaOf(volumeDiscountConfigSchema)
export const rushSurchargeConfigJsonSchema = jsonSchemaOf(rushSurchargeConfigSchema)
export const deliveryConfigJsonSchema = jsonSchemaOf(deliveryConfigSchema)
export const salesTaxConfigJsonSchema = jsonSchemaOf(salesTaxConfigSchema)
