// @vitest-environment happy-dom

import type { LabStore } from '../composables/use-lab-store'
import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'
import { defineComponent, h, nextTick, ref, shallowRef } from 'vue'
import { useEventLog } from '../composables/use-event-log'
import { LabStoreKey } from '../composables/use-lab-store'
import { createPreview } from '../events/test-support'
import { labI18nProvide } from '../test-support-i18n'
import NonClosableTab from './NonClosableTab.vue'

function fakeApi(id: string, title: string) {
	return { id, title, onDidTitleChange: () => ({ dispose: () => {} }) }
}

/**
 * Issue #230 (audit U09): the tab shows how many Events arrived while the Events log was not visible. Since Lab UX phase 3B the
 * log is an expert view in the Tools group, opened on request, so the count is on the Tools tab, which is always there.
 */
describe('nonClosableTab unseen Events', () => {
	it('draws the count on the Tools tab only, hides it from the accessibility tree and gives it to assistive technology as text', async () => {
		const preview = await createPreview(1)
		const store = {
			previewHost: { connection: shallowRef(preview.connection), error: shallowRef(null) },
			preview: shallowRef({ revision: 1 }),
			showcaseId: shallowRef('survey'),
		} as unknown as LabStore
		const provide = { ...labI18nProvide(), [LabStoreKey as symbol]: store }
		const global = { provide }

		const visible = ref(false)
		const Panel = defineComponent({
			setup() {
				useEventLog(visible)
				return () => h('div')
			},
		})
		const panel = mount(Panel, { global })
		const events = mount(NonClosableTab, { props: { params: { api: fakeApi('tools', 'Tools') as never } }, global })
		const runtime = mount(NonClosableTab, { props: { params: { api: fakeApi('explain', 'Explain') as never } }, global })
		await new Promise(resolve => setTimeout(resolve, 0))
		await nextTick()
		expect(events.find('[data-testid="events-unseen"]')
			.exists())
			.toBe(false)
		expect(events.text())
			.toBe('Tools')

		preview.ping()
		preview.ping()
		await nextTick()
		const badge = events.get('[data-testid="events-unseen"]')
		expect(badge.text())
			.toBe('2')
		expect(badge.attributes('aria-hidden'))
			.toBe('true')
		// One hidden text names the tab; the drawn title and badge are hidden from assistive technology.
		expect(events.get('[data-testid="events-tab-name"]')
			.text())
			.toBe('Tools, 2 new')
		expect(events.findAll('[aria-hidden="true"]')
			.map(node => node.text()))
			.toEqual(['Tools', '2'])
		// Another tab has no count.
		expect(runtime.text())
			.toBe('Explain')

		visible.value = true
		await nextTick()
		expect(events.find('[data-testid="events-unseen"]')
			.exists())
			.toBe(false)
		panel.unmount()
		events.unmount()
		runtime.unmount()
		preview.dispose()
	})
})
