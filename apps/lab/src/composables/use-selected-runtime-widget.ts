/**
 * The Preview-scoped selection as the Runtime inspectors show it: the Preview Blueprint snapshot, the selected
 * resolved node, and that widget's Runtime snapshot requested through the Inspector client. Shared by the Runtime
 * panel and the Selected widget panel so both read the same remote data the same way. Nothing here touches a Core
 * Runtime: every value is an Inspector protocol DTO from the Preview frame.
 *
 * One snapshot request per selection, for the whole Lab (issue #230 PR 3c): the two panels stay mounted while their
 * tab is hidden, and each used to request the same snapshot, and open the same member subscriptions, on every focus
 * change. Now the snapshot lives in one shared source per store, requested only while at least one consumer says it
 * is visible, and every consumer reads that one value. A consumer that is not visible reads `null`, so the member rows
 * under it (which subscribe to the remote Runtime) are not rendered and hold no subscription.
 */
import type { InspectorBlueprintNode, InspectorBlueprintSnapshot, InspectorRuntimeWidgetSnapshot } from '@deviltea/widget-inspector/protocol'
import type { Ref } from 'vue'
import type { LabStore } from './use-lab-store'
import { computed, effectScope, onScopeDispose, shallowRef, watch } from 'vue'
import { useLabStore } from './use-lab-store'

export interface SelectedRuntimeWidget {
	readonly connection: Readonly<Ref<ReturnType<typeof useLabStore>['previewHost']['connection']['value']>>
	readonly blueprint: Readonly<Ref<InspectorBlueprintSnapshot | null>>
	readonly selectedNodeId: Readonly<Ref<number | null>>
	/** The selected node, only when it is resolved (an unresolved widget has no Runtime). */
	readonly selectedNode: Readonly<Ref<InspectorBlueprintNode | null>>
	/** The selected widget's Runtime snapshot; `null` while loading, when there is none, and while this consumer is not visible. */
	readonly widgetSnapshot: Readonly<Ref<InspectorRuntimeWidgetSnapshot | null>>
}

interface SharedSource {
	readonly connection: SelectedRuntimeWidget['connection']
	readonly blueprint: SelectedRuntimeWidget['blueprint']
	readonly selectedNodeId: SelectedRuntimeWidget['selectedNodeId']
	readonly selectedNode: SelectedRuntimeWidget['selectedNode']
	readonly snapshot: Ref<InspectorRuntimeWidgetSnapshot | null>
	/** How many consumers are visible right now. */
	readonly visibleConsumers: Ref<number>
}

const sources = new WeakMap<LabStore, SharedSource>()

function sharedSource(store: LabStore): SharedSource {
	const existing = sources.get(store)
	if (existing !== undefined)
		return existing

	// A scope of its own: the source belongs to the store, not to whichever panel asked first.
	const scope = effectScope(true)
	const source = scope.run((): SharedSource => {
		const connection = computed(() => store.previewHost.connection.value)
		const blueprint = computed(() => connection.value?.blueprint ?? null)
		const selectedNodeId = computed<number | null>(() => store.previewFocus.value?.nodeId ?? null)
		const selectedNode = computed(() => {
			const snapshot = blueprint.value
			const nodeId = selectedNodeId.value
			if (snapshot === null || nodeId === null)
				return null
			const node = snapshot.nodes.find(candidate => candidate.nodeId === nodeId) ?? null
			return node?.resolved ? node : null
		})
		const snapshot = shallowRef<InspectorRuntimeWidgetSnapshot | null>(null)
		const visibleConsumers = shallowRef(0)

		const anyVisible = computed(() => visibleConsumers.value > 0)

		// A list of sources (not one getter returning a fresh array): only a real change of one of them re-requests.
		watch(
			[connection, selectedNodeId, anyVisible] as const,
			([current, nodeId, anyVisible], _previous, onCleanup) => {
				snapshot.value = null
				if (current === null || nodeId === null || !anyVisible)
					return
				let active = true
				onCleanup(() => {
					active = false
				})
				void current.inspectorClient.request('runtime.getWidgetSnapshot', {
					ref: { runtimeId: current.runtimeId, nodeId },
				})
					.then((result) => {
						if (active && store.previewHost.connection.value === current)
							snapshot.value = result
					})
					.catch(() => {})
			},
			{ immediate: true },
		)

		return { connection, blueprint, selectedNodeId, selectedNode, snapshot, visibleConsumers }
	})!
	sources.set(store, source)
	return source
}

/** `visible`: whether the calling panel can be seen; the shared snapshot is requested while any caller can be seen. */
export function useSelectedRuntimeWidget(visible: Readonly<Ref<boolean>> = shallowRef(true)): SelectedRuntimeWidget {
	const source = sharedSource(useLabStore())

	let counted = false
	const stopCounting = watch(visible, (isVisible) => {
		if (isVisible === counted)
			return
		counted = isVisible
		source.visibleConsumers.value += isVisible ? 1 : -1
	}, { immediate: true, flush: 'sync' })
	onScopeDispose(() => {
		stopCounting()
		if (counted)
			source.visibleConsumers.value -= 1
		counted = false
	})

	const widgetSnapshot = computed(() => visible.value ? source.snapshot.value : null)
	return {
		connection: source.connection,
		blueprint: source.blueprint,
		selectedNodeId: source.selectedNodeId,
		selectedNode: source.selectedNode,
		widgetSnapshot,
	}
}
