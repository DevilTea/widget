/**
 * `DealQuery` (checkpoint §2 "CRM-domain semantic widgets") — `config + properties`, the showcase's
 * derived-calculation hub. All search/filter/aggregation semantics live here — never in Table/KPI/chart
 * Vue renderers (checkpoint §2).
 *
 * Search is deterministic case-insensitive substring matching over `company + contact + owner`. Stage
 * filter is `'all'` (no restriction) or an exact `DealStage` literal match — the generic `stage-filter`
 * `SelectInput.value` is refined to this domain with a consumer refinement (`isStageFilterValue` below),
 * so an out-of-domain configured option fails the `filteredDeals` dependency instead of silently
 * matching zero deals (PR #22 review 4941241562 finding 2). `stageSeries` always emits the fixed
 * semantic stage order (`dealStageValues`) and includes zero-valued stages so chart topology never
 * fluctuates with filtering/mutation (checkpoint §2) — the series value is each stage's deal count
 * within the current filtered set (a pipeline-distribution chart), a distinct signal from the
 * amount-summing `pipelineValue`/`weightedValue` KPIs; checkpoint §6 leaves exact chart aggregation an
 * implementation detail.
 */

import type { WidgetInterfaces } from '@deviltea/widget-core'
import type { Deal, DealStage } from '../domain'
import { createWidgetPlugin } from '@deviltea/widget-core'
import { dealStageValues, isDealsArray, isDealStage, isPlainObject, stageProbability } from '../domain'

export interface DealQueryRawConfig {
	readonly storeId: string
	readonly searchInputId: string
	readonly stageFilterId: string
}

export interface DealQueryStageSeriesPoint {
	readonly label: DealStage
	readonly value: number
}

export interface DealQueryInterfaces extends WidgetInterfaces {
	config: {
		raw: DealQueryRawConfig
		resolved: DealQueryRawConfig
	}
	properties: {
		filteredDeals: readonly Deal[]
		count: number
		pipelineValue: number
		weightedValue: number
		stageSeries: readonly DealQueryStageSeriesPoint[]
	}
}

function isDealQueryRawConfig(input: unknown): input is DealQueryRawConfig {
	return isPlainObject(input)
		&& typeof input.storeId === 'string'
		&& typeof input.searchInputId === 'string'
		&& typeof input.stageFilterId === 'string'
}

function isString(value: unknown): value is string {
	return typeof value === 'string'
}

/**
 * Consumer refinement of the generic `stage-filter` `SelectInput.value` (checkpoint §2's stage filter
 * domain is explicitly `'all' | DealStage`) — analogous to Showcase A's `trip-metrics.ts`/
 * `trip-readiness.ts` `value === null || isDestination(value)`-style refinements. A valid edited Source
 * may configure an out-of-domain `stage-filter` option (e.g. `"archived"`), which the generic
 * `SelectInput` State validation legitimately accepts; refining here means selecting that option fails
 * this dependency (and therefore `filteredDeals`/every downstream Property) instead of silently
 * "matching no deals" (PR #22 review 4941241562 finding 2).
 */
function isStageFilterValue(value: unknown): value is 'all' | DealStage {
	return value === 'all' || isDealStage(value)
}

export const DealQueryPlugin = createWidgetPlugin('DealQuery')
	.description('Deal query widget')
	.interfaces<DealQueryInterfaces>()
	.config({
		description: 'Deal query configuration',
		validate: (input): input is DealQueryRawConfig => isDealQueryRawConfig(input),
		resolve: raw => ({
			storeId: raw?.storeId ?? '',
			searchInputId: raw?.searchInputId ?? '',
			stageFilterId: raw?.stageFilterId ?? '',
		}),
	})
	.properties(properties =>
		properties
			.filteredDeals({
				registerDeps: ({ dep, config }) => ({
					deals: dep.widget(config.storeId).state.get('deals')
						.validate(isDealsArray),
					search: dep.widget(config.searchInputId).state.get('value')
						.validate(isString),
					stageFilter: dep.widget(config.stageFilterId).state.get('value')
						.validate(isStageFilterValue),
				}),
				compute: ({ deps }) => {
					const dealsResult = deps.deals()
					const searchResult = deps.search()
					const stageFilterResult = deps.stageFilter()
					if (!dealsResult.ok || !searchResult.ok || !stageFilterResult.ok)
						return []

					const query = searchResult.value.trim()
						.toLowerCase()
					const stageFilter = stageFilterResult.value
					return dealsResult.value.filter((deal) => {
						if (stageFilter !== 'all' && deal.stage !== stageFilter)
							return false
						if (query === '')
							return true
						const haystack = `${deal.company} ${deal.contact} ${deal.owner}`.toLowerCase()
						return haystack.includes(query)
					})
				},
			})
			.count({
				registerDeps: ({ dep }) => dep.self.properties.get('filteredDeals'),
				compute: ({ deps }) => {
					const result = deps()
					return result.ok ? (result.value ?? []).length : 0
				},
			})
			.pipelineValue({
				registerDeps: ({ dep }) => dep.self.properties.get('filteredDeals'),
				compute: ({ deps }) => {
					const result = deps()
					if (!result.ok)
						return 0
					return (result.value ?? []).reduce((sum, deal) => sum + deal.amount, 0)
				},
			})
			.weightedValue({
				registerDeps: ({ dep }) => dep.self.properties.get('filteredDeals'),
				compute: ({ deps }) => {
					const result = deps()
					if (!result.ok)
						return 0
					return (result.value ?? []).reduce((sum, deal) => sum + (deal.amount * stageProbability[deal.stage]), 0)
				},
			})
			.stageSeries({
				registerDeps: ({ dep }) => dep.self.properties.get('filteredDeals'),
				compute: ({ deps }) => {
					const result = deps()
					const deals = result.ok ? (result.value ?? []) : []
					return dealStageValues.map(stage => ({
						label: stage,
						value: deals.filter(deal => deal.stage === stage).length,
					}))
				},
			}))
	.done()
