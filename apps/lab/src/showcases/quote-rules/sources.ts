/**
 * Quote-rules curated Implementation-explorer registry: one entry per `quotePlugins` type (`./plugins/index.ts`)
 * with the plugin file, the Vue renderer file(s) and the files that carry the showcase's teaching points: `schemas.ts`
 * (the Valibot schemas that are the validators and the config JSON Schemas) and `standard-schema.ts` (the guard that
 * turns a Standard Schema into a Core predicate), `evaluate.ts` and `quote.worker.ts` (the JSON-in/JSON-out
 * evaluation and the Web Worker that runs it) and `quote-host.ts` (the isolated-error handler and the comparison).
 * Every file is a lazy `?raw` thunk (see `../../showcase-host/sources.ts`), so this module stays small and pulls no
 * source text into the shell's initial chunks.
 */

import type { SourcesRegistry } from '../../showcase-host'

const ROOT = 'apps/lab/src/showcases/quote-rules'

const domain = {
	kind: 'domain',
	title: 'domain.ts',
	path: `${ROOT}/domain.ts`,
	load: () => import('./domain.ts?raw').then(module => module.default),
} as const

const reads = {
	kind: 'domain',
	title: 'reads.ts',
	path: `${ROOT}/plugins/reads.ts`,
	load: () => import('./plugins/reads.ts?raw').then(module => module.default),
} as const

const structure = {
	kind: 'domain',
	title: 'structure.ts',
	path: `${ROOT}/plugins/structure.ts`,
	load: () => import('./plugins/structure.ts?raw').then(module => module.default),
} as const

const schemas = {
	kind: 'domain',
	title: 'schemas.ts',
	path: `${ROOT}/schemas.ts`,
	load: () => import('./schemas.ts?raw').then(module => module.default),
} as const

const standardSchema = {
	kind: 'domain',
	title: 'standard-schema.ts',
	path: `${ROOT}/standard-schema.ts`,
	load: () => import('./standard-schema.ts?raw').then(module => module.default),
} as const

const ruleCard = {
	kind: 'renderer',
	title: 'RuleCard.vue',
	path: `${ROOT}/renderers/RuleCard.vue`,
	load: () => import('./renderers/RuleCard.vue?raw').then(module => module.default),
} as const

export const quoteSources: SourcesRegistry = {
	Quote: {
		files: [
			{ kind: 'plugin', title: 'quote.ts', path: `${ROOT}/plugins/quote.ts`, load: () => import('./plugins/quote.ts?raw').then(m => m.default) },
			{ kind: 'domain', title: 'evaluate.ts', path: `${ROOT}/evaluate.ts`, load: () => import('./evaluate.ts?raw').then(m => m.default) },
			{ kind: 'domain', title: 'quote.worker.ts', path: `${ROOT}/quote.worker.ts`, load: () => import('./quote.worker.ts?raw').then(m => m.default) },
			{ kind: 'domain', title: 'worker-client.ts', path: `${ROOT}/worker-client.ts`, load: () => import('./worker-client.ts?raw').then(m => m.default) },
			{ kind: 'renderer', title: 'QuoteRootRenderer.vue', path: `${ROOT}/renderers/QuoteRootRenderer.vue`, load: () => import('./renderers/QuoteRootRenderer.vue?raw').then(m => m.default) },
			{ kind: 'renderer', title: 'quote-host.ts', path: `${ROOT}/renderers/quote-host.ts`, load: () => import('./renderers/quote-host.ts?raw').then(m => m.default) },
			{ kind: 'renderer', title: 'index.ts', path: `${ROOT}/renderers/index.ts`, load: () => import('./renderers/index.ts?raw').then(m => m.default) },
			schemas,
			reads,
			domain,
		],
	},
	Item: {
		files: [
			{ kind: 'plugin', title: 'item.ts', path: `${ROOT}/plugins/item.ts`, load: () => import('./plugins/item.ts?raw').then(m => m.default) },
			{ kind: 'renderer', title: 'ItemRenderer.vue', path: `${ROOT}/renderers/ItemRenderer.vue`, load: () => import('./renderers/ItemRenderer.vue?raw').then(m => m.default) },
			schemas,
			standardSchema,
			structure,
			domain,
		],
	},
	VolumeDiscount: {
		files: [
			{ kind: 'plugin', title: 'volume-discount.ts', path: `${ROOT}/plugins/volume-discount.ts`, load: () => import('./plugins/volume-discount.ts?raw').then(m => m.default) },
			{ kind: 'renderer', title: 'VolumeDiscountRenderer.vue', path: `${ROOT}/renderers/VolumeDiscountRenderer.vue`, load: () => import('./renderers/VolumeDiscountRenderer.vue?raw').then(m => m.default) },
			ruleCard,
			schemas,
			reads,
			domain,
		],
	},
	RushSurcharge: {
		files: [
			{ kind: 'plugin', title: 'rush-surcharge.ts', path: `${ROOT}/plugins/rush-surcharge.ts`, load: () => import('./plugins/rush-surcharge.ts?raw').then(m => m.default) },
			{ kind: 'renderer', title: 'RushSurchargeRenderer.vue', path: `${ROOT}/renderers/RushSurchargeRenderer.vue`, load: () => import('./renderers/RushSurchargeRenderer.vue?raw').then(m => m.default) },
			ruleCard,
			schemas,
			reads,
			domain,
		],
	},
	Delivery: {
		files: [
			{ kind: 'plugin', title: 'delivery.ts', path: `${ROOT}/plugins/delivery.ts`, load: () => import('./plugins/delivery.ts?raw').then(m => m.default) },
			{ kind: 'renderer', title: 'DeliveryRenderer.vue', path: `${ROOT}/renderers/DeliveryRenderer.vue`, load: () => import('./renderers/DeliveryRenderer.vue?raw').then(m => m.default) },
			ruleCard,
			schemas,
			reads,
			domain,
		],
	},
	SalesTax: {
		files: [
			{ kind: 'plugin', title: 'sales-tax.ts', path: `${ROOT}/plugins/sales-tax.ts`, load: () => import('./plugins/sales-tax.ts?raw').then(m => m.default) },
			{ kind: 'renderer', title: 'SalesTaxRenderer.vue', path: `${ROOT}/renderers/SalesTaxRenderer.vue`, load: () => import('./renderers/SalesTaxRenderer.vue?raw').then(m => m.default) },
			ruleCard,
			schemas,
			reads,
			domain,
		],
	},
}
