/**
 * `Delivery`: pick up at the shop, or have it brought by courier for a flat fee that is waived from a subtotal
 * on. State `method` is the customer's choice; Property `adjustment` is the fee.
 */

import type { WidgetInterfaces } from '@deviltea/widget-core'
import type { DeliveryConfig } from '../config'
import type { Adjustment } from '../domain'
import type { DeliveryRawConfig } from '../schemas'
import { createWidgetPlugin } from '@deviltea/widget-core'
import { resolveDeliveryConfig } from '../config'
import { deliveryConfigSchema, deliveryMethodSchema } from '../schemas'
import { guard } from '../standard-schema'
import { subtotalReads, valueOr } from './reads'
import { checkInsideQuote } from './structure'

/**
 * Pick-up or courier delivery. Config: `label`, `courierCents`, an optional `freeOverCents` and the starting `method`.
 * State `method`: `pickup` or `courier`. Property `adjustment`: the courier fee, waived from `freeOverCents` on
 * (`reason: free-over-threshold`).
 */
export interface DeliveryInterfaces extends WidgetInterfaces {
	/**
	 * The label, the courier fee, the subtotal from which it is free and the starting method. Validated by a Valibot schema
	 * through Standard Schema.
	 */
	config: { raw: DeliveryRawConfig, resolved: DeliveryConfig }
	state: {
		/** How the order reaches the customer: `pickup` or `courier`. */
		method: 'pickup' | 'courier'
	}
	properties: {
		/** The courier fee in minor units, waived from `freeOverCents` on; 0 for pick-up. */
		adjustment: Adjustment
	}
}

export const DeliveryPlugin = createWidgetPlugin('Delivery')
	.interfaces<DeliveryInterfaces>()
	.config({
		validate: guard(deliveryConfigSchema),
		resolve: resolveDeliveryConfig,
	})
	.structure(ctx => checkInsideQuote(ctx, 'Delivery'))
	.state(state => state.method({
		validate: guard(deliveryMethodSchema),
		default: ({ config }) => config.method,
	}))
	.properties(properties => properties.adjustment({
		registerDeps: ({ dep, blueprint }) => ({
			method: dep.self.state.get('method'),
			...subtotalReads(dep, blueprint),
		}),
		compute: ({ deps, config }): Adjustment => {
			const method = deps.method()
			if (!method.ok || method.value !== 'courier')
				return { type: 'Delivery', kind: 'fee', label: config.label, applied: false, percent: null, cents: 0, reason: null }
			if (config.freeOverCents !== null && valueOr(deps.subtotalCents, 0) >= config.freeOverCents)
				return { type: 'Delivery', kind: 'fee', label: config.label, applied: true, percent: null, cents: 0, reason: 'free-over-threshold' }
			return { type: 'Delivery', kind: 'fee', label: config.label, applied: true, percent: null, cents: config.courierCents, reason: null }
		},
	}))
	.done()
