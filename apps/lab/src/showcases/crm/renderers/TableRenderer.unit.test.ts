// @vitest-environment happy-dom
/**
 * Diagnostic #28 accessibility fix — cheap attribute-wiring assertions only: native table semantics,
 * keyboard-focusable data rows, and `aria-current` tied to semantic `Table.selectedRowId`. #43 adds a
 * presentation-only locale dependency for the table's fixed empty-state copy; this harness supplies an
 * English identity translator without changing any of the semantic/accessibility assertions.
 */
import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'
import { LabI18nKey } from '../../../composables/use-lab-i18n'
import { createCrmHarness, createCrmRuntime, widgetOfType } from '../test-support'
import TableRenderer from './TableRenderer.vue'

describe('tableRenderer', () => {
	it('keeps native table roles, makes every row a Tab stop, and reflects selection via aria-current', async () => {
		const { runtime } = createCrmRuntime()
		const HarnessRenderer = createCrmHarness({ Table: TableRenderer })

		const wrapper = mount(HarnessRenderer, {
			props: { runtime },
			global: {
				config: { globalProperties: { pika: (value: unknown) => JSON.stringify(value) } },
				provide: {
					[LabI18nKey as symbol]: {
						locale: { value: 'en' },
						locales: ['en', 'zh-TW'],
						setLocale: () => {},
						t: (source: string) => source,
					},
				},
			},
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
			expect(tr.attributes('aria-current'))
				.toBeUndefined()
			for (const td of tr.findAll('td')) {
				expect(td.attributes('role'))
					.toBeUndefined()
			}
		}

		const table_ = widgetOfType(runtime, 'deal-table', 'Table')
		const result = table_.methods.selectRow('deal-1')
		expect(result.ok)
			.toBe(true)
		await wrapper.vm.$nextTick()

		const currentRows = wrapper.findAll('tbody tr[aria-current="true"]')
		expect(currentRows.length)
			.toBe(1)
		expect(currentRows[0]?.text())
			.toContain('Aurora Systems')

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
