/**
 * `SalesTax`: a percentage of the taxable amount, which is the subtotal plus every other rule (the discount, the
 * rush surcharge and the delivery fee). It reads the Quote's Property `taxableCents`, which reads those rules'
 * `adjustment` Properties, never this one, so the chain has no loop.
 */

import type { WidgetInterfaces } from '@deviltea/widget-core'
import type { SalesTaxConfig } from '../config'
import type { Adjustment } from '../domain'
import type { SalesTaxRawConfig } from '../schemas'
import { createWidgetPlugin } from '@deviltea/widget-core'
import { resolveSalesTaxConfig } from '../config'
import { percentOf } from '../domain'
import { salesTaxConfigJsonSchema, salesTaxConfigSchema } from '../schemas'
import { guard } from '../standard-schema'
import { taxableReads, valueOr } from './reads'
import { checkInsideQuote } from './structure'

export interface SalesTaxInterfaces extends WidgetInterfaces {
	config: { raw: SalesTaxRawConfig, resolved: SalesTaxConfig }
	properties: { adjustment: Adjustment }
}

export const SalesTaxPlugin = createWidgetPlugin('SalesTax')
	.description('A percentage of the taxable amount (the subtotal plus every other rule). Config: `label` and `percent`. Property `adjustment`: the tax.')
	.interfaces<SalesTaxInterfaces>()
	.config({
		description: 'The label and the tax rate. Validated by a Valibot schema through Standard Schema.',
		schema: salesTaxConfigJsonSchema,
		validate: guard(salesTaxConfigSchema),
		resolve: resolveSalesTaxConfig,
	})
	.structure(ctx => checkInsideQuote(ctx, 'SalesTax'))
	.properties(properties => properties.adjustment({
		registerDeps: ({ dep, blueprint }) => taxableReads(dep, blueprint),
		compute: ({ deps, config }): Adjustment => ({
			type: 'SalesTax',
			kind: 'tax',
			label: config.label,
			applied: config.percent > 0,
			percent: config.percent,
			cents: percentOf(valueOr(deps.taxableCents, 0), config.percent),
			reason: null,
		}),
	}))
	.done()
