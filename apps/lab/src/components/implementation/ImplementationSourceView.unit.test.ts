// @vitest-environment happy-dom
/** Shiki is the escaping boundary; #43's viewer localization must not alter arbitrary source text. */
import { flushPromises, mount } from '@vue/test-utils'
import { describe, expect, it, vi } from 'vitest'
import { LabI18nKey } from '../../composables/use-lab-i18n'
import ImplementationSourceView from './ImplementationSourceView.vue'

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
