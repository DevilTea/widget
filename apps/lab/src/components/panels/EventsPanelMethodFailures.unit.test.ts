// @vitest-environment happy-dom

import type { VueWrapper } from '@vue/test-utils'
import type { LabStore } from '../../composables/use-lab-store'
import type { PanelVisibilityApi } from '../../composables/use-panel-visibility'
import type { Preview } from '../../events/test-support'
import { mount } from '@vue/test-utils'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { nextTick, shallowRef } from 'vue'
import { LabStoreKey } from '../../composables/use-lab-store'
import { createPreview, disposePreviews } from '../../events/test-support'
import { labI18nProvide } from '../../test-support-i18n'
import { testGlobalPlugins } from '../../test-support-ui'
import EventsPanel from './EventsPanel.vue'

/**
 * Issue #230, audit U08: the Events log lists Method failures next to Events, labelled as Method failures, from a real Core
 * Runtime behind a real Inspector Agent.
 */
const mounted: VueWrapper[] = []
afterEach(() => {
	for (const wrapper of mounted.splice(0))
		wrapper.unmount()
	disposePreviews()
	localStorage.clear()
})

async function settle(): Promise<void> {
	for (let i = 0; i < 20; i++)
		await Promise.resolve()
	await nextTick()
}

async function mountPanel(options: { nested?: boolean, locale?: 'en' | 'zh-TW' } = {}) {
	const preview = await createPreview(3, { nested: options.nested })
	const connection = shallowRef<Preview['connection'] | null>(preview.connection)
	const previewFocus = shallowRef<{ nodeId: number } | null>(null)
	const setFocus = vi.fn()
	const store = {
		previewHost: { connection, error: shallowRef<string | null>(null) },
		previewFocus,
		preview: shallowRef({ revision: 3 }),
		documentState: shallowRef({ revision: 3 }),
		showcaseId: shallowRef('survey'),
		setFocus,
	} as unknown as LabStore
	const api: PanelVisibilityApi = { isVisible: true, onDidVisibilityChange: () => ({ dispose: () => {} }) }
	const wrapper = mount(EventsPanel, {
		props: { params: { api } },
		global: {
			plugins: testGlobalPlugins,
			provide: { ...labI18nProvide(options.locale ?? 'en'), [LabStoreKey as symbol]: store },
		},
	})
	mounted.push(wrapper)
	await settle()
	return { wrapper, preview, setFocus, previewFocus, connection }
}

const failures = (wrapper: VueWrapper) => wrapper.findAll('[data-testid="method-failure-entry"]')
const events = (wrapper: VueWrapper) => wrapper.findAll('[data-testid="event-entry"]')
function text(wrapper: VueWrapper, testId: string) {
	return wrapper.get(`[data-testid="${testId}"]`)
		.text()
}

