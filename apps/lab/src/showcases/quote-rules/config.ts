/**
 * Raw config -> resolved config for every plugin. Validation is not here: it is the schema in `./schemas.ts`,
 * run through `guard()`. `resolve` receives `null` when the config failed validation (the recovery input), and
 * every resolved config then carries `recovered: true` with harmless empty values, so the Runtime of a recovered
 * widget still builds.
 */

import type { I18nText } from './domain'
import type { DeliveryRawConfig, ItemRawConfig, QuoteRawConfig, RushSurchargeRawConfig, SalesTaxRawConfig, VolumeDiscountRawConfig } from './raw-config'

const NO_TEXT: I18nText = { en: '' }

export interface QuoteConfig {
	readonly title: I18nText
	readonly currency: string
	readonly recovered: boolean
}

export function resolveQuoteConfig(raw: QuoteRawConfig | null): QuoteConfig {
	return raw === null ? { title: NO_TEXT, currency: 'EUR', recovered: true } : { title: raw.title, currency: raw.currency, recovered: false }
}

export interface Paper {
	readonly label: I18nText
	readonly extraCents: number
}

export interface ItemConfig {
	readonly title: I18nText
	readonly unitCents: number
	readonly papers: Readonly<Record<string, Paper>>
	readonly quantity: number
	readonly paper: string
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

export interface VolumeDiscountConfig {
	readonly label: I18nText
	readonly tiers: readonly {
		readonly minQuantity: number
		readonly percent: number
	}[]
	readonly recovered: boolean
}

export function resolveVolumeDiscountConfig(raw: VolumeDiscountRawConfig | null): VolumeDiscountConfig {
	return raw === null ? { label: NO_TEXT, tiers: [], recovered: true } : { label: raw.label, tiers: raw.tiers, recovered: false }
}

export interface RushSurchargeConfig {
	readonly label: I18nText
	readonly percent: number
	readonly enabled: boolean
	readonly recovered: boolean
}

export function resolveRushSurchargeConfig(raw: RushSurchargeRawConfig | null): RushSurchargeConfig {
	return raw === null
		? { label: NO_TEXT, percent: 0, enabled: false, recovered: true }
		: { label: raw.label, percent: raw.percent, enabled: raw.enabled ?? false, recovered: false }
}

export interface DeliveryConfig {
	readonly label: I18nText
	readonly courierCents: number
	readonly freeOverCents: number | null
	readonly method: 'pickup' | 'courier'
	readonly recovered: boolean
}

export function resolveDeliveryConfig(raw: DeliveryRawConfig | null): DeliveryConfig {
	return raw === null
		? { label: NO_TEXT, courierCents: 0, freeOverCents: null, method: 'pickup', recovered: true }
		: { label: raw.label, courierCents: raw.courierCents, freeOverCents: raw.freeOverCents ?? null, method: raw.method ?? 'pickup', recovered: false }
}

export interface SalesTaxConfig {
	readonly label: I18nText
	readonly percent: number
	readonly recovered: boolean
}

export function resolveSalesTaxConfig(raw: SalesTaxRawConfig | null): SalesTaxConfig {
	return raw === null ? { label: NO_TEXT, percent: 0, recovered: true } : { label: raw.label, percent: raw.percent, recovered: false }
}
