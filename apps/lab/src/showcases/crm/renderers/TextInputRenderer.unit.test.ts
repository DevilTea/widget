// @vitest-environment happy-dom
/**
 * Diagnostic #28 accessibility fix — cheap attribute-wiring assertion only: the visible `label`'s `for`
 * matches the `input`'s `id` for `deal-search` (the toolbar's `TextInput` instance, `../presets.ts`).
 * Behavioral focus/keyboard coverage belongs to the real-browser contract suite (diagnostic #28), not here.
 */
import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'
import { createCrmHarness, createCrmRuntime } from '../test-support'
import TextInputRenderer from './TextInputRenderer.vue'

describe('textInputRenderer', () => {
	it('associates its visible label with the input via for/id', async () => {
		const { runtime } = createCrmRuntime()
		const HarnessRenderer = createCrmHarness({ TextInput: TextInputRenderer })

		const wrapper = mount(HarnessRenderer, {
			props: { runtime },
			global: { config: { globalProperties: { pika: (value: unknown) => JSON.stringify(value) } } },
		})
		await wrapper.vm.$nextTick()

		const input = wrapper.find('input[type="text"]')
		const label = wrapper.find('label')
		expect(input.exists())
			.toBe(true)
		expect(label.attributes('for'))
			.toBe(input.attributes('id'))
		expect(input.attributes('id'))
			.toBeTruthy()
	})
})
