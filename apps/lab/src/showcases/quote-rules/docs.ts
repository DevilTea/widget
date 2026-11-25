/**
 * The documentation of the quote-rules plugins' config and value types, written once and referenced from the builders
 * (`defineTypeDocs` + `ref` for a type several members use, `defineFieldDocs` for a config). Core keeps it on
 * `plugin.docs`; the docs generator (`@deviltea/widget-docs-generator`) reads it from there.
 *
 * The raw config descriptions repeat the text of each Valibot schema's `v.description()` (`./schemas.ts`), and state the
 * schema's constraints in words; nothing checks that the two agree, so change both together.
 */

import type { TypeDocs } from '@deviltea/widget-core'
import type { DeliveryConfig, ItemConfig, Paper, QuoteConfig, RushSurchargeConfig, SalesTaxConfig, VolumeDiscountConfig } from './config'
import type { Adjustment, I18nText, ItemLine, QuoteAdjustment, QuoteLine, QuoteResult } from './domain'
import type { DeliveryRawConfig, ItemRawConfig, PaperRawConfig, QuoteRawConfig, RawI18nText, RushSurchargeRawConfig, SalesTaxRawConfig, VolumeDiscountRawConfig, VolumeTierRawConfig } from './raw-config'
import { defineFieldDocs, defineTypeDocs } from '@deviltea/widget-core'

// -------------------------------------------------------------------------------------------------
// Text
// -------------------------------------------------------------------------------------------------

export const rawI18nTextDocs: TypeDocs<RawI18nText> = defineTypeDocs<RawI18nText>('RawI18nText', {
	description: 'Text per language, such as `{ "en": "Flyers", "zh-TW": "傳單" }`. `"en"` is required and at least one character; a missing language falls back to it. The quote offers `en` and `zh-TW`.',
	values: { description: 'The text in the language its key names. The `en` text is the one every other language falls back to.' },
})

export const i18nTextDocs: TypeDocs<I18nText> = defineTypeDocs<I18nText>('I18nText', {
	description: 'Text per language, `{ "en": "Flyers", "zh-TW": "傳單" }`. `en` is required; a missing language falls back to it.',
	values: { description: 'The text in the language its key names. The `en` text is the one every other language falls back to.' },
})

// -------------------------------------------------------------------------------------------------
// Raw configs
// -------------------------------------------------------------------------------------------------

const MINOR_UNITS = 'a whole number of minor units from 0 to 100000000'

export const paperRawConfigDocs: TypeDocs<PaperRawConfig> = defineTypeDocs<PaperRawConfig>('PaperRawConfig', {
	description: 'One paper an Item is offered on.',
	fields: {
		label: { description: 'The paper\'s name.', ref: rawI18nTextDocs },
		extraCents: { description: `What one piece costs more on this paper, in minor units: ${MINOR_UNITS}.` },
	},
})

export const volumeTierRawConfigDocs: TypeDocs<VolumeTierRawConfig> = defineTypeDocs<VolumeTierRawConfig>('VolumeTierRawConfig', {
	description: 'One volume tier of a VolumeDiscount.',
	fields: {
		minQuantity: { description: 'From this total number of pieces on: a whole number from 1 to 100000.' },
		percent: { description: 'The percentage taken off the subtotal, from 0 to 100.' },
	},
})

export const quoteRawConfigDocs = defineFieldDocs<QuoteRawConfig>()({
	description: 'The config of the Quote: its title and currency.',
	fields: {
		title: { description: 'The quote title.', ref: rawI18nTextDocs },
		currency: { description: 'A three-letter capital currency code such as "EUR" (`^[A-Z]{3}$`). Every amount of the quote is in whole minor units (cents) of it.' },
	},
})

export const itemRawConfigDocs = defineFieldDocs<ItemRawConfig>()({
	description: 'The config of an Item: the product, its unit price, the papers on offer and the starting answers.',
	fields: {
		title: { description: 'What is being printed.', ref: rawI18nTextDocs },
		unitCents: { description: `The price of one piece on the cheapest paper, in minor units: ${MINOR_UNITS}.` },
		papers: { description: 'The papers a customer can choose, by code (lowercase letters, digits and "-", starting with a letter: `^[a-z][a-z0-9-]*$`). The option the customer picks is State `paper`; a code that is not listed here makes `line` fail.', values: { ref: paperRawConfigDocs } },
		quantity: { description: 'The starting quantity: a whole number from 1 to 100000. A customer can change it; Start over restores this value. Defaults to 1.' },
		paper: { description: 'The starting paper (a key of "papers", `^[a-z][a-z0-9-]*$`). Defaults to the first one.' },
	},
})

