// @vitest-environment happy-dom

import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'
import { testGlobalProperties } from '../../test-support'
import { labI18nProvide } from '../../test-support-i18n'
import ConfigView from './ConfigView.vue'

function mountView(rawConfig: unknown, config: unknown) {
	return mount(ConfigView, {
		props: { rawConfig, config },
		global: { config: { globalProperties: testGlobalProperties }, provide: labI18nProvide() },
	})
}

describe('configView (audit U25)', () => {
	it('prints one block, with a note, when the resolved config equals the authored one', () => {
		const wrapper = mountView({ title: 'T', n: 1 }, { n: 1, title: 'T' })
		expect(wrapper.attributes('data-config-state'))
			.toBe('same')
		expect(wrapper.findAll('pre'))
			.toHaveLength(1)
		expect(wrapper.get('[data-testid="config-same-note"]')
			.text())
			.toBe('The resolved config is identical to the authored config.')
		expect(wrapper.find('[data-testid="config-show-authored"]')
			.exists())
			.toBe(false)
	})

	it('shows the resolved config first and the authored one on request, never both at once', async () => {
		const wrapper = mountView({ title: 'T' }, { title: 'T', recovered: false })
		expect(wrapper.attributes('data-config-state'))
			.toBe('different')
		expect(wrapper.findAll('pre'))
			.toHaveLength(1)
		expect(JSON.parse(wrapper.get('pre')
			.text()))
			.toEqual({ title: 'T', recovered: false })
		expect(wrapper.get('[data-testid="config-show-resolved"]')
			.attributes('aria-pressed'))
			.toBe('true')
		expect(wrapper.get('[data-testid="config-differs-note"]')
			.text())
			.toContain('Differs in: recovered')

		await wrapper.get('[data-testid="config-show-authored"]')
			.trigger('click')
		expect(wrapper.findAll('pre'))
			.toHaveLength(1)
		expect(JSON.parse(wrapper.get('pre')
			.text()))
			.toEqual({ title: 'T' })
		expect(wrapper.get('[data-testid="config-show-authored"]')
			.attributes('aria-pressed'))
			.toBe('true')
		expect(wrapper.get('[data-testid="config-show-resolved"]')
			.attributes('aria-pressed'))
			.toBe('false')

		await wrapper.get('[data-testid="config-show-resolved"]')
			.trigger('click')
		expect(JSON.parse(wrapper.get('pre')
			.text()))
			.toEqual({ title: 'T', recovered: false })
	})

	it('says so when nothing was authored for a config that resolved to a value', async () => {
		const wrapper = mountView(undefined, { size: 3 })
		await wrapper.get('[data-testid="config-show-authored"]')
			.trigger('click')
		expect(wrapper.get('pre')
			.text())
			.toBe('(nothing authored)')
	})

	it('says so, in the Resolved mode too, when there is no resolved config (not "nothing authored")', () => {
		const wrapper = mountView({ size: 3 }, undefined)
		expect(wrapper.get('pre')
			.text())
			.toBe('(no resolved config)')
	})
})
