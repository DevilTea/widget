/**
 * The raw configs of the quote's plugins: what a document author writes, as the plugins' `Interfaces` declare it
 * (`config.raw`), so the generated documentation reads their JSDoc.
 *
 * They are written by hand, but the Valibot schemas in `./schemas.ts` stay the validator and the source of the config
 * JSON Schema the Lab shows. `./schemas.ts` asserts at the type level that each type here is exactly the schema's
 * `InferInput` (`RawConfigsMatchSchemas`), so a field added, removed, retyped or made optional on one side only is a
 * type error. The descriptions repeat each schema's `v.description()` text, and the tags state the schema's
 * constraints; the assertion cannot see those, so change both together.
 */

/**
 * Text per language, such as `{ "en": "Flyers", "zh-TW": "傳單" }`. `"en"` is required; a missing language falls back to it.
 * The quote offers `en` and `zh-TW`.
 */
export interface RawI18nText {
	/**
	 * The English text, which every other language falls back to.
	 *
	 * @minLength 1
	 */
	readonly en: string
	/** The text in the language this key names, such as `zh-TW`. */
	readonly [language: string]: string
}

/** The config of the Quote: its title and currency. */
export interface QuoteRawConfig {
	/** The quote title. */
	readonly title: RawI18nText
	/**
	 * A three-letter capital currency code such as "EUR". Every amount of the quote is in whole minor units (cents) of it.
	 *
	 * @pattern ^[A-Z]{3}$
	 */
	readonly currency: string
}

/** One paper an Item is offered on. */
export interface PaperRawConfig {
	/** The paper's name. */
	readonly label: RawI18nText
	/**
	 * What one piece costs more on this paper, in minor units.
	 *
	 * @minimum 0
	 * @maximum 100000000
	 * @multipleOf 1
	 */
	readonly extraCents: number
}

/** The config of an Item: the product, its unit price, the papers on offer and the starting answers. */
export interface ItemRawConfig {
	/** What is being printed. */
	readonly title: RawI18nText
	/**
	 * The price of one piece on the cheapest paper, in minor units.
	 *
	 * @minimum 0
	 * @maximum 100000000
	 * @multipleOf 1
	 */
	readonly unitCents: number
	/**
	 * The papers a customer can choose, by code (lowercase letters, digits and "-", starting with a letter:
	 * `^[a-z][a-z0-9-]*$`). The option the customer picks is State `paper`; a code that is not listed here makes `line` fail.
	 */
	readonly papers: Readonly<Record<string, PaperRawConfig>>
	/**
	 * The starting quantity. A customer can change it; Start over restores this value. Defaults to 1.
	 *
	 * @minimum 1
	 * @maximum 100000
	 * @multipleOf 1
	 * @default 1
	 */
	readonly quantity?: number
	/**
	 * The starting paper (a key of "papers"). Defaults to the first one.
	 *
	 * @pattern ^[a-z][a-z0-9-]*$
	 */
	readonly paper?: string
}

/** One volume tier of a VolumeDiscount. */
export interface VolumeTierRawConfig {
	/**
	 * From this total number of pieces on.
	 *
	 * @minimum 1
	 * @maximum 100000
	 * @multipleOf 1
	 */
	readonly minQuantity: number
	/**
	 * The percentage taken off the subtotal.
	 *
	 * @minimum 0
	 * @maximum 100
	 */
	readonly percent: number
}

/** The config of a VolumeDiscount: its label and the volume tiers. */
export interface VolumeDiscountRawConfig {
	/** The name of the discount on the quote. */
	readonly label: RawI18nText
	/**
	 * Volume tiers, in any order. The tier with the largest "minQuantity" that the total quantity reaches applies.
	 *
	 * @minItems 1
	 */
	readonly tiers: readonly VolumeTierRawConfig[]
}

/** The config of a RushSurcharge: its label, the percentage and whether it starts switched on. */
export interface RushSurchargeRawConfig {
	/** The name of the surcharge on the quote. */
	readonly label: RawI18nText
	/**
	 * The percentage of the subtotal added when rush production is on.
	 *
	 * @minimum 0
	 * @maximum 300
	 */
	readonly percent: number
	/**
	 * Whether rush production starts switched on. Defaults to false.
	 *
	 * @default false
	 */
	readonly enabled?: boolean
}

/** The config of a Delivery: its label, the courier fee, the subtotal from which it is free and the starting method. */
export interface DeliveryRawConfig {
	/** The name of the delivery line on the quote. */
	readonly label: RawI18nText
	/**
	 * The courier fee, in minor units.
	 *
	 * @minimum 0
	 * @maximum 100000000
	 * @multipleOf 1
	 */
	readonly courierCents: number
	/**
	 * A subtotal, in minor units, from which courier delivery is free.
	 *
	 * @minimum 0
	 * @maximum 100000000
	 * @multipleOf 1
	 */
	readonly freeOverCents?: number
	/**
	 * The starting delivery method. Defaults to "pickup".
	 *
	 * @default "pickup"
	 */
	readonly method?: 'pickup' | 'courier'
}

/** The config of a SalesTax: its label and the tax rate. */
export interface SalesTaxRawConfig {
	/** The name of the tax line on the quote. */
	readonly label: RawI18nText
	/**
	 * The tax rate, applied to the subtotal plus every other rule (delivery included).
	 *
	 * @minimum 0
	 * @maximum 100
	 */
	readonly percent: number
}
