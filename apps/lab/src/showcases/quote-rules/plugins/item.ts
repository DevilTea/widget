/**
 * `Item`: one printed product. Config: its title, the unit price, the papers on offer and the starting
 * answers. State (what the customer chooses): `quantity` and `paper`. Property `line`: the priced line.
 *
 * The State validators and the config validator are Standard Schema objects (`../schemas.ts`, run through
 * `guard()`), so a quantity of 0 or 2.5 is refused by `state.set()` with the library's own message.
 */

import type { WidgetInterfaces } from '@deviltea/widget-core'
import type { ItemConfig } from '../config'
import type { ItemLine } from '../domain'
import type { ItemRawConfig } from '../schemas'
import { createWidgetPlugin } from '@deviltea/widget-core'
import { resolveItemConfig } from '../config'
import { itemConfigJsonSchema, itemConfigSchema, paperSchema, quantitySchema } from '../schemas'
import { guard } from '../standard-schema'
import { checkInsideQuote } from './structure'

export interface ItemInterfaces extends WidgetInterfaces {
	config: { raw: ItemRawConfig, resolved: ItemConfig }
	state: { quantity: number, paper: string }
	properties: { line: ItemLine }
}

export const ItemPlugin = createWidgetPlugin('Item')
	.description('One printed product of the quote. Config: title, `unitCents`, the `papers` on offer and the starting `quantity` and `paper`. State: `quantity` and `paper`, what the customer chooses. Property `line`: the quantity, the paper and the line price in minor units (it fails with `unknown-paper` when State `paper` is not one of the papers).')
	.interfaces<ItemInterfaces>()
	.config({
		description: 'The product, its unit price, the papers on offer and the starting quantity and paper. Validated by a Valibot schema through Standard Schema.',
		schema: itemConfigJsonSchema,
		validate: guard(itemConfigSchema),
		resolve: resolveItemConfig,
	})
	.structure(ctx => checkInsideQuote(ctx, 'Item'))
	.state(state => state
		.quantity({
			validate: guard(quantitySchema),
			default: ({ config }) => config.quantity,
		})
		.paper({
			validate: guard(paperSchema),
			default: ({ config }) => config.paper,
		}))
	.properties(properties => properties.line({
		registerDeps: ({ dep }) => ({
			quantity: dep.self.state.get('quantity'),
			paper: dep.self.state.get('paper'),
		}),
		compute: ({ deps, config, addDiagnostic }): ItemLine => {
			const quantityRead = deps.quantity()
			const paperRead = deps.paper()
			const quantity = quantityRead.ok && quantityRead.value !== null ? quantityRead.value : config.quantity
			const paper = paperRead.ok && paperRead.value !== null ? paperRead.value : config.paper
			const choice = Object.hasOwn(config.papers, paper) ? config.papers[paper] : undefined
			if (choice === undefined) {
				addDiagnostic({ message: `There is no paper "${paper}" on this item: choose one of ${Object.keys(config.papers)
					.join(', ') || '(none)'}.`, reason: 'unknown-paper' })
				return { title: config.title, quantity, paper, paperLabel: { en: paper }, unitCents: config.unitCents, cents: quantity * config.unitCents }
			}
			const unitCents = config.unitCents + choice.extraCents
			return { title: config.title, quantity, paper, paperLabel: choice.label, unitCents, cents: quantity * unitCents }
		},
	}))
	.done()
