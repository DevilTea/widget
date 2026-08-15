// @vitest-environment happy-dom
/**
 * Issue #28 accessibility fix — cheap attribute-wiring assertions only: the dialog's accessible name is
 * tied to the visible title via `aria-labelledby`, and the native `<dialog>` element's own open/closed
 * state stays in sync with the semantic `Modal.open` State (driving `Modal.open()`/`close()` directly,
 * the same generic Methods `ModalRenderer.vue` itself routes Escape through — see that file's header for
 * why routing Escape to `Modal.close()` rather than any specific consumer's `cancel()` is safe here).
 *
 * happy-dom does implement `HTMLDialogElement.showModal()`/`close()` (as plain `open` attribute
 * toggles — see `node_modules/happy-dom/.../HTMLDialogElement.ts`), so open/closed attribute-syncing is
 * exercisable here; it does not simulate focus containment, `inert` background, or a real
 * Escape-triggered `cancel` event, so that behavior — plus focus-move-in/focus-restore-out — stays with
 * the real-browser contract suite (issue #28), not this file.
 */
import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'
import { createCrmHarness, createCrmRuntime, widgetOfType } from '../test-support'
import ModalRenderer from './ModalRenderer.vue'

describe('modalRenderer', () => {
	it('ties the dialog\'s accessible name to the visible title and keeps the native element in sync with Modal.open', async () => {
		const { runtime } = createCrmRuntime()
		const HarnessRenderer = createCrmHarness({ Modal: ModalRenderer })

		const wrapper = mount(HarnessRenderer, {
			props: { runtime },
			global: { config: { globalProperties: { pika: (value: unknown) => JSON.stringify(value) } } },
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
