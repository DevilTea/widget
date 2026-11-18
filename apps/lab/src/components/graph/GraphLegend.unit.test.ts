// @vitest-environment happy-dom
import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'
import { LabI18nKey } from '../../composables/use-lab-i18n'
import GraphLegend from './GraphLegend.vue'

describe('graphLegend Method badges', () => {
	it('explains both the W and the E badge once opened', async () => {
		const wrapper = mount(GraphLegend, {
			global: {
				provide: {
					[LabI18nKey as symbol]: { locale: { value: 'en' }, locales: ['en'], setLocale: () => {}, t: (source: string) => source },
				},
			},
		})
		await wrapper.get('button')
			.trigger('click')

		const text = wrapper.text()
		expect(text)
			.toContain('Method — a "W" badge means it transitively writes State')
		expect(text)
			.toContain('Method — an "E" badge means it transitively emits an Event')
	})

	it('states the direction convention in the words of the Relations view', async () => {
		const wrapper = mount(GraphLegend, {
			global: {
				provide: {
					[LabI18nKey as symbol]: { locale: { value: 'en' }, locales: ['en'], setLocale: () => {}, t: (source: string) => source },
				},
			},
		})
		await wrapper.get('button')
			.trigger('click')

		const direction = wrapper.get('[data-testid="graph-legend-direction"]')
			.text()
		expect(direction)
			.toContain('A → B means A depends on B')
		expect(direction)
			.toContain('"Depends on"')
		expect(direction)
			.toContain('"Used by"')
		// Tags that do not fit are left out, and the Legend says so.
		expect(wrapper.text())
			.toContain('A tag is left out where there is no room for it: the Relations view has the full list.')
	})
})
