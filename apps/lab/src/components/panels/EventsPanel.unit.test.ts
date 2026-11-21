// @vitest-environment happy-dom

import type { VueWrapper } from '@vue/test-utils'
import type { LabStore } from '../../composables/use-lab-store'
import type { PanelVisibilityApi } from '../../composables/use-panel-visibility'
import type { Preview } from '../../events/test-support'
import { mount } from '@vue/test-utils'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { nextTick, shallowRef } from 'vue'
import { LabStoreKey } from '../../composables/use-lab-store'
import { EVENT_LOG_LIMIT } from '../../events/event-log'
import { createPreview, disposePreviews } from '../../events/test-support'
import { labI18nProvide } from '../../test-support-i18n'
import { testGlobalPlugins } from '../../test-support-ui'
import EventsPanel from './EventsPanel.vue'

const mounted: VueWrapper[] = []
afterEach(() => {
	vi.useRealTimers()
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

interface Harness {
	readonly wrapper: VueWrapper
	readonly preview: Preview
	readonly setFocus: ReturnType<typeof vi.fn>
	readonly connection: ReturnType<typeof shallowRef<Preview['connection'] | null>>
	readonly previewFocus: ReturnType<typeof shallowRef<{ nodeId: number } | null>>
	readonly visibility: { isVisible: boolean, listeners: Set<(event: { isVisible: boolean }) => void>, show: (isVisible: boolean) => void }
}

async function mountPanel(options: { nested?: boolean, locale?: 'en' | 'zh-TW' } = {}): Promise<Harness> {
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
	const visibility = {
		isVisible: true,
		listeners: new Set<(event: { isVisible: boolean }) => void>(),
		show(isVisible: boolean) {
			visibility.isVisible = isVisible
			for (const listener of visibility.listeners)
				listener({ isVisible })
		},
	}
	const api: PanelVisibilityApi = {
		get isVisible() {
			return visibility.isVisible
		},
		onDidVisibilityChange: (listener) => {
			visibility.listeners.add(listener)
			return { dispose: () => visibility.listeners.delete(listener) }
		},
	}
	const wrapper = mount(EventsPanel, {
		props: { params: { api } },
		global: {
			plugins: testGlobalPlugins,
			provide: { ...labI18nProvide(options.locale ?? 'en'), [LabStoreKey as symbol]: store },
		},
	})
	mounted.push(wrapper)
	await settle()
	return { wrapper, preview, setFocus, connection, previewFocus, visibility }
}

const rows = (wrapper: VueWrapper) => wrapper.findAll('[data-testid="event-entry"]')

describe('eventsPanel', () => {
	it('says what to do while nothing was emitted yet, and which Events it listens to', async () => {
		const { wrapper } = await mountPanel()
		expect(wrapper.get('[data-testid="events-empty"]')
			.text())
			.toContain('No Events yet.')
		expect(wrapper.get('[data-testid="events-listening"]')
			.text())
			.toBe('Listening to 2 declared Events on 1 widget.')
		expect(wrapper.get('[data-testid="events-count"]')
			.text())
			.toBe('0 recorded Events')
	})

	it('lists each emitted Event newest first with time, Preview revision, widget, name and a payload summary', async () => {
		const { wrapper, preview } = await mountPanel()
		preview.fire(7)
		preview.ping()
		await nextTick()

		const [pinged, changed] = rows(wrapper)
		expect(pinged!.get('[data-testid="event-name"]')
			.text())
			.toBe('pinged')
		expect(pinged!.get('[data-testid="event-summary"]')
			.text())
			.toBe('no payload')
		expect(changed!.get('[data-testid="event-name"]')
			.text())
			.toBe('changed')
		expect(changed!.get('[data-testid="event-widget"]')
			.text())
			.toBe('notifier : Notifier')
		expect(changed!.get('[data-testid="event-revision"]')
			.text())
			.toBe('Preview r3')
		expect(changed!.get('[data-testid="event-time"]')
			.text())
			.toMatch(/^\d{2}:\d{2}:\d{2}\.\d{3}$/)
		expect(changed!.get('[data-testid="event-summary"]')
			.text())
			.toBe('{ "label": "xxxxxxx", "value": 7 }')
		expect(wrapper.get('[data-testid="events-count"]')
			.text())
			.toBe('2 recorded Events')
	})

	it('opens the payload as a value tree, and marks what the Inspector snapshot cut', async () => {
		const { wrapper, preview } = await mountPanel()
		preview.fire(3)
		preview.fire(600)
		await nextTick()
		const [long, short] = rows(wrapper)

		expect(short!.find('[data-testid="event-payload"]')
			.exists())
			.toBe(false)
		await short!.get('[data-testid="event-expand"]')
			.trigger('click')
		const payload = short!.get('[data-testid="event-payload"]')
		expect(payload.text())
			.toContain('"xxx"')
		expect(payload.text())
			.toContain('value:3')
		expect(payload.find('[data-testid="value-snapshot-note"]')
			.exists())
			.toBe(false)

		await long!.get('[data-testid="event-expand"]')
			.trigger('click')
		expect(long!.get('[data-testid="value-truncated"]')
			.text())
			.toBe('… cut by the Inspector snapshot')
		expect(long!.get('[data-testid="value-snapshot-note"]')
			.text())
			.toContain('left out by the Inspector snapshot')
	})

	it('clears the log and the count of dropped entries', async () => {
		const { wrapper, preview } = await mountPanel()
		preview.ping()
		await nextTick()
		expect(rows(wrapper))
			.toHaveLength(1)
		await wrapper.get('[data-testid="events-clear"]')
			.trigger('click')
		expect(rows(wrapper))
			.toHaveLength(0)
		expect(wrapper.get('[data-testid="events-live"]')
			.text())
			.toBe('Events log cleared')
	})

	it('pauses and resumes, saying how many Events were not recorded', async () => {
		const { wrapper, preview } = await mountPanel()
		const pause = wrapper.get('[data-testid="events-pause"]')
		expect(pause.text())
			.toBe('Pause')
		await pause.trigger('click')
		// The label says what a click does now; a pressed state on top of it would say the opposite.
		expect(pause.attributes('aria-pressed'))
			.toBeUndefined()
		expect(pause.text())
			.toBe('Resume')
		expect(wrapper.get('[data-testid="events-paused-note"]')
			.text())
			.toBe('Paused: Events that happen now are not recorded.')

		preview.ping()
		preview.ping()
		await nextTick()
		expect(rows(wrapper))
			.toHaveLength(0)
		expect(wrapper.get('[data-testid="events-paused-note"]')
			.text())
			.toBe('Paused: 2 Events were not recorded.')

		await pause.trigger('click')
		preview.ping()
		await nextTick()
		expect(rows(wrapper))
			.toHaveLength(1)
		expect(wrapper.get('[data-testid="events-paused-note"]')
			.text())
			.toBe('2 Events were not recorded while the log was paused.')
	})

	it('tells that older entries were dropped once the buffer is full', async () => {
		const { wrapper, preview } = await mountPanel()
		expect(wrapper.find('[data-testid="events-dropped-note"]')
			.exists())
			.toBe(false)
		for (let i = 0; i < EVENT_LOG_LIMIT + 3; i++)
			preview.ping()
		await nextTick()
		expect(rows(wrapper))
			.toHaveLength(EVENT_LOG_LIMIT)
		expect(wrapper.get('[data-testid="events-dropped-note"]')
			.text())
			.toBe(`Showing the latest ${EVENT_LOG_LIMIT} Events: 3 older ones were dropped.`)
	})

	it('filters by widget, by Event name and by the selected widget', async () => {
		const { wrapper, preview, previewFocus, connection } = await mountPanel({ nested: true })
		preview.fire(1, 'notifier')
		preview.ping('notifier')
		preview.fire(2, 'inner')
		await nextTick()
		expect(rows(wrapper))
			.toHaveLength(3)

		const names = () => rows(wrapper)
			.map(row => `${row.attributes('data-widget')}:${row.attributes('data-event')}`)
		await wrapper.get('[data-testid="events-filter-widget"]')
			.setValue('inner')
		expect(names())
			.toEqual(['inner:changed'])
		expect(wrapper.get('[data-testid="events-count"]')
			.text())
			.toBe('1 of 3 recorded Events shown')

		await wrapper.get('[data-testid="events-filter-widget"]')
			.setValue('')
		await wrapper.get('[data-testid="events-filter-event"]')
			.setValue('pinged')
		expect(names())
			.toEqual(['notifier:pinged'])

		await wrapper.get('[data-testid="events-filter-event"]')
			.setValue('')
		// "Only the selected widget": nothing selected shows nothing; a selection follows the Preview.
		await wrapper.get('[data-testid="events-only-selected"]')
			.setValue(true)
		expect(names())
			.toEqual([])
		expect(wrapper.get('[data-testid="events-empty"]')
			.text())
			.toBe('No recorded Event matches the filters.')
		const innerNode = connection.value!.blueprint.nodes.find(node => node.widgetId === 'inner')!
		previewFocus.value = { nodeId: innerNode.nodeId }
		await nextTick()
		expect(names())
			.toEqual(['inner:changed'])
		await wrapper.get('[data-testid="events-only-selected"]')
			.setValue(false)
		expect(names())
			.toHaveLength(3)
	})

	it('marks the rows of the selected widget with aria-current', async () => {
		const { wrapper, preview, previewFocus, connection } = await mountPanel({ nested: true })
		preview.fire(1, 'notifier')
		preview.fire(2, 'inner')
		await nextTick()
		const current = () => rows(wrapper)
			.map(row => row.get('[data-testid="event-widget"]')
				.attributes('aria-current') ?? '')
		expect(current())
			.toEqual(['', ''])
		previewFocus.value = { nodeId: connection.value!.blueprint.nodes.find(node => node.widgetId === 'inner')!.nodeId }
		await nextTick()
		expect(current())
			.toEqual(['true', ''])
	})

	it('selects the widget of an entry in the Preview, and disables that for a widget the Preview no longer has', async () => {
		const { wrapper, preview, setFocus, connection } = await mountPanel({ nested: true })
		preview.fire(1, 'inner')
		await nextTick()
		const button = rows(wrapper)[0]!.get('[data-testid="event-widget"]')
		await button.trigger('click')
		const innerNode = connection.value!.blueprint.nodes.find(node => node.widgetId === 'inner')!
		expect(setFocus)
			.toHaveBeenCalledWith('preview', { nodeId: innerNode.nodeId })

		// A new Preview whose Runtime has no `inner` (a node id of the old Runtime would mean another widget).
		const next = await createPreview(4)
		connection.value = next.connection
		await settle()
		const stale = rows(wrapper)[0]!.get('[data-testid="event-widget"]')
		// Still focusable (not `disabled`), activation is ignored, and the reason is its description.
		expect(stale.attributes('disabled'))
			.toBeUndefined()
		expect(stale.attributes('aria-disabled'))
			.toBe('true')
		expect(stale.attributes('title'))
			.toBe('inner : Notifier is not in the current Preview')
		expect(wrapper.get(`#${stale.attributes('aria-describedby')}`)
			.text())
			.toBe('inner : Notifier is not in the current Preview')
		setFocus.mockClear()
		await stale.trigger('click')
		expect(setFocus)
			.not
			.toHaveBeenCalled()
		// Its entry stays, tagged with the revision that emitted it, next to the ones from the new Preview.
		next.ping()
		await nextTick()
		expect(rows(wrapper)
			.map(row => row.attributes('data-revision')))
			.toEqual(['4', '3'])
	})

	it('records while its tab is hidden, so the Events are there when it is opened', async () => {
		const { wrapper, preview, visibility } = await mountPanel()
		visibility.show(false)
		await settle()
		// Hidden and still listening to everything it declares.
		expect(preview.active.size)
			.toBe(2)
		preview.ping()
		await nextTick()
		visibility.show(true)
		await settle()
		expect(rows(wrapper))
			.toHaveLength(1)
		expect(preview.active.size)
			.toBe(2)
	})

	it('speaks the singular where there is one: one Event, one widget, one older entry dropped, one not recorded', async () => {
		const { wrapper, preview } = await mountPanel()
		preview.ping()
		await nextTick()
		expect(wrapper.get('[data-testid="events-count"]')
			.text())
			.toBe('1 recorded Event')
		await wrapper.get('[data-testid="events-filter-event"]')
			.setValue('pinged')
		expect(wrapper.get('[data-testid="events-count"]')
			.text())
			.toBe('1 of 1 recorded Event shown')
		await wrapper.get('[data-testid="events-filter-event"]')
			.setValue('')

		await wrapper.get('[data-testid="events-pause"]')
			.trigger('click')
		preview.ping()
		await nextTick()
		expect(wrapper.get('[data-testid="events-paused-note"]')
			.text())
			.toBe('Paused: 1 Event was not recorded.')
		await wrapper.get('[data-testid="events-pause"]')
			.trigger('click')
		expect(wrapper.get('[data-testid="events-paused-note"]')
			.text())
			.toBe('1 Event was not recorded while the log was paused.')
	})

	it('announces one settled count after a burst of Events, not one announcement per Event', async () => {
		vi.useFakeTimers()
		const { wrapper, preview } = await mountPanel()
		const live = wrapper.get('[data-testid="events-live"]')
		expect(live.text())
			.toBe('')
		const announced: string[] = []
		const observer = new MutationObserver(() => announced.push(live.text()))
		observer.observe(live.element, { childList: true, characterData: true, subtree: true })

		for (let i = 0; i < 4; i++) {
			preview.ping()
			await nextTick()
			vi.advanceTimersByTime(200)
			await nextTick()
		}
		// 800 ms after the first Event, 200 ms after the last: nothing was announced yet.
		expect(live.text())
			.toBe('')

		vi.advanceTimersByTime(799)
		await nextTick()
		expect(live.text())
			.toBe('')
		vi.advanceTimersByTime(1)
		await nextTick()
		expect(live.text())
			.toBe('4 Events recorded')
		await Promise.resolve()
		expect(announced)
			.toEqual(['4 Events recorded'])
		observer.disconnect()
	})

	it('speaks Taiwan Chinese with the Event vocabulary and Runtime data left as they are', async () => {
		const { wrapper, preview } = await mountPanel({ locale: 'zh-TW' })
		preview.fire(2)
		await nextTick()
		expect(wrapper.get('[data-testid="events-pause"]')
			.text())
			.toBe('暫停')
		expect(wrapper.get('[data-testid="events-count"]')
			.text())
			.toBe('已記錄 1 筆 Event')
		const row = rows(wrapper)[0]!
		expect(row.get('[data-testid="event-name"]')
			.text())
			.toBe('changed')
		expect(row.get('[data-testid="event-widget"]')
			.attributes('title'))
			.toBe('在 Preview 中選取 notifier : Notifier')
	})
})
