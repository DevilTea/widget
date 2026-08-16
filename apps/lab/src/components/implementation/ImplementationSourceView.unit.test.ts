// @vitest-environment happy-dom
/**
 * P3 merge-gate review round 1, non-blocking note: the `v-html` rationale in `ImplementationSourceView.vue`
 * is that Shiki's `codeToHtml` is itself the HTML-escaping boundary for arbitrary code text — not any
 * assumption that `code` is always Lab-curated/never user-controlled (the Applied-instance JSON is
 * derived from the user-editable applied Source). This pins that actual escaping guarantee: a payload
 * containing a real HTML tag renders as visible escaped TEXT, never an injected live element.
 */
import { flushPromises, mount } from '@vue/test-utils'
import { describe, expect, it, vi } from 'vitest'
import ImplementationSourceView from './ImplementationSourceView.vue'

const globalStubConfig = {
	global: { config: { globalProperties: { pika: (value: unknown) => JSON.stringify(value) } } },
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
		// No live `<img>` element was injected — Shiki escaped the payload into markup/text.
		expect(codeBlock.findAll('img').length)
			.toBe(0)
		// The original text is still visible, verbatim, as rendered (escaped) content.
		expect(codeBlock.text())
			.toContain(payload)
	})
})
