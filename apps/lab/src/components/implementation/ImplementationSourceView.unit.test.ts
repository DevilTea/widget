// @vitest-environment happy-dom
/**
 * `ImplementationSourceView` keeps source bytes/text outside both presentation preferences: Shiki
 * escapes arbitrary markup, #44 themes presentation only, #43 localizes viewer chrome only, and #46
 * keeps literal U+0009 tabs on the four-column rendering/copy contract.
 */
import { flushPromises, mount } from '@vue/test-utils'
import { describe, expect, it, vi } from 'vitest'
import { shallowRef } from 'vue'
import { LabI18nKey } from '../../composables/use-lab-i18n'
import { LabThemeKey } from '../../composables/use-lab-theme'
import ImplementationSourceView from './ImplementationSourceView.vue'

const theme = shallowRef<'light' | 'dark'>('dark')
const globalStubConfig = {
	global: {
		config: { globalProperties: { pika: (value: unknown) => JSON.stringify(value) } },
		provide: {
			[LabI18nKey as symbol]: {
				locale: { value: 'en' },
				locales: ['en', 'zh-TW'],
				setLocale: () => {},
				t: (source: string) => source,
			},
			[LabThemeKey as symbol]: {
				theme,
				themes: ['light', 'dark'],
				setTheme: (next: 'light' | 'dark') => { theme.value = next },
			},
		},
	},
}

async function waitForCode(wrapper: ReturnType<typeof mount>): Promise<void> {
	await vi.waitFor(async () => {
		await flushPromises()
		expect(wrapper.find('[data-testid="implementation-code"]')
			.exists())
			.toBe(true)
	})
}

describe('implementationSourceView', () => {
	it('renders arbitrary source as escaped text, never injected live markup', async () => {
		const payload = '<img src=x onerror="window.__pwned = true">'
		const wrapper = mount(ImplementationSourceView, {
			props: { code: payload, lang: 'typescript' },
			...globalStubConfig,
		})

		await waitForCode(wrapper)

		const codeBlock = wrapper.find('[data-testid="implementation-code"]')
		expect(codeBlock.findAll('img').length)
			.toBe(0)
		expect(codeBlock.text())
			.toContain(payload)
	})

	it('renders a literal tab at four columns and copies the original tab-containing source unchanged', async () => {
		const payload = 'const value = {\n\tanswer: 42,\n}'
		const writeText = vi.fn<(text: string) => Promise<void>>()
			.mockResolvedValue(undefined)
		Object.defineProperty(navigator, 'clipboard', {
			configurable: true,
			value: { writeText },
		})

		const wrapper = mount(ImplementationSourceView, {
			props: { code: payload, lang: 'typescript' },
			...globalStubConfig,
		})

		await waitForCode(wrapper)

		const codeBlock = wrapper.find('[data-testid="implementation-code"]')
		expect((codeBlock.element as HTMLElement).style.tabSize)
			.toBe('4')
		expect(codeBlock.text())
			.toContain('\tanswer: 42,')

		await wrapper.get('button')
			.trigger('click')
		await flushPromises()
		expect(writeText)
			.toHaveBeenCalledWith(payload)
	})
})
