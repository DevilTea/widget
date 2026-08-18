// @vitest-environment happy-dom
/**
 * Issue #28 accessibility fix — cheap attribute-wiring assertions only: the dialog's accessible name is
 * tied to the visible title via `aria-labelledby`, and the native `<dialog>` element's own open/closed
 * state stays in sync with the semantic `Modal.open` State. #43 adds a presentation-only locale
 * dependency; this harness supplies an English identity translator without changing the semantic test.
 */
import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'
import { LabI18nKey } from '../../../composables/use-lab-i18n'
import { createCrmHarness, createCrmRuntime, widgetOfType } from '../test-support'
import ModalRenderer from './ModalRenderer.vue'

describe('modalRenderer', () => {
	it('ties the dialog\'s accessible name to the visible title and keeps the native element in sync with Modal.open', async () => {
		const { runtime } = createCrmRuntime()
		const HarnessRenderer = createCrmHarness({ Modal: ModalRenderer })

		const wrapper = mount(HarnessRenderer, {
			props: { runtime },
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
		})
		await wrapper.vm.$nextTick()

		const dialog = wrapper.find('dialog')
		expect(dialog.exists())
			.toBe(true)
		expect(dialog.element.hasAttribute('open'))
			.toBe(false)

		const labelledbyId = dialog.attributes('aria-labelledby')
		expect(labelledbyId)
			.toBeTruthy()
		const title = wrapper.find(`#${labelledbyId}`)
		expect(title.exists())
			.toBe(true)
		expect(title.text())
			.toBe('Change deal stage')

		const modal = widgetOfType(runtime, 'stage-modal', 'Modal')
		modal.methods.open()
		await wrapper.vm.$nextTick()
		await wrapper.vm.$nextTick()
		expect(wrapper.find('dialog').element.hasAttribute('open'))
			.toBe(true)

		modal.methods.close()
		await wrapper.vm.$nextTick()
		await wrapper.vm.$nextTick()
		expect(wrapper.find('dialog').element.hasAttribute('open'))
			.toBe(false)
	})
})
