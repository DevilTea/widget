// @vitest-environment happy-dom
/** Shiki remains the HTML-escaping boundary while #44 adds a provided presentation theme input. */
import { flushPromises, mount } from '@vue/test-utils'
import { shallowRef } from 'vue'
import { describe, expect, it, vi } from 'vitest'
import { LabThemeKey } from '../../composables/use-lab-theme'
import ImplementationSourceView from './ImplementationSourceView.vue'

const theme = shallowRef<'light' | 'dark'>('dark')
const globalStubConfig = {
	global: {
		config: { globalProperties: { pika: (value: unknown) => JSON.stringify(value) } },
		provide: {
			[LabThemeKey as symbol]: {
				theme,
				themes: ['light', 'dark'],
				setTheme: (next: 'light' | 'dark') => { theme.value = next },
			},
		},
	},
}

describe('implementationSourceView — escaping', () => {
	it('a code string containing a real HTML tag/attribute is rendered as escaped text, never an injected live element', async () => {
		const payload = '<img src=x onerror="window.__pwned = true">'
		const wrapper = mount(ImplementationSourceView, {
			props: { code: payload, lang: 'typescript' },
			...globalStubConfig,
		})

		await vi.waitFor(async () => {
			await flushPromises()
			expect(wrapper.find('[data-testid="implementation-code"]')
				.exists())
				.toBe(true)
		})

		const codeBlock = wrapper.find('[data-testid="implementation-code"]')
		expect(codeBlock.findAll('img').length)
			.toBe(0)
		expect(codeBlock.text())
			.toContain(payload)
	})
})
