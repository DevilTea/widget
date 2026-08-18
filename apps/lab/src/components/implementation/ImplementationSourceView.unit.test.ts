// @vitest-environment happy-dom
/**
 * `ImplementationSourceView` owns two presentation boundaries worth pinning here:
 *
 * - Shiki is the HTML-escaping boundary for arbitrary code text, including user-editable Applied
 *   instance content.
 * - issue #46: literal U+0009 tabs render at the shared four-column width without normalizing the
 *   source string; Copy must still receive the original bytes/text.
 */
import { flushPromises, mount } from '@vue/test-utils'
import { describe, expect, it, vi } from 'vitest'
import ImplementationSourceView from './ImplementationSourceView.vue'

const globalStubConfig = {
	global: { config: { globalProperties: { pika: (value: unknown) => JSON.stringify(value) } } },
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
