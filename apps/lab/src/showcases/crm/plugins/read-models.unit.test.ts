/**
 * `Table.selectRow`/`selectedRow`/`empty` (checkpoint §2) against the real canonical preset
 * (`../presets.ts`). Covers the locked `validateArgs`-vs-`execute` split, the selection-retention rule
 * (filtering hides `selectedRow` without mutating `selectedRowId`), and reappearance once the retained
 * id becomes visible again.
 */

import { describe, expect, it } from 'vitest'
import { defaultCrmPreset } from '../presets'
import { createCrmRuntime, widgetOfType } from '../test-support'

function setup() {
	const { runtime } = createCrmRuntime()
	const table = widgetOfType(runtime, 'deal-table', 'Table')
	const stageFilter = widgetOfType(runtime, 'stage-filter', 'SelectInput')
	const search = widgetOfType(runtime, 'deal-search', 'TextInput')
	return { runtime, table, stageFilter, search }
}

describe('table.selectRow() — success', () => {
	it('sets selectedRowId and makes selectedRow the matching row', () => {
		const { table } = setup()
		const result = table.methods.selectRow('deal-1')
		expect(result.success)
			.toBe(true)
		expect(table.state.selectedRowId.get())
			.toBe('deal-1')
		const selectedRow = table.properties.selectedRow.get()
		expect(selectedRow.success && selectedRow.value?.id)
			.toBe('deal-1')
	})
})

describe('table.selectRow() — locked validateArgs-vs-execute failure split', () => {
	it('a non-string argument is a method-args failure (validateArgs), selection unchanged', () => {
		const { table } = setup()
		const result = table.methods.selectRow(42 as unknown as string)
		expect(result.success)
			.toBe(false)
		if (result.success)
			throw new Error('expected a failure')
		expect(result.issues[0]!.source.type)
			.toBe('method-args')
		expect(table.state.selectedRowId.get())
			.toBeNull()
	})

	it('wrong arity is a method-args failure', () => {
		const { table } = setup()
		const result = (table.methods.selectRow as (...args: readonly unknown[]) => { readonly success: boolean })()
		expect(result.success)
			.toBe(false)
	})

	it('a syntactically valid but currently-missing id is a method-result failure from execute(), selection unchanged', () => {
		const { table } = setup()
		const result = table.methods.selectRow('no-such-deal')
		expect(result.success)
			.toBe(false)
		if (result.success)
			throw new Error('expected a failure')
		expect(result.issues[0]!.source.type)
			.toBe('method-result')
		expect(table.state.selectedRowId.get())
			.toBeNull()
	})

	it('an id absent from the current (filtered) rows is a method-result failure even though it exists in the store', () => {
		const { table, stageFilter } = setup()
		stageFilter.state.value.set('won')
		// deal-1 is a real seed deal (stage "lead"), just not currently visible under the "won" filter.
		const result = table.methods.selectRow('deal-1')
		expect(result.success)
			.toBe(false)
		if (result.success)
			throw new Error('expected a failure')
		expect(result.issues[0]!.source.type)
			.toBe('method-result')
		expect(table.state.selectedRowId.get())
			.toBeNull()
	})
})

describe('table selection retention — filtering hides selectedRow without mutating selectedRowId', () => {
	it('selectedRow goes null while selectedRowId is retained, and empty reflects the filtered rows', () => {
		const { table, stageFilter } = setup()
		expect(table.methods.selectRow('deal-1').success)
			.toBe(true)

		stageFilter.state.value.set('won')

		expect(table.state.selectedRowId.get())
			.toBe('deal-1')
		const selectedRow = table.properties.selectedRow.get()
		expect(selectedRow)
			.toEqual({ success: true, value: null })
		expect(table.properties.empty.get())
			.toEqual({ success: true, value: false })
	})

	it('selectedRow reappears once the retained id becomes visible again, without re-selecting', () => {
		const { table, stageFilter } = setup()
		expect(table.methods.selectRow('deal-1').success)
			.toBe(true)
		stageFilter.state.value.set('won')
		expect(table.properties.selectedRow.get())
			.toEqual({ success: true, value: null })

		stageFilter.state.value.set('all')

		expect(table.state.selectedRowId.get())
			.toBe('deal-1')
		const selectedRow = table.properties.selectedRow.get()
		expect(selectedRow.success && selectedRow.value?.id)
			.toBe('deal-1')
	})
})

describe('table.empty', () => {
	it('is false when rows are present', () => {
		const { table } = setup()
		expect(table.properties.empty.get())
			.toEqual({ success: true, value: false })
	})

	it('is true when the search matches no deal', () => {
		const { table, search } = setup()
		search.state.value.set('no-such-deal-exists')
		expect(table.properties.empty.get())
			.toEqual({ success: true, value: true })
	})
})

describe('table.properties.rowIdKey / columns — Lab-private semantic projection of own resolved config (PR #22 review 4941241562 finding 1)', () => {
	it('reflects the canonical preset\'s configured rowIdKey/columns verbatim', () => {
		const { table } = setup()
		expect(table.properties.rowIdKey.get())
			.toEqual({ success: true, value: 'id' })
		const columns = table.properties.columns.get()
		expect(columns.success && columns.value.map(column => column.key))
			.toEqual(['company', 'contact', 'owner', 'stage', 'amount'])
		expect(columns.success && columns.value.find(column => column.key === 'amount')?.format)
			.toBe('currency')
	})
})

describe('table keyed by a configured rowIdKey other than "id" (PR #22 review 4941241562 finding 1 regression)', () => {
	it('selectRow succeeds with a company value, and rows/selectedRow key off the configured rowIdKey — not "id"', () => {
		const sourceText = defaultCrmPreset.sourceText.replace('"rowIdKey": "id"', '"rowIdKey": "company"')
		const { runtime } = createCrmRuntime(sourceText)
		const table = widgetOfType(runtime, 'deal-table', 'Table')

		expect(table.properties.rowIdKey.get())
			.toEqual({ success: true, value: 'company' })

		// deal-3's company (not its id) is now the legal selector.
		const result = table.methods.selectRow('Cobalt Health')
		expect(result.success)
			.toBe(true)
		expect(table.state.selectedRowId.get())
			.toBe('Cobalt Health')

		const selectedRow = table.properties.selectedRow.get()
		expect(selectedRow.success && selectedRow.value?.id)
			.toBe('deal-3')
		expect(selectedRow.success && selectedRow.value?.company)
			.toBe('Cobalt Health')

		// The stale "id" value must no longer work as a selector once rowIdKey is reconfigured.
		const staleIdResult = table.methods.selectRow('deal-3')
		expect(staleIdResult.success)
			.toBe(false)
	})
})

describe('detailPanel.properties.fields — Lab-private semantic projection of own resolved config (PR #22 review 4941241562 finding 1)', () => {
	it('reflects the canonical preset\'s configured fields verbatim, including format', () => {
		const { runtime } = createCrmRuntime()
		const detail = widgetOfType(runtime, 'deal-detail', 'DetailPanel')
		const fields = detail.properties.fields.get()
		expect(fields.success && fields.value.map(field => field.key))
			.toEqual(['company', 'contact', 'owner', 'stage', 'amount'])
		expect(fields.success && fields.value.find(field => field.key === 'stage')?.format)
			.toBe('badge')
	})
})
