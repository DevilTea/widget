// @vitest-environment happy-dom
import { inspectBlueprint } from '@deviltea/widget-core/inspection'
import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'
import { LabI18nKey } from '../../composables/use-lab-i18n'
import { sandboxSystem } from '../../sandbox/system'
import { testGlobalProperties } from '../../test-support'
import DiagnosticList from './DiagnosticList.vue'

const global = {
	config: { globalProperties: testGlobalProperties },
	provide: {
		[LabI18nKey as symbol]: {
			locale: { value: 'en' },
			locales: ['en', 'zh-TW'],
			setLocale: () => {},
			t: (source: string) => source,
		},
	},
}

function mountFor(source: unknown) {
	const blueprint = sandboxSystem.createBlueprint(source)
	const inspection = inspectBlueprint(blueprint)
	const wrapper = mount(DiagnosticList, { props: { diagnostics: blueprint.diagnostics, inspection }, global })
	const rows = blueprint.diagnostics.map((_, index) => wrapper.get(`[data-testid="blueprint-diagnostic-${index}"]`)
		.text())
	return { blueprint, rows }
}

describe('diagnostic list', () => {
	it('renders the duplicate-widget-id and unexpected-widget-field codes from the structured diagnostic', () => {
		const { blueprint, rows } = mountFor({
			id: 'root',
			type: 'Stack',
			extra: true,
			slots: { items: [
				{ id: 'same', type: 'Text', config: { text: 'a' } },
				{ id: 'same', type: 'Text', config: { text: 'b' } },
			] },
		})

		const codes = blueprint.diagnostics.map(diagnostic => diagnostic.code)
		expect(codes)
			.toContain('duplicate-widget-id')
		expect(codes)
			.toContain('unexpected-widget-field')
		expect(codes)
			.not
			.toContain('invalid-widget-id')

		const unexpected = rows[codes.indexOf('unexpected-widget-field')]!
		expect(unexpected)
			.toContain('unexpected-widget-field')
		expect(unexpected)
			.toContain('path: extra')
		expect(unexpected)
			.toContain('widget "root : Stack"')
		expect(rows[codes.indexOf('duplicate-widget-id')])
			.toContain('duplicate-widget-id')
	})

	it('labels an unresolved node by Core\'s id/type hints, with ? for a non-string value', () => {
		const { blueprint, rows } = mountFor({
			id: 'root',
			type: 'Stack',
			slots: { items: [
				{ id: 'mystery-1', type: 'NoSuchType' },
				{ id: 7, type: 'Text' },
			] },
		})

		const locations = blueprint.diagnostics.map((diagnostic, index) => ({ diagnostic, row: rows[index]! }))
		expect(locations.some(({ row }) => row.includes('widget "mystery-1 : NoSuchType (unresolved)"')))
			.toBe(true)
		expect(locations.some(({ row }) => row.includes('widget "? : Text (unresolved)"')))
			.toBe(true)
	})
})
