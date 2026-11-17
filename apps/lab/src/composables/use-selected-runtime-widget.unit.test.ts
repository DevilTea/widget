// @vitest-environment happy-dom

import type { InspectorRuntimeWidgetSnapshot } from '@deviltea/widget-inspector/protocol'
import type { LabStore } from './use-lab-store'
import { describe, expect, it } from 'vitest'
import { createApp, defineComponent, h, nextTick, ref, shallowRef } from 'vue'
import { LabStoreKey } from './use-lab-store'
import { useSelectedRuntimeWidget } from './use-selected-runtime-widget'

/** The slice of the store the shared source reads, with a client that records every request. */
function fakeStore() {
	const requests: { readonly method: string, readonly nodeId: number }[] = []
	const pending: ((snapshot: InspectorRuntimeWidgetSnapshot) => void)[] = []
	const client = {
		request: (method: string, params: { ref: { nodeId: number } }) => {
			requests.push({ method, nodeId: params.ref.nodeId })
			return new Promise<InspectorRuntimeWidgetSnapshot>((resolve) => {
				pending.push(resolve)
			})
		},
	}
	const connection = shallowRef({
		runtimeId: 'runtime-r0',
		inspectorClient: client,
		blueprint: { nodes: [{ nodeId: 1, resolved: true }, { nodeId: 2, resolved: true }] },
	})
	const previewFocus = shallowRef<{ nodeId: number } | null>({ nodeId: 1 })
	const store = { previewHost: { connection }, previewFocus } as unknown as LabStore
	const snapshotOf = (nodeId: number) => ({ ref: { runtimeId: 'runtime-r0', nodeId }, members: [] }) as unknown as InspectorRuntimeWidgetSnapshot
	/** Answers the oldest unanswered request. */
	const answerNext = (nodeId: number): void => pending.shift()!(snapshotOf(nodeId))
	return { store, requests, previewFocus, answerNext }
}

/** Runs `setup` inside a tiny app that provides the store, as a Dockview panel would run. */
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

describe('useSelectedRuntimeWidget()', () => {
	it('requests the snapshot once per selection however many panels are visible', async () => {
		const { store, requests, previewFocus, answerNext } = fakeStore()
		const runtime = mountConsumer(store, () => useSelectedRuntimeWidget(ref(true)))
		const selected = mountConsumer(store, () => useSelectedRuntimeWidget(ref(true)))
		await nextTick()
		expect(requests)
			.toEqual([{ method: 'runtime.getWidgetSnapshot', nodeId: 1 }])

		answerNext(1)
		await nextTick()
		await nextTick()
		expect(runtime.value.widgetSnapshot.value)
			.not
			.toBeNull()
		expect(selected.value.widgetSnapshot.value)
			.toBe(runtime.value.widgetSnapshot.value)

		previewFocus.value = { nodeId: 2 }
		await nextTick()
		expect(requests.map(request => request.nodeId))
			.toEqual([1, 2])
		runtime.unmount()
		selected.unmount()
	})

	it('does not request while no panel is visible, and requests again when one becomes visible', async () => {
		const { store, requests, previewFocus, answerNext } = fakeStore()
		const runtimeVisible = ref(false)
		const selectedVisible = ref(false)
		const runtime = mountConsumer(store, () => useSelectedRuntimeWidget(runtimeVisible))
		const selected = mountConsumer(store, () => useSelectedRuntimeWidget(selectedVisible))
		await nextTick()
		previewFocus.value = { nodeId: 2 }
		await nextTick()
		expect(requests)
			.toEqual([])
		expect(runtime.value.widgetSnapshot.value)
			.toBeNull()

		selectedVisible.value = true
		await nextTick()
		expect(requests.map(request => request.nodeId))
			.toEqual([2])
		answerNext(2)
		await nextTick()
		await nextTick()
		expect(selected.value.widgetSnapshot.value)
			.not
			.toBeNull()
		// The hidden panel reads nothing, so the member rows under it are not rendered and hold no subscription.
		expect(runtime.value.widgetSnapshot.value)
			.toBeNull()

		selectedVisible.value = false
		await nextTick()
		expect(selected.value.widgetSnapshot.value)
			.toBeNull()
		runtime.unmount()
		selected.unmount()
	})

	it('stops counting a panel that is unmounted while visible', async () => {
		const { store, requests, previewFocus } = fakeStore()
		const first = mountConsumer(store, () => useSelectedRuntimeWidget(ref(true)))
		await nextTick()
		first.unmount()
		await nextTick()
		previewFocus.value = { nodeId: 2 }
		await nextTick()
		expect(requests.map(request => request.nodeId))
			.toEqual([1])
	})
})
