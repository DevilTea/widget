/**
 * The six quote plugins as one tuple for `createWidgetSystem` (see `../system.ts`). `Quote` is first: the
 * Implementation catalog marks the first type as the current one.
 *
 * Nothing in here imports Vue or touches the DOM: the same tuple runs in the Preview (with the Vue renderers) and
 * in the Web Worker (`../quote.worker.ts`).
 */

import { DeliveryPlugin } from './delivery'
import { ItemPlugin } from './item'
import { QuotePlugin } from './quote'
import { RushSurchargePlugin } from './rush-surcharge'
import { SalesTaxPlugin } from './sales-tax'
import { VolumeDiscountPlugin } from './volume-discount'

export * from './delivery'
export * from './item'
export * from './quote'
export * from './rush-surcharge'
export * from './sales-tax'
export * from './volume-discount'

export const quotePlugins = [
	QuotePlugin,
	ItemPlugin,
	VolumeDiscountPlugin,
	RushSurchargePlugin,
	DeliveryPlugin,
	SalesTaxPlugin,
] as const

export type QuotePlugins = typeof quotePlugins
