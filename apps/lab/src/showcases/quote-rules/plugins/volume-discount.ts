/**
 * `VolumeDiscount`: a percentage off the subtotal, chosen by the total number of pieces. Property `adjustment`.
 *
 * **Deliberate defect, for the isolated-exception demonstration.** The tier that applies is the last one whose
 * `minQuantity` the total quantity reaches. The code takes it for granted that there is one, as if the first tier
 * always started at 1: the `!` below is the lie. The schema (`../schemas.ts`) does not require the first tier to
 * start at 1, so `quote-buggy-rule` is a *valid* document (the first tier starts at 100): while the total quantity
 * is 100 or more everything works, and the moment a customer lowers it, `compute` throws a `TypeError`.
 *
 * That is not a diagnostic (a fact about data) but an implementation exception, and Core treats it as one: a
 * direct `get()` rethrows it, while a subscription (the Preview's renderers subscribe) that recomputes the
 * Property on a State change is **isolated**: the write that caused it still succeeds, the other subscribers are
 * still notified, and Core hands the exception to the host's isolated-error handler
 * (`setIsolatedErrorHandler`, installed by `../renderers/index.ts`), or rethrows it in a microtask when there is none.
 */

import type { WidgetInterfaces } from '@deviltea/widget-core'
import type { VolumeDiscountConfig } from '../config'
import type { Adjustment } from '../domain'
import type { VolumeDiscountRawConfig } from '../schemas'
import { createWidgetPlugin } from '@deviltea/widget-core'
import { resolveVolumeDiscountConfig } from '../config'
import { percentOf } from '../domain'
import { volumeDiscountConfigJsonSchema, volumeDiscountConfigSchema } from '../schemas'
import { guard } from '../standard-schema'
import { quantityReads, subtotalReads, valueOr } from './reads'
import { checkInsideQuote } from './structure'

export interface VolumeDiscountInterfaces extends WidgetInterfaces {
	config: { raw: VolumeDiscountRawConfig, resolved: VolumeDiscountConfig }
	properties: { adjustment: Adjustment }
}

export const VolumeDiscountPlugin = createWidgetPlugin('VolumeDiscount')
	.description('A percentage off the subtotal by the total number of pieces. Config: `label` and the ascending `tiers` (`minQuantity`, `percent`). Property `adjustment`: the (negative) amount. Known defect: it assumes the first tier starts at 1, so a quantity below the first tier makes `adjustment` throw instead of reporting a diagnostic.')
	.interfaces<VolumeDiscountInterfaces>()
	.config({
		description: 'The label and the volume tiers. Validated by a Valibot schema through Standard Schema; the schema does not say that the first tier must start at 1.',
		schema: volumeDiscountConfigJsonSchema,
		validate: guard(volumeDiscountConfigSchema),
		resolve: resolveVolumeDiscountConfig,
	})
	.structure(ctx => checkInsideQuote(ctx, 'VolumeDiscount'))
	.properties(properties => properties.adjustment({
		registerDeps: ({ dep, blueprint }) => ({ ...subtotalReads(dep, blueprint), ...quantityReads(dep, blueprint) }),
		compute: ({ deps, config }): Adjustment => {
			const quantityRead = deps.totalQuantity?.()
			// A failed read (an item that cannot be priced) is already a recorded dependency diagnostic: there is no quantity
			// to find a tier for, and 0 would wrongly look like a quantity below the first tier.
			if (quantityRead === undefined || !quantityRead.ok || quantityRead.value === null)
				return { type: 'VolumeDiscount', kind: 'discount', label: config.label, applied: false, percent: null, cents: 0, reason: null }
			const quantity = quantityRead.value
			const subtotal = valueOr(deps.subtotalCents, 0)
			const reached = config.tiers.filter(tier => quantity >= tier.minQuantity)
			// DEFECT (deliberate): `reached` is empty below the first tier, so `.at(-1)` is `undefined` and `.percent` throws.
			const tier = reached.at(-1)!
			const percent = tier.percent
			return { type: 'VolumeDiscount', kind: 'discount', label: config.label, applied: percent > 0, percent: percent > 0 ? percent : null, cents: percent > 0 ? -percentOf(subtotal, percent) : 0, reason: null }
		},
	}))
	.done()
