// @vitest-environment happy-dom

import { mount } from '@vue/test-utils'
import { afterEach, describe, expect, it } from 'vitest'
import { LabI18nKey } from '../composables/use-lab-i18n'
import { testGlobalProperties } from '../test-support'
import { testGlobalPlugins } from '../test-support-ui'
import PanelDescriptionBar from './PanelDescriptionBar.vue'

const i18n = { t: (key: string) => key } as unknown as import('../composables/use-lab-i18n').LabI18nStore

function mountBar(storageKey: string) {
	return mount(PanelDescriptionBar, {
		props: { storageKey, text: 'Describes the panel' },
		global: {
			config: { globalProperties: testGlobalProperties },
			plugins: testGlobalPlugins,
			provide: { [LabI18nKey as symbol]: i18n },
		},
	})
}

afterEach(() => {
	sessionStorage.clear()
})

describe('panelDescriptionBar', () => {
	it('renders the description and an accessible dismiss button made of a real Nuxt UI UButton', () => {
		const wrapper = mountBar('test:bar:render')
		expect(wrapper.text())
			.toContain('Describes the panel')
		const button = wrapper.get('button[aria-label="Dismiss"]')
		expect(button.attributes('type'))
			.toBe('button')
		// A real UButton, not a stub: it carries Nuxt UI's `data-slot` hook that the scoped reset relies on.
		expect(button.attributes('data-slot'))
			.toBe('base')
		// The visible glyph is an icon (decorative), never the accessible name.
		expect(button.text())
			.toBe('')
	})

	it('dismisses for the session and removes the bar', async () => {
		const wrapper = mountBar('test:bar:dismiss')
		await wrapper.get('button[aria-label="Dismiss"]')
			.trigger('click')
		expect(wrapper.find('button')
			.exists())
			.toBe(false)
		expect(sessionStorage.getItem('test:bar:dismiss'))
			.toBe('1')
	})
})
