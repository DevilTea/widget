// @vitest-environment happy-dom

import type { Preview } from '../events/test-support'
import type { LabStore } from './use-lab-store'
import { afterEach, describe, expect, it } from 'vitest'
import { createApp, defineComponent, h, nextTick, ref, shallowRef } from 'vue'
import { EVENT_LOG_LIMIT } from '../events/event-log'
import { createPreview, disposePreviews } from '../events/test-support'
import { useEventLog } from './use-event-log'
import { LabStoreKey } from './use-lab-store'

afterEach(disposePreviews)

function fakeStore(initial: Preview | null) {
	const connection = shallowRef<Preview['connection'] | null>(initial?.connection ?? null)
	const showcaseId = shallowRef('survey')
	const store = { previewHost: { connection }, showcaseId } as unknown as LabStore
	return { store, connection, showcaseId }
}

function mountConsumer<T>(store: LabStore, setup: () => T): { readonly value: T, unmount: () => void } {
	let value!: T
	const app = createApp(defineComponent({
		setup() {
			value = setup()
			return () => h('div')
		},
	}))
	app.provide(LabStoreKey, store)
	app.mount(document.createElement('div'))
	return { value, unmount: () => app.unmount() }
}

/** Lets the in-flight subscribe/unsubscribe requests (a few microtasks each) settle. */
async function settle(): Promise<void> {
	for (let i = 0; i < 20; i++)
		await Promise.resolve()
	await nextTick()
}

