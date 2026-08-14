/**
 * `DealQuery.filteredDeals`/`count`/`pipelineValue`/`weightedValue`/`stageSeries` (checkpoint §2),
 * against the real canonical preset (`../presets.ts`) and its eight-deal seed dataset (`../domain.ts`).
 * Search/filter/aggregation math is asserted against the seed dataset's exact numbers — never a
 * snapshot — so a wrong formula (e.g. summing instead of weighting, or an off-by-one substring match)
 * would fail here.
 */

import { describe, expect, it } from 'vitest'
import { dealStageValues } from '../domain'
import { createCrmRuntime, widgetOfType } from '../test-support'

function setup() {
	const { runtime } = createCrmRuntime()
	const query = widgetOfType(runtime, 'deal-query', 'DealQuery')
	const search = widgetOfType(runtime, 'deal-search', 'TextInput')
	const stageFilter = widgetOfType(runtime, 'stage-filter', 'SelectInput')
	return { runtime, query, search, stageFilter }
}

describe('dealQuery.filteredDeals / count with no search or stage restriction', () => {
	it('returns every seed deal, unfiltered', () => {
		const { query } = setup()
		expect(query.properties.count.get())
			.toEqual({ success: true, value: 8 })
		const filtered = query.properties.filteredDeals.get()
		expect(filtered.success && filtered.value.map(deal => deal.id))
			.toEqual(['deal-1', 'deal-2', 'deal-3', 'deal-4', 'deal-5', 'deal-6', 'deal-7', 'deal-8'])
	})
})

describe('dealQuery search — deterministic case-insensitive substring over company + contact + owner', () => {
	it('matches by company name regardless of case', () => {
		const { query, search } = setup()
		search.state.value.set('cobalt')
		expect(query.properties.count.get())
			.toEqual({ success: true, value: 1 })
	})

	it('matches by contact name', () => {
		const { query, search } = setup()
		search.state.value.set('Grace Kim')
		expect(query.properties.count.get())
			.toEqual({ success: true, value: 1 })
	})

	it('matches by owner name across multiple deals', () => {
		const { query, search } = setup()
		search.state.value.set('jordan lee')
		expect(query.properties.count.get())
			.toEqual({ success: true, value: 3 })
	})

	it('empty search string matches every deal (substring of everything)', () => {
		const { query, search } = setup()
		search.state.value.set('')
		expect(query.properties.count.get())
			.toEqual({ success: true, value: 8 })
	})
})

describe('dealQuery stage filter — \'all\' vs an exact DealStage literal', () => {
	it('\'all\' applies no stage restriction', () => {
		const { query, stageFilter } = setup()
		stageFilter.state.value.set('all')
		expect(query.properties.count.get())
			.toEqual({ success: true, value: 8 })
	})

	it('an exact DealStage literal restricts to only that stage', () => {
		const { query, stageFilter } = setup()
		stageFilter.state.value.set('proposal')
		const filtered = query.properties.filteredDeals.get()
		expect(filtered.success && filtered.value.map(deal => deal.id))
			.toEqual(['deal-3', 'deal-4'])
	})

	it('combines with search (both restrictions apply)', () => {
		const { query, search, stageFilter } = setup()
		stageFilter.state.value.set('proposal')
		search.state.value.set('delta')
		expect(query.properties.count.get())
			.toEqual({ success: true, value: 1 })
	})
})

describe('dealQuery.pipelineValue / weightedValue — exact math against the seed dataset', () => {
	it('sums every filtered deal\'s amount for pipelineValue', () => {
		const { query } = setup()
		expect(query.properties.pipelineValue.get())
			.toEqual({ success: true, value: 404_000 })
	})

	it('sums amount × stageProbability[stage] for weightedValue', () => {
		const { query } = setup()
		expect(query.properties.weightedValue.get())
			.toEqual({ success: true, value: 246_100 })
	})

	it('recomputes both KPIs from the current stage filter', () => {
		const { query, stageFilter } = setup()
		stageFilter.state.value.set('proposal')
		expect(query.properties.pipelineValue.get())
			.toEqual({ success: true, value: 95_000 })
		expect(query.properties.weightedValue.get())
			.toEqual({ success: true, value: 57_000 })
	})
})

describe('dealQuery.stageSeries — fixed stage order including zero-valued stages', () => {
	it('emits every stage in fixed order for the unfiltered set', () => {
		const { query } = setup()
		const result = query.properties.stageSeries.get()
		expect(result.success && result.value)
			.toEqual([
				{ label: 'lead', value: 1 },
				{ label: 'qualified', value: 2 },
				{ label: 'proposal', value: 2 },
				{ label: 'negotiation', value: 1 },
				{ label: 'won', value: 1 },
				{ label: 'lost', value: 1 },
			])
		expect(result.success && result.value.map(point => point.label))
			.toEqual(dealStageValues)
	})

	it('stays fixed-order with zero-valued stages when filtered to one stage', () => {
		const { query, stageFilter } = setup()
		stageFilter.state.value.set('won')
		const result = query.properties.stageSeries.get()
		expect(result.success && result.value)
			.toEqual([
				{ label: 'lead', value: 0 },
				{ label: 'qualified', value: 0 },
				{ label: 'proposal', value: 0 },
				{ label: 'negotiation', value: 0 },
				{ label: 'won', value: 1 },
				{ label: 'lost', value: 0 },
			])
	})
})

describe('dealQuery empty-query behaviors — a search matching nothing', () => {
	it('count is 0 and every stageSeries value is zero, in fixed order', () => {
		const { query, search } = setup()
		search.state.value.set('no-such-deal-exists')
		expect(query.properties.count.get())
			.toEqual({ success: true, value: 0 })
		expect(query.properties.pipelineValue.get())
			.toEqual({ success: true, value: 0 })
		expect(query.properties.weightedValue.get())
			.toEqual({ success: true, value: 0 })
		const result = query.properties.stageSeries.get()
		expect(result.success && result.value.every(point => point.value === 0))
			.toBe(true)
		expect(result.success && result.value.map(point => point.label))
			.toEqual(dealStageValues)
	})
})
