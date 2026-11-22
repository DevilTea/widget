/**
 * `RushSurcharge`: a percentage of the subtotal added when the customer asks for rush production. State
 * `enabled` is the customer's choice; Property `adjustment` is the surcharge (0 and not applied while it is off).
 */

import type { WidgetInterfaces } from '@deviltea/widget-core'
import type { RushSurchargeConfig } from '../config'
import type { Adjustment } from '../domain'
import type { RushSurchargeRawConfig } from '../schemas'
import { createWidgetPlugin } from '@deviltea/widget-core'
import { resolveRushSurchargeConfig } from '../config'
import { percentOf } from '../domain'
import { enabledSchema, rushSurchargeConfigSchema } from '../schemas'
import { guard } from '../standard-schema'
import { subtotalReads, valueOr } from './reads'
import { checkInsideQuote } from './structure'

/**
 * A percentage of the subtotal added for rush production. Config: `label`, `percent` and the starting `enabled`. State
 * `enabled`: the customer's choice. Property `adjustment`: the surcharge (0 while it is off).
 */
export interface RushSurchargeInterfaces extends WidgetInterfaces {
	/**
	 * The label, the percentage (counted to two decimals) and whether rush starts switched on. Validated by a Valibot schema
	 * through Standard Schema.
	 */
	config: { raw: RushSurchargeRawConfig, resolved: RushSurchargeConfig }
	state: {
		/** Whether the customer asks for rush production. */
		enabled: boolean
	}
	properties: {
		/** The surcharge in minor units; 0 and not applied while `enabled` is off. */
		adjustment: Adjustment
	}
}

export const RushSurchargePlugin = createWidgetPlugin('RushSurcharge')
	.interfaces<RushSurchargeInterfaces>()
	.config({
		validate: guard(rushSurchargeConfigSchema),
		resolve: resolveRushSurchargeConfig,
	})
	.structure(ctx => checkInsideQuote(ctx, 'RushSurcharge'))
	.state(state => state.enabled({
		validate: guard(enabledSchema),
		default: ({ config }) => config.enabled,
	}))
	.properties(properties => properties.adjustment({
		registerDeps: ({ dep, blueprint }) => ({
			enabled: dep.self.state.get('enabled'),
			...subtotalReads(dep, blueprint),
		}),
		compute: ({ deps, config }): Adjustment => {
			const enabled = deps.enabled()
			if (!enabled.ok || enabled.value !== true)
				return { type: 'RushSurcharge', kind: 'surcharge', label: config.label, applied: false, percent: null, cents: 0, reason: null }
			return { type: 'RushSurcharge', kind: 'surcharge', label: config.label, applied: true, percent: config.percent, cents: percentOf(valueOr(deps.subtotalCents, 0), config.percent), reason: null }
		},
	}))
	.done()