describe('eventsPanel Method failures', () => {
	it('lists a Method failure labelled as one, with its widget, Method, code, reason and verbatim message', async () => {
		const { wrapper, preview } = await mountPanel()
		preview.check(false)
		await nextTick()

		const [entry] = failures(wrapper)
		expect(entry)
			.toBeDefined()
		expect(entry!.get('[data-testid="method-failure-badge"]')
			.text())
			.toBe('Method failure')
		expect(entry!.get('[data-testid="event-widget"]')
			.text())
			.toBe('notifier : Notifier')
		expect(entry!.get('[data-testid="method-failure-name"]')
			.text())
			.toBe('check()')
		expect(entry!.get('[data-testid="method-failure-summary"]')
			.text())
			.toBe('invalid-method-result · not-ok · The check failed.')
		expect(entry!.get('[data-testid="event-revision"]')
			.text())
			.toBe('Preview r3')
		// It is not an Event.
		expect(events(wrapper))
			.toHaveLength(0)
	})

	it('opens every diagnostic of the failure with the returned result', async () => {
		const { wrapper, preview } = await mountPanel()
		preview.check(false)
		await nextTick()
		const [entry] = failures(wrapper)
		expect(entry!.find('[data-testid="method-failure-detail"]')
			.exists())
			.toBe(false)
		await entry!.get('[data-testid="method-failure-expand"]')
			.trigger('click')
		const detail = entry!.get('[data-testid="method-failure-detail"]')
		expect(detail.get('[data-testid="method-diagnostic-code"]')
			.text())
			.toBe('invalid-method-result')
		expect(detail.get('[data-testid="method-diagnostic-message"]')
			.text())
			.toBe('The check failed.')
		expect(detail.get('[data-testid="method-diagnostic-reason"]')
			.text())
			.toBe('not-ok')
		expect(detail.get('[data-testid="method-diagnostic-result"]')
			.text())
			.toContain('false')
	})

	it('records a repeated identical failure as another entry, and a later success as nothing', async () => {
		const { wrapper, preview } = await mountPanel()
		preview.check(false)
		preview.check(false)
		preview.check(true)
		await nextTick()
		expect(failures(wrapper))
			.toHaveLength(2)
	})

	it('says which Methods it watches, and speaks of entries once a Method failure was recorded', async () => {
		const { wrapper, preview } = await mountPanel()
		expect(text(wrapper, 'events-methods-listening'))
			.toBe('Watching 3 Methods for failed calls.')
		expect(text(wrapper, 'events-count'))
			.toBe('0 recorded Events')

		preview.fire(1)
		await nextTick()
		expect(text(wrapper, 'events-count'))
			.toBe('1 recorded Event')

		preview.check(false)
		await nextTick()
		expect(text(wrapper, 'events-count'))
			.toBe('2 recorded entries')
	})

	it('filters by kind, and the widget filter and the selected widget apply to Method failures too', async () => {
		const { wrapper, preview, previewFocus } = await mountPanel({ nested: true })
		preview.fire(1, 'notifier')
		preview.check(false, 'notifier')
		preview.check(false, 'inner')
		await nextTick()
		expect(events(wrapper))
			.toHaveLength(1)
		expect(failures(wrapper))
			.toHaveLength(2)

		await wrapper.get('[data-testid="events-filter-kind"]')
			.setValue('method-failures')
		expect(events(wrapper))
			.toHaveLength(0)
		expect(failures(wrapper))
			.toHaveLength(2)
		expect(text(wrapper, 'events-count'))
			.toBe('2 of 3 recorded entries shown')

		await wrapper.get('[data-testid="events-filter-widget"]')
			.setValue('inner')
		expect(failures(wrapper))
			.toHaveLength(1)
		expect(failures(wrapper)[0]!.attributes('data-widget'))
			.toBe('inner')

		await wrapper.get('[data-testid="events-filter-widget"]')
			.setValue('')
		await wrapper.get('[data-testid="events-filter-kind"]')
			.setValue('events')
		expect(events(wrapper))
			.toHaveLength(1)
		expect(failures(wrapper))
			.toHaveLength(0)

		// "Only the selected widget": the Preview's selection (a node of the Blueprint snapshot) selects failures as well.
		await wrapper.get('[data-testid="events-filter-kind"]')
			.setValue('all')
		previewFocus.value = { nodeId: preview.connection.blueprint.nodes.find(node => node.widgetId === 'inner')!.nodeId }
		await wrapper.get('[data-testid="events-only-selected"]')
			.setValue(true)
		expect(failures(wrapper)
			.map(row => row.attributes('data-widget')))
			.toEqual(['inner'])
		expect(events(wrapper))
			.toHaveLength(0)
	})

	it('an Event name filter never shows a Method failure', async () => {
		const { wrapper, preview } = await mountPanel()
		preview.fire(1)
		preview.check(false)
		await nextTick()
		await wrapper.get('[data-testid="events-filter-event"]')
			.setValue('changed')
		expect(events(wrapper))
			.toHaveLength(1)
		expect(failures(wrapper))
			.toHaveLength(0)
	})

	it('selects the failing widget in the Preview from its entry', async () => {
		const { wrapper, preview, setFocus } = await mountPanel()
		preview.check(false)
		await nextTick()
		await failures(wrapper)[0]!.get('[data-testid="event-widget"]')
			.trigger('click')
		expect(setFocus)
			.toHaveBeenCalledWith('preview', { nodeId: preview.connection.blueprint.nodes.find(node => node.widgetId === 'notifier')!.nodeId })
	})

	it('counts Method failures skipped while paused apart from Events', async () => {
		const { wrapper, preview } = await mountPanel()
		await wrapper.get('[data-testid="events-pause"]')
			.trigger('click')
		preview.check(false)
		preview.check(false)
		await nextTick()
		expect(failures(wrapper))
			.toHaveLength(0)
		expect(text(wrapper, 'events-paused-failures-note'))
			.toBe('Paused: 2 Method failures were not recorded.')
	})

	it('shows the Taiwan Chinese copy in a zh-TW Lab and keeps Core and Runtime text verbatim', async () => {
		const { wrapper, preview } = await mountPanel({ locale: 'zh-TW' })
		expect(text(wrapper, 'events-methods-listening'))
			.toBe('正在監看 3 個 Methods 的失敗呼叫。')
		preview.check(false)
		await nextTick()
		const [entry] = failures(wrapper)
		expect(entry!.get('[data-testid="method-failure-badge"]')
			.text())
			.toBe('Method 失敗')
		expect(entry!.get('[data-testid="method-failure-summary"]')
			.text())
			.toBe('invalid-method-result · not-ok · The check failed.')
		expect(text(wrapper, 'events-count'))
			.toBe('已記錄 1 筆項目')
	})
})
