/**
 * `Table.selectRow`/`selectedRow`/`empty` (checkpoint §2) against the real canonical preset
 * (`../presets.ts`). Covers the locked `validateArgs`-vs-`execute` split, the selection-retention rule
 * (filtering hides `selectedRow` without mutating `selectedRowId`), and reappearance once the retained
 * id becomes visible again.
 */

import { describe, expect, it } from 'vitest'
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