describe('useEventLog()', () => {
	it('records an occurrence with its widget, Event name, Preview revision and bounded payload', async () => {
		const preview = await createPreview(3)
		const { store } = fakeStore(preview)
		const consumer = mountConsumer(store, () => useEventLog(ref(true)))
		await settle()

		expect(consumer.value.emitters.value)
			.toEqual([expect.objectContaining({ widgetId: 'notifier', widgetType: 'Notifier', events: ['changed', 'pinged'] })])
		expect(consumer.value.listening.value)
			.toEqual({ state: 'listening', widgets: 1, events: 2, failed: 0 })

		preview.fire(7)
		preview.ping()
		const [changed, pinged] = consumer.value.entries.value
		expect(changed)
			.toMatchObject({ widgetId: 'notifier', widgetType: 'Notifier', event: 'changed', revision: 3, runtimeId: 'runtime-r3' })
		expect(changed!.args)
			.toEqual([{
				type: 'object',
				id: 1,
				entries: [
					{ key: 'label', value: { type: 'string', value: 'xxxxxxx', truncated: false } },
					{ key: 'value', value: { type: 'number', value: 7 } },
				],
				truncated: false,
			}])
		expect(pinged)
			.toMatchObject({ event: 'pinged', args: [] })
		expect(changed!.at)
			.toBeGreaterThan(0)
		expect(pinged!.seq)
			.toBe(changed!.seq + 1)
		consumer.unmount()
	})

	it('says there is nothing to record when no widget declares an Event, and when there is no Preview', async () => {
		const plain = await createPreview(1, { plain: true })
		const { store, connection } = fakeStore(plain)
		const consumer = mountConsumer(store, () => useEventLog(ref(true)))
		await settle()
		expect(consumer.value.listening.value)
			.toEqual({ state: 'no-events' })
		expect(plain.requests)
			.toEqual([])

		connection.value = null
		await settle()
		expect(consumer.value.listening.value)
			.toEqual({ state: 'no-preview' })
		consumer.unmount()
	})

	it('does not record while paused, counts what it skipped, and records again after resume', async () => {
		const preview = await createPreview(1)
		const { store } = fakeStore(preview)
		const consumer = mountConsumer(store, () => useEventLog(ref(true)))
		await settle()

		preview.fire(1)
		consumer.value.setPaused(true)
		preview.fire(2)
		preview.fire(3)
		expect(consumer.value.entries.value)
			.toHaveLength(1)
		expect(consumer.value.skippedWhilePaused.value)
			.toBe(2)

		consumer.value.setPaused(false)
		preview.fire(4)
		expect(consumer.value.entries.value)
			.toHaveLength(2)
		// The count of what was skipped stays until the log is cleared.
		expect(consumer.value.skippedWhilePaused.value)
			.toBe(2)
		consumer.value.clear()
		expect(consumer.value.entries.value)
			.toEqual([])
		expect(consumer.value.skippedWhilePaused.value)
			.toBe(0)
		consumer.unmount()
	})

	it('keeps the newest EVENT_LOG_LIMIT entries and reports how many older ones were dropped', async () => {
		const preview = await createPreview(1)
		const { store } = fakeStore(preview)
		const consumer = mountConsumer(store, () => useEventLog(ref(true)))
		await settle()

		for (let value = 1; value <= EVENT_LOG_LIMIT + 5; value++)
			preview.ping()
		expect(consumer.value.entries.value)
			.toHaveLength(EVENT_LOG_LIMIT)
		expect(consumer.value.dropped.value)
			.toBe(5)
		expect(consumer.value.entries.value[0]!.seq)
			.toBe(6)
		consumer.value.clear()
		expect(consumer.value.dropped.value)
			.toBe(0)
		consumer.unmount()
	})

	it('holds no subscription while no consumer is visible, and subscribes when one becomes visible', async () => {
		const preview = await createPreview(1)
		const { store } = fakeStore(preview)
		const visible = ref(false)
		const consumer = mountConsumer(store, () => useEventLog(visible))
		await settle()
		expect(preview.requests)
			.toEqual([])
		expect(preview.active.size)
			.toBe(0)
		preview.fire(1)
		expect(consumer.value.entries.value)
			.toEqual([])

		visible.value = true
		await settle()
		expect(preview.active.size)
			.toBe(2)
		preview.fire(2)
		expect(consumer.value.entries.value)
			.toHaveLength(1)

		visible.value = false
		await settle()
		expect(preview.active.size)
			.toBe(0)
		preview.fire(3)
		// What was recorded stays; what happened while hidden is not recorded.
		expect(consumer.value.entries.value)
			.toHaveLength(1)
		consumer.unmount()
	})

	it('releases every subscription when the consumer goes away', async () => {
		const preview = await createPreview(1)
		const { store } = fakeStore(preview)
		const consumer = mountConsumer(store, () => useEventLog(ref(true)))
		await settle()
		expect(preview.active.size)
			.toBe(2)
		consumer.unmount()
		await settle()
		expect(preview.active.size)
			.toBe(0)
	})

	it('shares one set of subscriptions between consumers and holds them until the last one hides', async () => {
		const preview = await createPreview(1)
		const { store } = fakeStore(preview)
		const firstVisible = ref(true)
		const secondVisible = ref(true)
		const first = mountConsumer(store, () => useEventLog(firstVisible))
		const second = mountConsumer(store, () => useEventLog(secondVisible))
		await settle()
		expect(preview.requests.filter(method => method === 'runtime.subscribeEvent'))
			.toHaveLength(2)
		expect(second.value.entries.value)
			.toBe(first.value.entries.value)

		firstVisible.value = false
		await settle()
		expect(preview.active.size)
			.toBe(2)
		secondVisible.value = false
		await settle()
		expect(preview.active.size)
			.toBe(0)
		first.unmount()
		second.unmount()
	})

	it('listens to the new Runtime after the Preview is replaced, releases the old one and keeps what was recorded', async () => {
		const first = await createPreview(1)
		const second = await createPreview(2)
		const { store, connection } = fakeStore(first)
		const consumer = mountConsumer(store, () => useEventLog(ref(true)))
		await settle()
		first.fire(1)

		connection.value = second.connection
		await settle()
		expect(first.active.size)
			.toBe(0)
		expect(second.active.size)
			.toBe(2)
		first.fire(2)
		second.fire(3)
		const entries = consumer.value.entries.value
		expect(entries.map(entry => [entry.revision, entry.runtimeId]))
			.toEqual([[1, 'runtime-r1'], [2, 'runtime-r2']])

		// A failed mount leaves no connection at all: nothing is subscribed.
		connection.value = null
		await settle()
		expect(second.active.size)
			.toBe(0)
		expect(consumer.value.entries.value)
			.toHaveLength(2)
		consumer.unmount()
	})

	it('releases a subscription whose answer arrives after the Preview was replaced', async () => {
		const first = await createPreview(1)
		const second = await createPreview(2)
		first.gate.hold = true
		const { store, connection } = fakeStore(first)
		const consumer = mountConsumer(store, () => useEventLog(ref(true)))
		await settle()
		expect(first.active.size)
			.toBe(0)

		connection.value = second.connection
		await settle()
		first.gate.hold = false
		first.gate.release()
		await settle()
		// The late subscription was released at once, not kept for a Runtime nobody reads.
		expect(first.active.size)
			.toBe(0)
		first.fire(1)
		expect(consumer.value.entries.value)
			.toEqual([])
		consumer.unmount()
	})

	it('clears the log when the showcase changes', async () => {
		const preview = await createPreview(1)
		const { store, showcaseId } = fakeStore(preview)
		const consumer = mountConsumer(store, () => useEventLog(ref(true)))
		await settle()
		preview.fire(1)
		expect(consumer.value.entries.value)
			.toHaveLength(1)
		showcaseId.value = 'sandbox'
		await nextTick()
		expect(consumer.value.entries.value)
			.toEqual([])
		consumer.unmount()
	})
})
