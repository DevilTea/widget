/**
 * The raw configs of the quote's plugins: what a document author writes, as the plugins' `Interfaces` declare it
 * (`config.raw`). Their documentation is in `./docs.ts`, passed to each plugin's `.config()`.
 *
 * They are written by hand, but the Valibot schemas in `./schemas.ts` stay the validator and the source of the config
 * JSON Schema the Lab shows. `./schemas.ts` asserts at the type level that each type here is exactly the schema's
 * `InferInput` (`RawConfigsMatchSchemas`), so a field added, removed, retyped or made optional on one side only is a
 * type error. The descriptions in `./docs.ts` repeat each schema's `v.description()` text and state its constraints in
 * words; the assertion cannot see those, so change both together.
 */

export interface RawI18nText {
	readonly en: string
	readonly [language: string]: string
}

export interface QuoteRawConfig {
	readonly title: RawI18nText
	readonly currency: string
}

export interface PaperRawConfig {
	readonly label: RawI18nText
	readonly extraCents: number
}

export interface ItemRawConfig {
	readonly title: RawI18nText
	readonly unitCents: number
	readonly papers: Readonly<Record<string, PaperRawConfig>>
	readonly quantity?: number
	readonly paper?: string
}

export interface VolumeTierRawConfig {
	readonly minQuantity: number
	readonly percent: number
}

export interface VolumeDiscountRawConfig {
	readonly label: RawI18nText
	readonly tiers: readonly VolumeTierRawConfig[]
}

export interface RushSurchargeRawConfig {
	readonly label: RawI18nText
	readonly percent: number
	readonly enabled?: boolean
}

export interface DeliveryRawConfig {
	readonly label: RawI18nText
	readonly courierCents: number
	readonly freeOverCents?: number
	readonly method?: 'pickup' | 'courier'
}

export interface SalesTaxRawConfig {
	readonly label: RawI18nText
	readonly percent: number
}
