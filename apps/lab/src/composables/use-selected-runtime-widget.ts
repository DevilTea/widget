/**
 * The Preview-scoped selection as the Runtime inspectors show it: the Preview Blueprint snapshot, the selected
 * resolved node, and that widget's Runtime snapshot requested through the Inspector client. Shared by the Runtime
 * panel and the Selected widget panel so both read the same remote data the same way. Nothing here touches a Core
 * Runtime: every value is an Inspector protocol DTO from the Preview frame.
 */
import type { InspectorBlueprintNode, InspectorBlueprintSnapshot, InspectorRuntimeWidgetSnapshot } from '@deviltea/widget-inspector/protocol'
import type { Ref } from 'vue'
import { computed, shallowRef, watch } from 'vue'
import { useLabStore } from './use-lab-store'

export interface SelectedRuntimeWidget {
	readonly connection: Readonly<Ref<ReturnType<typeof useLabStore>['previewHost']['connection']['value']>>
	readonly blueprint: Readonly<Ref<InspectorBlueprintSnapshot | null>>
	readonly selectedNodeId: Readonly<Ref<number | null>>
	/** The selected node, only when it is resolved (an unresolved widget has no Runtime). */
	readonly selectedNode: Readonly<Ref<InspectorBlueprintNode | null>>
	readonly widgetSnapshot: Readonly<Ref<InspectorRuntimeWidgetSnapshot | null>>
}

export function useSelectedRuntimeWidget(): SelectedRuntimeWidget {
	const store = useLabStore()
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
	const widgetSnapshot = shallowRef<InspectorRuntimeWidgetSnapshot | null>(null)

	watch(
		() => [connection.value, selectedNodeId.value] as const,
		([current, nodeId], _previous, onCleanup) => {
			widgetSnapshot.value = null
			if (current === null || nodeId === null)
				return
			let active = true
			onCleanup(() => {
				active = false
			})
			void current.inspectorClient.request('runtime.getWidgetSnapshot', {
				ref: { runtimeId: current.runtimeId, nodeId },
			})
				.then((snapshot) => {
					if (active && store.previewHost.connection.value === current)
						widgetSnapshot.value = snapshot
				})
				.catch(() => {})
		},
		{ immediate: true },
	)

	return { connection, blueprint, selectedNodeId, selectedNode, widgetSnapshot }
}