export const volumeDiscountRawConfigDocs = defineFieldDocs<VolumeDiscountRawConfig>()({
	description: 'The config of a VolumeDiscount: its label and the volume tiers.',
	fields: {
		label: { description: 'The name of the discount on the quote.', ref: rawI18nTextDocs },
		tiers: { description: 'Volume tiers, in any order, at least one. The tier with the largest "minQuantity" that the total quantity reaches applies.', items: { ref: volumeTierRawConfigDocs } },
	},
})

export const rushSurchargeRawConfigDocs = defineFieldDocs<RushSurchargeRawConfig>()({
	description: 'The config of a RushSurcharge: its label, the percentage and whether it starts switched on.',
	fields: {
		label: { description: 'The name of the surcharge on the quote.', ref: rawI18nTextDocs },
		percent: { description: 'The percentage of the subtotal added when rush production is on, from 0 to 300.' },
		enabled: { description: 'Whether rush production starts switched on. Defaults to false.' },
	},
})

export const deliveryRawConfigDocs = defineFieldDocs<DeliveryRawConfig>()({
	description: 'The config of a Delivery: its label, the courier fee, the subtotal from which it is free and the starting method.',
	fields: {
		label: { description: 'The name of the delivery line on the quote.', ref: rawI18nTextDocs },
		courierCents: { description: `The courier fee, in minor units: ${MINOR_UNITS}.` },
		freeOverCents: { description: `A subtotal, in minor units, from which courier delivery is free: ${MINOR_UNITS}.` },
		method: { description: 'The starting delivery method: `pickup` or `courier`. Defaults to "pickup".' },
	},
})

export const salesTaxRawConfigDocs = defineFieldDocs<SalesTaxRawConfig>()({
	description: 'The config of a SalesTax: its label and the tax rate.',
	fields: {
		label: { description: 'The name of the tax line on the quote.', ref: rawI18nTextDocs },
		percent: { description: 'The tax rate, from 0 to 100, applied to the subtotal plus every other rule (delivery included).' },
	},
})

// -------------------------------------------------------------------------------------------------
// Resolved configs
// -------------------------------------------------------------------------------------------------

const RECOVERED = { description: '`true` when the config failed validation and these are the harmless empty values of the recovery input.' }

export const paperDocs: TypeDocs<Paper> = defineTypeDocs<Paper>('Paper', {
	description: 'One paper an Item offers, as configured.',
	fields: {
		label: { description: 'The paper\'s name.', ref: i18nTextDocs },
		extraCents: { description: 'What one piece costs more on this paper, in minor units.' },
	},
})

export const quoteConfigDocs = defineFieldDocs<QuoteConfig>()({
	description: 'The resolved config of the Quote.',
	fields: {
		title: { description: 'The quote title; empty text when recovered.', ref: i18nTextDocs },
		currency: { description: 'The currency code, such as `EUR`; `EUR` when recovered.' },
		recovered: RECOVERED,
	},
})

export const itemConfigDocs = defineFieldDocs<ItemConfig>()({
	description: 'The resolved config of an Item: the starting answers have their defaults filled in.',
	fields: {
		title: { description: 'What is being printed.', ref: i18nTextDocs },
		unitCents: { description: 'The price of one piece on the cheapest paper, in minor units.' },
		papers: { description: 'The papers on offer, by code; none when recovered.', values: { ref: paperDocs } },
		quantity: { description: 'The starting quantity: the configured one, or 1.' },
		paper: { description: 'The starting paper: the configured one, or the first paper\'s code (`""` when there is none).' },
		recovered: RECOVERED,
	},
})

export const volumeDiscountConfigDocs = defineFieldDocs<VolumeDiscountConfig>()({
	description: 'The resolved config of a VolumeDiscount.',
	fields: {
		label: { description: 'The name of the discount on the quote.', ref: i18nTextDocs },
		tiers: {
			description: 'The volume tiers, in the order of the document; none when recovered.',
			items: {
				fields: {
					minQuantity: { description: 'From this total number of pieces on.' },
					percent: { description: 'The percentage taken off the subtotal.' },
				},
			},
		},
		recovered: RECOVERED,
	},
})

export const rushSurchargeConfigDocs = defineFieldDocs<RushSurchargeConfig>()({
	description: 'The resolved config of a RushSurcharge.',
	fields: {
		label: { description: 'The name of the surcharge on the quote.', ref: i18nTextDocs },
		percent: { description: 'The percentage of the subtotal added when rush production is on.' },
		enabled: { description: 'Whether rush production starts switched on: the configured value, or `false`.' },
		recovered: RECOVERED,
	},
})

