// @vitest-environment happy-dom
/**
 * Diagnostic #28 accessibility fix — cheap attribute-wiring assertion only: the visible `label`'s `for`
 * matches the `select`'s `id`. `SelectInput` is reused as both `stage-filter` and `stage-editor`
 * (`../presets.ts`); asserting this against `stage-filter` (the toolbar instance, reachable without
 * opening the modal) is sufficient since both instances share this exact renderer. Behavioral
 * focus/keyboard coverage belongs to the real-browser contract suite (diagnostic #28), not here.
 */
import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'
import { createCrmHarness, createCrmRuntime } from '../test-support'
import SelectInputRenderer from './SelectInputRenderer.vue'

describe('selectInputRenderer', () => {
	it('associates its visible label with the select via for/id', async () => {
		const { runtime } = createCrmRuntime()
		const HarnessRenderer = createCrmHarness({ SelectInput: SelectInputRenderer })

		const wrapper = mount(HarnessRenderer, {
			props: { runtime },
			global: { config: { globalProperties: { pika: (value: unknown) => JSON.stringify(value) } } },
		})
		await wrapper.vm.$nextTick()

		const select = wrapper.find('select')
		const label = wrapper.find('label')
		expect(select.exists())
			.toBe(true)
		expect(label.attributes('for'))
			.toBe(select.attributes('id'))
		expect(select.attributes('id'))
			.toBeTruthy()
	})
})
