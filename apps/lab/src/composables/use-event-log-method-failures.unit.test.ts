// @vitest-environment happy-dom

import type { Preview } from '../events/test-support'
import type { LabStore } from './use-lab-store'
import { afterEach, describe, expect, it } from 'vitest'
import { createApp, defineComponent, h, nextTick, ref, shallowRef } from 'vue'
import { EVENT_LOG_LIMIT } from '../events/event-log'
import { createPreview, createPreviewLink, disposePreviews } from '../events/test-support'
import { useEventLog, useEventLogTabState } from './use-event-log'
import { LabStoreKey } from './use-lab-store'

/**
 * Issue #230, audit U08: the Events log also records Method failures, from the real Core Runtime behind a real Inspector
 * Agent (protocol 0.5 Method member subscriptions), not from hand-written DTOs.
 */
afterEach(disposePreviews)

function fakeStore(initial: Preview | null) {
	const connection = shallowRef<Preview['connection'] | null>(initial?.connection ?? null)
	const showcaseId = shallowRef('survey')
	const preview = shallowRef<{ revision: number } | null>({ revision: 0 })
	const error = shallowRef<string | null>(null)
	const store = { previewHost: { connection, error }, preview, showcaseId } as unknown as LabStore
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

describe('useEventLog() Method failures', () => {
	it('records a Method failure with the whole diagnostic snapshot, a new entry for each failing call and none for a success', async () => {
		const preview = await createPreview(3)
		const { store } = fakeStore(preview)
		const consumer = mountConsumer(store, () => useEventLog(ref(true)))
		await settle()
		expect(consumer.value.watchingMethods.value)
			.toEqual({ methods: 3, failed: 0 })

		preview.check(false)
		preview.check(false)
		preview.check(true)
		preview.check(true)
		const entries = consumer.value.entries.value
		expect(entries.map(entry => entry.kind))
			.toEqual(['method-failure', 'method-failure'])
		expect(entries[0])
			.toMatchObject({
				kind: 'method-failure',
				widgetId: 'notifier',
				widgetType: 'Notifier',
				method: 'check',
				revision: 3,
				runtimeId: 'runtime-r3',
				diagnostics: [{
					code: 'invalid-method-result',
					message: 'The check failed.',
					reason: 'not-ok',
					location: { type: 'method', widgetId: 'notifier', name: 'check' },
					result: { type: 'boolean', value: false },
				}],
			})
		expect(entries[1]!.seq)
			.toBe(entries[0]!.seq + 1)
		expect(consumer.value.recordedFailures.value)
			.toBe(2)
		consumer.unmount()
	})

	it('does not record the failure a Method already holds when the log starts listening', async () => {
		const preview = await createPreview(1)
		preview.check(false)
		const { store } = fakeStore(preview)
		const consumer = mountConsumer(store, () => useEventLog(ref(true)))
		await settle()
		expect(consumer.value.entries.value)
			.toEqual([])
		preview.check(false)
		expect(consumer.value.entries.value)
			.toHaveLength(1)
		consumer.unmount()
	})

	it('records Events and Method failures in call order in one buffer, and counts both as unseen', async () => {
		const preview = await createPreview(1, { nested: true })
		const { store } = fakeStore(preview)
		const visible = ref(false)
		const consumer = mountConsumer(store, () => ({ log: useEventLog(visible), unseen: useEventLogTabState().unseen }))
		await settle()

		preview.fire(1)
		preview.check(false, 'inner')
		preview.ping()
		expect(consumer.value.log.entries.value.map(entry => entry.kind === 'event' ? entry.event : `${entry.widgetId}.${entry.method}()`))
			.toEqual(['changed', 'inner.check()', 'pinged'])
		expect(consumer.value.unseen.value)
			.toBe(3)
		consumer.unmount()
	})

	it('while paused, skips Method failures and counts them apart from Events', async () => {
		const preview = await createPreview(1)
		const { store } = fakeStore(preview)
		const consumer = mountConsumer(store, () => useEventLog(ref(true)))
		await settle()

		consumer.value.setPaused(true)
		preview.check(false)
		preview.check(false)
		preview.fire(1)
		expect(consumer.value.entries.value)
			.toEqual([])
		expect(consumer.value.skippedFailuresWhilePaused.value)
			.toBe(2)
		expect(consumer.value.skippedWhilePaused.value)
			.toBe(1)
		consumer.value.setPaused(false)
		preview.check(false)
		expect(consumer.value.entries.value)
			.toHaveLength(1)
		consumer.value.clear()
		expect(consumer.value.skippedFailuresWhilePaused.value)
			.toBe(0)
		expect(consumer.value.recordedFailures.value)
			.toBe(0)
		consumer.unmount()
	})

	it('keeps the newest EVENT_LOG_LIMIT entries when Method failures fill the buffer', async () => {
		const preview = await createPreview(1)
		const { store } = fakeStore(preview)
		const consumer = mountConsumer(store, () => useEventLog(ref(true)))
		await settle()

		for (let count = 1; count <= EVENT_LOG_LIMIT + 2; count++)
			preview.check(false)
		expect(consumer.value.entries.value)
			.toHaveLength(EVENT_LOG_LIMIT)
		expect(consumer.value.dropped.value)
			.toBe(2)
		expect(consumer.value.recordedFailures.value)
			.toBe(EVENT_LOG_LIMIT + 2)
		consumer.unmount()
	})

	it('watches the Methods of a Preview that declares no Events', async () => {
		const preview = await createPreview(1, { methodsOnly: true })
		const { store } = fakeStore(preview)
		const consumer = mountConsumer(store, () => useEventLog(ref(true)))
		await settle()
		expect(consumer.value.listening.value)
			.toEqual({ state: 'no-events' })
		expect(consumer.value.watchingMethods.value)
			.toEqual({ methods: 1, failed: 0 })
		preview.check(false, 'checker')
		expect(consumer.value.entries.value)
			.toMatchObject([{ kind: 'method-failure', widgetId: 'checker', method: 'check' }])
		consumer.unmount()
	})

	it('subscribes to nothing for a widget without Methods', async () => {
		const plain = await createPreview(1, { plain: true })
		const { store } = fakeStore(plain)
		const consumer = mountConsumer(store, () => useEventLog(ref(true)))
		await settle()
		expect(plain.requests)
			.toEqual([])
		expect(consumer.value.watchingMethods.value)
			.toEqual({ methods: 0, failed: 0 })
		consumer.unmount()
	})

	it('releases every Method subscription when the Preview is replaced or the last consumer goes, and records the new Runtime only', async () => {
		const link = createPreviewLink()
		const first = await createPreview(1, { link })
		const { store, connection } = fakeStore(first)
		const consumer = mountConsumer(store, () => useEventLog(ref(true)))
		await settle()
		expect(first.activeMembers.size)
			.toBe(3)

		first.disposeAgent()
		const second = await createPreview(2, { link })
		connection.value = second.connection
		await settle()
		expect(second.activeMembers.size)
			.toBe(3)
		second.check(false)
		expect(consumer.value.entries.value.map(entry => entry.revision))
			.toEqual([2])

		consumer.unmount()
		await settle()
		expect(second.activeMembers.size)
			.toBe(0)
	})

	it('releases a Method subscription whose answer arrives after the Preview was replaced', async () => {
		const first = await createPreview(1)
		const second = await createPreview(2)
		const { store, connection } = fakeStore(first)
		const consumer = mountConsumer(store, () => useEventLog(ref(true)))
		connection.value = second.connection
		await settle()
		expect(first.activeMembers.size)
			.toBe(0)
		expect(second.activeMembers.size)
			.toBe(3)
		consumer.unmount()
	})

	it('ignores the previous showcase\'s connection until the new one has replaced it', async () => {
		const first = await createPreview(1)
		const { store, showcaseId } = fakeStore(first)
		const consumer = mountConsumer(store, () => useEventLog(ref(true)))
		await settle()
		first.check(false)
		expect(consumer.value.entries.value)
			.toHaveLength(1)
		showcaseId.value = 'sandbox'
		expect(consumer.value.entries.value)
			.toEqual([])
		first.check(false)
		expect(consumer.value.entries.value)
			.toEqual([])
		consumer.unmount()
	})

	it('counts a Method it could not subscribe to and keeps the others', async () => {
		const preview = await createPreview(1)
		const original = preview.connection.inspectorClient.request as (method: string, params: unknown) => Promise<unknown>
		const failing = {
			...preview.connection,
			inspectorClient: {
				...preview.connection.inspectorClient,
				request: ((method: string, params: { member?: { name: string } }) => method === 'runtime.subscribeMember' && params.member?.name === 'ping'
					? Promise.reject(new Error('refused'))
					: original(method, params)) as never,
			},
		}
		const { store } = fakeStore({ ...preview, connection: failing })
		const consumer = mountConsumer(store, () => useEventLog(ref(true)))
		await settle()
		expect(consumer.value.watchingMethods.value)
			.toEqual({ methods: 2, failed: 1 })
		preview.check(false)
		expect(consumer.value.entries.value)
			.toHaveLength(1)
		consumer.unmount()
	})
})