export const deliveryConfigDocs = defineFieldDocs<DeliveryConfig>()({
	description: 'The resolved config of a Delivery.',
	fields: {
		label: { description: 'The name of the delivery line on the quote.', ref: i18nTextDocs },
		courierCents: { description: 'The courier fee, in minor units.' },
		freeOverCents: { description: 'The subtotal, in minor units, from which courier delivery is free, or `null` when it never is.' },
		method: { description: 'The starting delivery method: the configured one, or `pickup`.' },
		recovered: RECOVERED,
	},
})

export const salesTaxConfigDocs = defineFieldDocs<SalesTaxConfig>()({
	description: 'The resolved config of a SalesTax.',
	fields: {
		label: { description: 'The name of the tax line on the quote.', ref: i18nTextDocs },
		percent: { description: 'The tax rate, applied to the subtotal plus every other rule (delivery included).' },
		recovered: RECOVERED,
	},
})

// -------------------------------------------------------------------------------------------------
// Property values
// -------------------------------------------------------------------------------------------------

const adjustmentFields = {
	type: { description: 'The plugin type of the rule that produced it, such as `VolumeDiscount`.' },
	kind: { description: 'What the rule does to the quote: `discount` (VolumeDiscount), `surcharge` (RushSurcharge), `fee` (Delivery) or `tax` (SalesTax).' },
	label: { description: 'The rule\'s name on the quote, its config `label`.', ref: i18nTextDocs },
	applied: { description: '`false` when the rule did not apply to these answers (it still reports `cents: 0`).' },
	percent: { description: 'The percentage the rule used, or `null` for a flat amount or a rule that did not apply.' },
	cents: { description: 'The amount the rule adds to the quote, in minor units; negative for a reduction, 0 when it did not apply.' },
	reason: { description: 'A machine-readable note the renderer translates, or `null`: `free-over-threshold` is a Delivery whose courier fee is waived.' },
} as const

export const adjustmentDocs: TypeDocs<Adjustment> = defineTypeDocs<Adjustment>('Adjustment', {
	description: 'One rule\'s effect on the quote: what its Property `adjustment` returns. Negative `cents` is a reduction.',
	fields: adjustmentFields,
})

const itemLineFields = {
	title: { description: 'What is being printed, the Item\'s config `title`.', ref: i18nTextDocs },
	quantity: { description: 'How many pieces: State `quantity`, or the configured starting quantity while that is unreadable.' },
	paper: { description: 'The code of the chosen paper: State `paper`, or the configured starting paper while that is unreadable.' },
	paperLabel: { description: 'The chosen paper\'s name; the code itself as English text when the Item does not offer that paper.', ref: i18nTextDocs },
	unitCents: { description: 'The price of one piece on this paper, in minor units.' },
	cents: { description: 'The line price, `quantity` times `unitCents`, in minor units.' },
} as const

export const itemLineDocs: TypeDocs<ItemLine> = defineTypeDocs<ItemLine>('ItemLine', {
	description: 'One Item\'s priced line: what its Property `line` returns.',
	fields: itemLineFields,
})

export const quoteLineDocs: TypeDocs<QuoteLine> = defineTypeDocs<QuoteLine>('QuoteLine', {
	description: 'One line of the whole quote: an Item\'s `line` with the id of its widget.',
	fields: { ...itemLineFields, id: { description: 'The id of the Item widget.' } },
})

export const quoteAdjustmentDocs: TypeDocs<QuoteAdjustment> = defineTypeDocs<QuoteAdjustment>('QuoteAdjustment', {
	description: 'One rule of the whole quote: a rule\'s `adjustment` with the id of its widget.',
	fields: { ...adjustmentFields, id: { description: 'The id of the rule widget.' } },
})

export const quoteResultDocs: TypeDocs<QuoteResult> = defineTypeDocs<QuoteResult>('QuoteResult', {
	description: 'The whole quote as plain JSON: the Quote widget\'s Property `quote`, and what the worker returns.',
	fields: {
		currency: { description: 'The quote\'s currency code, such as `EUR`: every amount is in its minor units.' },
		lines: { description: 'The Items\' lines, in document order. An Item whose line cannot be read is left out.', items: { ref: quoteLineDocs } },
		adjustments: { description: 'The rules\' adjustments, in document order, the tax included. A rule whose adjustment cannot be read is left out.', items: { ref: quoteAdjustmentDocs } },
		subtotalCents: { description: 'What the Items\' lines add up to, in minor units.' },
		taxableCents: { description: 'The amount the tax applies to: the subtotal plus every rule that is not the tax.' },
		totalCents: { description: 'What the customer pays: `taxableCents` plus the tax, in minor units.' },
	},
})
