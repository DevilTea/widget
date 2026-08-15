// @vitest-environment happy-dom
/**
 * Issue #28 accessibility fix — cheap attribute-wiring assertions only (see this file's ARIA-pattern
 * rationale in `TableRenderer.vue`'s own file header): `role="grid"`/`row`/`columnheader`/`gridcell` are
 * present where the chosen pattern requires them, every data row is a Tab stop (`tabindex="0"`), and
 * `aria-selected` tracks `Table.selectedRowId` — the exact same State a pointer click already drove.
 * Behavioral focus/keyboard coverage (Enter/Space activation, focus-visible rendering) belongs to the
 * real-browser contract suite (issue #28), not here.
 */
import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'
import { createCrmHarness, createCrmRuntime, widgetOfType } from '../test-support'
import TableRenderer from './TableRenderer.vue'

describe('tableRenderer', () => {
	it('exposes a grid/row/gridcell ARIA structure with keyboard-focusable, aria-selected rows', async () => {
		const { runtime } = createCrmRuntime()
		const HarnessRenderer = createCrmHarness({ Table: TableRenderer })

		const wrapper = mount(HarnessRenderer, {
			props: { runtime },
			global: { config: { globalProperties: { pika: (value: unknown) => JSON.stringify(value) } } },
		})
		await wrapper.vm.$nextTick()

		const table = wrapper.find('table')
		expect(table.attributes('role'))
			.toBe('grid')

		const headerRow = wrapper.find('thead tr')
		expect(headerRow.attributes('role'))
			.toBe('row')
		const columnHeaders = wrapper.findAll('thead th')
		expect(columnHeaders.length)
			.toBeGreaterThan(0)
		for (const th of columnHeaders) {
			expect(th.attributes('role'))
				.toBe('columnheader')
		}

		const dataRows = wrapper.findAll('tbody tr')
		expect(dataRows.length)
			.toBeGreaterThan(0)
		for (const tr of dataRows) {
			expect(tr.attributes('role'))
				.toBe('row')
			expect(tr.attributes('tabindex'))
				.toBe('0')
			// No selection yet — every row starts unselected.
			expect(tr.attributes('aria-selected'))
				.toBe('false')
			for (const td of tr.findAll('td')) {
				expect(td.attributes('role'))
					.toBe('gridcell')
			}
		}

		// Drive selection through the exact same semantic Method a pointer click uses — never
		// renderer-local state — and confirm `aria-selected` reflects it on the matching row only.
		const table_ = widgetOfType(runtime, 'deal-table', 'Table')
		const result = table_.methods.selectRow('deal-1')
		expect(result.success)
			.toBe(true)
		await wrapper.vm.$nextTick()

		const selectedRows = wrapper.findAll('tbody tr[aria-selected="true"]')
		expect(selectedRows.length)
			.toBe(1)
		expect(selectedRows[0]?.text())
			.toContain('Aurora Systems')
	})
})
