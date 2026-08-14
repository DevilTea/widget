/**
 * `DealStore` (checkpoint §2 "CRM-domain semantic widgets") — `config + state + methods`. The sole
 * authoritative CRM-record mutation owner: Table/DetailPanel/Modal renderers never mutate deal objects
 * directly, and `DealStore.updateStage`/`reset` always replace arrays/records rather than mutating
 * configured seed payloads in place.
 *
 * Locked validation boundary (checkpoint §2 "Validation boundary for `updateStage` is locked"):
 * `validateArgs` is shape/type only (`dealId` a string, `stage` a legal `DealStage` literal) and never
 * queries `deals`; current-deal existence is an `execute()`-time semantic check against the registered
 * `deals` State dependency. A malformed tuple or invalid `DealStage` literal is therefore always a
 * `method-args` failure, while a syntactically valid but currently-missing deal id is always a
 * `method-result` failure from `execute()` — the two failure categories never collapse into one.
 */

import type { WidgetInterfaces } from '@deviltea/widget-core'
import type { Deal, DealStage } from '../domain'
import { createWidgetPlugin } from '@deviltea/widget-core'
import { isDealsArray, isDealStage, isPlainObject } from '../domain'

export interface DealStoreRawConfig {
	readonly seedDeals: readonly Deal[]
}

export interface DealStoreInterfaces extends WidgetInterfaces {
	config: {
		raw: DealStoreRawConfig
		resolved: DealStoreRawConfig
	}
	state: {
		deals: readonly Deal[]
	}
	methods: {
		updateStage: (dealId: string, stage: DealStage) => Deal
		reset: () => void
	}
}

/** An inert placeholder — only ever returned on a failure path, where no consumer observes it. */
const DUMMY_DEAL: Deal = { id: '', company: '', contact: '', owner: '', stage: 'lead', amount: 0 }

export const DealStorePlugin = createWidgetPlugin('DealStore')
	.interfaces<DealStoreInterfaces>()
	.config({
		validate: (input): input is DealStoreRawConfig => isPlainObject(input) && isDealsArray(input.seedDeals),
		// Cloned defensively so a later `updateStage`/`reset` array/record replacement can never be
		// observed as mutating the plugin's own configured seed payload in place.
		resolve: raw => ({ seedDeals: (raw?.seedDeals ?? []).map(deal => ({ ...deal })) }),
	})
	.state(state =>
		state.deals({
			validate: (input): input is readonly Deal[] => isDealsArray(input),
			default: ({ config }) => config.seedDeals.map(deal => ({ ...deal })),
		}))
	.methods(methods =>
		methods
			.updateStage({
				registerDeps: ({ dep }) => ({
					deals: dep.self.state.get('deals'),
					setDeals: dep.self.state.set('deals'),
				}),
				validateArgs: (args): args is [string, DealStage] =>
					args.length === 2 && typeof args[0] === 'string' && isDealStage(args[1]),
				execute: ({ deps, args, addIssue }) => {
					const [dealId, stage] = args
					const dealsResult = deps.deals()
					if (!dealsResult.success)
						return DUMMY_DEAL

					const deals = dealsResult.value ?? []
					const index = deals.findIndex(deal => deal.id === dealId)
					if (index === -1) {
						addIssue({ message: `No deal found with id "${dealId}".` })
						return DUMMY_DEAL
					}

					const updated: Deal = { ...deals[index]!, stage }
					const nextDeals = [...deals.slice(0, index), updated, ...deals.slice(index + 1)]
					deps.setDeals(nextDeals)
					return updated
				},
			})
			.reset({
				registerDeps: ({ dep }) => dep.self.state.set('deals'),
				validateArgs: (args): args is [] => args.length === 0,
				execute: ({ deps, config }) => {
					deps(config.seedDeals.map(deal => ({ ...deal })))
				},
			}))
	.done()
