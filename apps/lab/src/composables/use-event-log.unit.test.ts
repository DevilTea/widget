// @vitest-environment happy-dom

import type { Preview } from '../events/test-support'
import type { LabStore } from './use-lab-store'
import { afterEach, describe, expect, it } from 'vitest'
import { createApp, defineComponent, h, nextTick, ref, shallowRef } from 'vue'
import { EVENT_LOG_LIMIT } from '../events/event-log'
import { createPreview, createPreviewLink, disposePreviews } from '../events/test-support'
import { useEventLog, useEventLogTabState } from './use-event-log'
import { LabStoreKey } from './use-lab-store'

afterEach(disposePreviews)

/** The slice of the store the shared source reads. `validPreview`: whether the Document has a valid Preview snapshot. */
function fakeStore(initial: Preview | null, options: { validPreview?: boolean, error?: string | null } = {}) {
	const connection = shallowRef<Preview['connection'] | null>(initial?.connection ?? null)
	const showcaseId = shallowRef('survey')
	const preview = shallowRef<{ revision: number } | null>(options.validPreview === false ? null : { revision: 0 })
	const error = shallowRef<string | null>(options.error ?? null)
	const store = { previewHost: { connection, error }, preview, showcaseId } as unknown as LabStore
	return { store, connection, showcaseId, preview, error }
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

	it('says what is wrong when there is nothing to listen to: no Events declared, no valid Preview, still loading, connection lost', async () => {
		const plain = await createPreview(1, { plain: true })
		const { store, connection, preview, error } = fakeStore(plain)
		const consumer = mountConsumer(store, () => useEventLog(ref(true)))
		await settle()
		expect(consumer.value.listening.value)
			.toEqual({ state: 'no-events' })
		expect(plain.requests)
			.toEqual([])

		// No connection yet but a valid Preview snapshot: the frame is still loading.
		connection.value = null
		await settle()
		expect(consumer.value.listening.value)
			.toEqual({ state: 'loading' })
		// The frame was connected and is not any more.
		error.value = 'The connection to the preview frame was closed.'
		await settle()
		expect(consumer.value.listening.value)
			.toEqual({ state: 'lost' })
		// No valid Preview at all: the Document has problems and nothing was applied.
		preview.value = null
		error.value = null
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

	it('records while its panel is mounted but not visible, counts those entries as unseen, and clears the count when it is looked at', async () => {
		const preview = await createPreview(1)
		const { store } = fakeStore(preview)
		const visible = ref(false)
		const consumer = mountConsumer(store, () => ({ log: useEventLog(visible), unseen: useEventLogTabState().unseen }))
		await settle()
		// Hidden, and still subscribed to everything it declares.
		expect(preview.active.size)
			.toBe(2)

		preview.fire(1)
		preview.ping()
		expect(consumer.value.log.entries.value)
			.toHaveLength(2)
		expect(consumer.value.unseen.value)
			.toBe(2)

		visible.value = true
		expect(consumer.value.unseen.value)
			.toBe(0)
		// Entries that arrive while it is looked at are seen at once.
		preview.fire(2)
		expect(consumer.value.log.entries.value)
			.toHaveLength(3)
		expect(consumer.value.unseen.value)
			.toBe(0)

		visible.value = false
		preview.fire(3)
		expect(consumer.value.unseen.value)
			.toBe(1)
		consumer.value.log.clear()
		expect(consumer.value.unseen.value)
			.toBe(0)
		consumer.unmount()
	})

	it('listens to nothing before a consumer is mounted or after the last one is gone', async () => {
		const preview = await createPreview(1)
		const { store } = fakeStore(preview)
		// Reading the unseen count (the tab does) keeps nothing alive.
		const reader = mountConsumer(store, () => useEventLogTabState())
		await settle()
		expect(preview.requests)
			.toEqual([])
		preview.fire(1)

		const consumer = mountConsumer(store, () => useEventLog(ref(false)))
		await settle()
		expect(preview.active.size)
			.toBe(2)
		expect(consumer.value.entries.value)
			.toEqual([])

		consumer.unmount()
		await settle()
		expect(preview.active.size)
			.toBe(0)
		reader.unmount()
	})

	it('shares one set of subscriptions between consumers and holds them until the last one is unmounted', async () => {
		const preview = await createPreview(1)
		const { store } = fakeStore(preview)
		const first = mountConsumer(store, () => useEventLog(ref(true)))
		const second = mountConsumer(store, () => useEventLog(ref(false)))
		await settle()
		expect(preview.requests.filter(method => method === 'runtime.subscribeEvent'))
			.toHaveLength(2)
		expect(second.value.entries.value)
			.toBe(first.value.entries.value)

		first.unmount()
		await settle()
		expect(preview.active.size)
			.toBe(2)
		second.unmount()
		await settle()
		expect(preview.active.size)
			.toBe(0)
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

	it('releases every subscription whose answer arrives after the Preview was replaced', async () => {
		const first = await createPreview(1)
		const second = await createPreview(2)
		first.gate.hold = true
		const { store, connection } = fakeStore(first)
		const consumer = mountConsumer(store, () => useEventLog(ref(true)))
		await settle()
		// Both of the Preview's Events are waiting for their answer.
		expect(first.gate.pending)
			.toHaveLength(2)
		expect(first.active.size)
			.toBe(0)

		connection.value = second.connection
		await settle()
		first.gate.hold = false
		first.gate.release()
		await settle()
		// Both late subscriptions were released at once, not kept for a Runtime nobody reads.
		expect(first.active.size)
			.toBe(0)
		first.fire(1)
		expect(consumer.value.entries.value)
			.toEqual([])
		expect(second.active.size)
			.toBe(2)
		consumer.unmount()
	})

	it('clears when the showcase changes and ignores what the previous showcase\'s connection still sends', async () => {
		const first = await createPreview(1)
		const second = await createPreview(2)
		const { store, showcaseId, connection } = fakeStore(first)
		const consumer = mountConsumer(store, () => useEventLog(ref(true)))
		await settle()
		first.fire(1)
		expect(consumer.value.entries.value)
			.toHaveLength(1)

		showcaseId.value = 'sandbox'
		expect(consumer.value.entries.value)
			.toEqual([])
		// The old connection stays current until the new showcase has mounted: its Events are not the new showcase's.
		first.fire(2)
		expect(consumer.value.entries.value)
			.toEqual([])

		connection.value = second.connection
		await settle()
		second.fire(3)
		expect(consumer.value.entries.value.map(entry => entry.runtimeId))
			.toEqual(['runtime-r2'])
		consumer.unmount()
	})

	it('swallows the refusal of releasing subscriptions on a client that is already closed', async () => {
		const first = await createPreview(1)
		const second = await createPreview(2)
		const { store, connection } = fakeStore(first)
		const consumer = mountConsumer(store, () => useEventLog(ref(true)))
		await settle()
		expect(first.active.size)
			.toBe(2)

		// The frame went away: its client is closed, so releasing on it is refused (an unhandled rejection fails the test).
		first.connection.inspectorClient.close()
		connection.value = second.connection
		await settle()
		expect(first.requests.filter(method => method === 'runtime.unsubscribeEvent'))
			.toHaveLength(2)
		expect(second.active.size)
			.toBe(2)
		second.fire(1)
		expect(consumer.value.entries.value)
			.toHaveLength(1)
		consumer.unmount()
	})

	it('survives a client that outlives the Preview\'s Agent: the stale release is refused and swallowed, and the new Runtime is listened to', async () => {
		const link = createPreviewLink()
		const first = await createPreview(1, { link })
		const { store, connection } = fakeStore(first)
		const consumer = mountConsumer(store, () => useEventLog(ref(true)))
		await settle()
		expect(first.active.size)
			.toBe(2)
		first.fire(1)

		// An Apply: the old Agent is gone, a new one serves the same client and transport.
		first.disposeAgent()
		const second = await createPreview(2, { link })
		connection.value = second.connection
		await settle()
		// The release of the old subscriptions went to the new Agent (or to nobody) and did not remove its subscriptions.
		expect(first.requests.filter(method => method === 'runtime.unsubscribeEvent'))
			.toHaveLength(2)
		expect(second.active.size)
			.toBe(2)
		second.fire(2)
		first.fire(3)
		expect(consumer.value.entries.value.map(entry => [entry.revision, entry.event]))
			.toEqual([[1, 'changed'], [2, 'changed']])
		expect(consumer.value.listening.value)
			.toEqual({ state: 'listening', widgets: 1, events: 2, failed: 0 })
		consumer.unmount()
	})
})
