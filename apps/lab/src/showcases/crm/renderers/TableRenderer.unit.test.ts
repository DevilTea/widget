// @vitest-environment happy-dom
/**
 * Issue #28 accessibility fix — cheap attribute-wiring assertions only (see this file's ARIA-pattern
 * rationale in `TableRenderer.vue`'s own file header, PR #32 review round 1): native table semantics
 * throughout (no `role` overrides), every data row is a Tab stop (`tabindex="0"`), and `aria-current`
 * is present (`"true"`) only on the row matching `Table.selectedRowId` — the exact same State a pointer
 * click already drove — and absent everywhere else. Behavioral focus/keyboard coverage (Enter/Space
 * activation, focus-visible rendering) belongs to the real-browser contract suite (issue #28), not here.
 */
import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'
import { createCrmHarness, createCrmRuntime, widgetOfType } from '../test-support'
import TableRenderer from './TableRenderer.vue'

describe('tableRenderer', () => {
	it('keeps native table roles, makes every row a Tab stop, and reflects selection via aria-current', async () => {
		const { runtime } = createCrmRuntime()
		const HarnessRenderer = createCrmHarness({ Table: TableRenderer })

		const wrapper = mount(HarnessRenderer, {
			props: { runtime },
			global: { config: { globalProperties: { pika: (value: unknown) => JSON.stringify(value) } } },
		})
		await wrapper.vm.$nextTick()

		const table = wrapper.find('table')
		expect(table.attributes('role'))
			.toBeUndefined()

		const headerRow = wrapper.find('thead tr')
		expect(headerRow.attributes('role'))
			.toBeUndefined()
		const columnHeaders = wrapper.findAll('thead th')
		expect(columnHeaders.length)
			.toBeGreaterThan(0)
		for (const th of columnHeaders) {
			expect(th.attributes('role'))
				.toBeUndefined()
		}

		const dataRows = wrapper.findAll('tbody tr')
		expect(dataRows.length)
			.toBeGreaterThan(0)
		for (const tr of dataRows) {
			expect(tr.attributes('role'))
				.toBeUndefined()
			expect(tr.attributes('tabindex'))
				.toBe('0')
			// No selection yet — every row starts without an `aria-current` attribute at all.
			expect(tr.attributes('aria-current'))
				.toBeUndefined()
			for (const td of tr.findAll('td')) {
				expect(td.attributes('role'))
					.toBeUndefined()
			}
		}

		// Drive selection through the exact same semantic Method a pointer click uses — never
		// renderer-local state — and confirm `aria-current="true"` reflects it on the matching row only.
		const table_ = widgetOfType(runtime, 'deal-table', 'Table')
		const result = table_.methods.selectRow('deal-1')
		expect(result.success)
			.toBe(true)
		await wrapper.vm.$nextTick()

		const currentRows = wrapper.findAll('tbody tr[aria-current="true"]')
		expect(currentRows.length)
			.toBe(1)
		expect(currentRows[0]?.text())
			.toContain('Aurora Systems')

		// Every other row still has no `aria-current` attribute (not `"false"` — see file header).
		for (const tr of dataRows) {
			if (tr.text()
				.includes('Aurora Systems')) {
				continue
			}
			expect(tr.attributes('aria-current'))
				.toBeUndefined()
		}
	})
})
