/**
 * Raw config -> resolved config for every plugin. Validation is not here: it is the schema in `./schemas.ts`,
 * run through `guard()`. `resolve` receives `null` when the config failed validation (the recovery input), and
 * every resolved config then carries `recovered: true` with harmless empty values, so the Runtime of a recovered
 * widget still builds.
 */

import type { I18nText } from './domain'
import type { DeliveryRawConfig, ItemRawConfig, QuoteRawConfig, RushSurchargeRawConfig, SalesTaxRawConfig, VolumeDiscountRawConfig } from './raw-config'

const NO_TEXT: I18nText = { en: '' }

/** The resolved config of the Quote. */
export interface QuoteConfig {
	/** The quote title; empty text when recovered. */
	readonly title: I18nText
	/** The currency code, such as `EUR`; `EUR` when recovered. */
	readonly currency: string
	/** `true` when the config failed validation and these are the harmless empty values of the recovery input. */
	readonly recovered: boolean
}

export function resolveQuoteConfig(raw: QuoteRawConfig | null): QuoteConfig {
	return raw === null ? { title: NO_TEXT, currency: 'EUR', recovered: true } : { title: raw.title, currency: raw.currency, recovered: false }
}

/** One paper an Item offers, as configured. */
export interface Paper {
	/** The paper's name. */
	readonly label: I18nText
	/** What one piece costs more on this paper, in minor units. */
	readonly extraCents: number
}

/** The resolved config of an Item: the starting answers have their defaults filled in. */
export interface ItemConfig {
	/** What is being printed. */
	readonly title: I18nText
	/** The price of one piece on the cheapest paper, in minor units. */
	readonly unitCents: number
	/** The papers on offer, by code; none when recovered. */
	readonly papers: Readonly<Record<string, Paper>>
	/** The starting quantity: the configured one, or 1. */
	readonly quantity: number
	/** The starting paper: the configured one, or the first paper's code (`""` when there is none). */
	readonly paper: string
	/** `true` when the config failed validation and these are the harmless empty values of the recovery input. */
	readonly recovered: boolean
}

export function resolveItemConfig(raw: ItemRawConfig | null): ItemConfig {
	if (raw === null)
		return { title: NO_TEXT, unitCents: 0, papers: {}, quantity: 1, paper: '', recovered: true }
	return {
		title: raw.title,
		unitCents: raw.unitCents,
		papers: raw.papers,
		quantity: raw.quantity ?? 1,
		paper: raw.paper ?? Object.keys(raw.papers)[0] ?? '',
		recovered: false,
	}
}

/** The resolved config of a VolumeDiscount. */
export interface VolumeDiscountConfig {
	/** The name of the discount on the quote. */
	readonly label: I18nText
	/** The volume tiers, in the order of the document; none when recovered. */
	readonly tiers: readonly {
		/** From this total number of pieces on. */
		readonly minQuantity: number
		/** The percentage taken off the subtotal. */
		readonly percent: number
	}[]
	/** `true` when the config failed validation and these are the harmless empty values of the recovery input. */
	readonly recovered: boolean
}

export function resolveVolumeDiscountConfig(raw: VolumeDiscountRawConfig | null): VolumeDiscountConfig {
	return raw === null ? { label: NO_TEXT, tiers: [], recovered: true } : { label: raw.label, tiers: raw.tiers, recovered: false }
}

/** The resolved config of a RushSurcharge. */
export interface RushSurchargeConfig {
	/** The name of the surcharge on the quote. */
	readonly label: I18nText
	/** The percentage of the subtotal added when rush production is on. */
	readonly percent: number
	/** Whether rush production starts switched on: the configured value, or `false`. */
	readonly enabled: boolean
	/** `true` when the config failed validation and these are the harmless empty values of the recovery input. */
	readonly recovered: boolean
}

export function resolveRushSurchargeConfig(raw: RushSurchargeRawConfig | null): RushSurchargeConfig {
	return raw === null
		? { label: NO_TEXT, percent: 0, enabled: false, recovered: true }
		: { label: raw.label, percent: raw.percent, enabled: raw.enabled ?? false, recovered: false }
}

/** The resolved config of a Delivery. */
export interface DeliveryConfig {
	/** The name of the delivery line on the quote. */
	readonly label: I18nText
	/** The courier fee, in minor units. */
	readonly courierCents: number
	/** The subtotal, in minor units, from which courier delivery is free, or `null` when it never is. */
	readonly freeOverCents: number | null
	/** The starting delivery method: the configured one, or `pickup`. */
	readonly method: 'pickup' | 'courier'
	/** `true` when the config failed validation and these are the harmless empty values of the recovery input. */
	readonly recovered: boolean
}

export function resolveDeliveryConfig(raw: DeliveryRawConfig | null): DeliveryConfig {
	return raw === null
		? { label: NO_TEXT, courierCents: 0, freeOverCents: null, method: 'pickup', recovered: true }
		: { label: raw.label, courierCents: raw.courierCents, freeOverCents: raw.freeOverCents ?? null, method: raw.method ?? 'pickup', recovered: false }
}

/** The resolved config of a SalesTax. */
export interface SalesTaxConfig {
	/** The name of the tax line on the quote. */
	readonly label: I18nText
	/** The tax rate, applied to the subtotal plus every other rule (delivery included). */
	readonly percent: number
	/** `true` when the config failed validation and these are the harmless empty values of the recovery input. */
	readonly recovered: boolean
}

export function resolveSalesTaxConfig(raw: SalesTaxRawConfig | null): SalesTaxConfig {
	return raw === null ? { label: NO_TEXT, percent: 0, recovered: true } : { label: raw.label, percent: raw.percent, recovered: false }
}
