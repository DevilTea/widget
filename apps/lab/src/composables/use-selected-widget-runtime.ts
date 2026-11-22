/**
 * The selected widget as the explaining panels show it (Selected widget, Explain): its Document node, and its Runtime values
 * only while the Preview shows the Document's revision. Otherwise `runtimeState` says why there are none (`unresolved`,
 * `no-preview`, `diverged`, `unavailable`, `loading`) and `runtimeMessage` says it in words, so no panel mixes two
 * revisions. The Runtime data is the shared snapshot of `useSelectedRuntimeWidget()` (one request per selection for the
 * whole Lab). Extracted from `SelectedWidgetPanel.vue` in Lab UX phase 2 so both panels follow the same rules.
 */
import type { BlueprintInspection, BlueprintInspectionNode } from '@deviltea/widget-core/inspection'
import type { ComputedRef, Ref } from 'vue'
import type { SelectedRuntimeWidget } from './use-selected-runtime-widget'
import { inspectBlueprint } from '@deviltea/widget-core/inspection'
import { computed } from 'vue'
import { getRuntimeInspectorSource } from '../runtime-inspector/source'
import { useLabI18n } from './use-lab-i18n'
import { useLabStore } from './use-lab-store'
import { useSelectedRuntimeWidget } from './use-selected-runtime-widget'

export type SelectedWidgetRuntimeState = 'ready' | 'loading' | 'no-preview' | 'diverged' | 'unresolved' | 'unavailable'

export interface SelectedWidgetRuntime extends SelectedRuntimeWidget {
	readonly inspection: ComputedRef<BlueprintInspection>
	/** The selected widget in the current Document (`null` when nothing is selected). */
	readonly documentNode: ComputedRef<BlueprintInspectionNode | null>
	readonly runtimeState: ComputedRef<SelectedWidgetRuntimeState>
	/** Why there are no Runtime values, in words; `''` while they are `ready`. */
	readonly runtimeMessage: ComputedRef<string>
	/** The Preview's revision, `null` without a Preview. */
	readonly previewRevision: ComputedRef<number | null>
}

export function useSelectedWidgetRuntime(visible: Readonly<Ref<boolean>>): SelectedWidgetRuntime {
	const store = useLabStore()
	const i18n = useLabI18n()
	const inspection = computed(() => inspectBlueprint(store.documentState.value.blueprint))
	const documentNode = computed(() => {
		const nodeId = store.documentFocus.value?.nodeId
		return nodeId === undefined ? null : inspection.value.getNode(nodeId)
	})
	const source = computed(() => getRuntimeInspectorSource(store.preview.value, store.documentState.value.revision))
	const selected = useSelectedRuntimeWidget(visible)

	const runtimeState = computed<SelectedWidgetRuntimeState>(() => {
		if (documentNode.value !== null && !documentNode.value.resolved)
			return 'unresolved'
		if (selected.connection.value === null || store.preview.value === null)
			return 'no-preview'
		if (source.value.isDiverged)
			return 'diverged'
		if (selected.selectedNode.value === null)
			return 'unavailable'
		return selected.widgetSnapshot.value === null ? 'loading' : 'ready'
	})

	const runtimeMessage = computed(() => {
		switch (runtimeState.value) {
			case 'unresolved': return i18n.t('This widget did not resolve, so it has no Runtime.')
			case 'no-preview': return i18n.t('No Runtime values yet: there is no valid preview to read them from.')
			case 'diverged': return i18n.t('The preview shows the last valid version (r{preview}), not the current document (r{document}). Runtime values come from the preview: fix the problems to see this widget\'s values.', { preview: source.value.previewRevision ?? '', document: store.documentState.value.revision })
			case 'unavailable': return i18n.t('This widget is not in the running preview.')
			case 'loading': return i18n.t('Loading Runtime values…')
			default: return ''
		}
	})

	return {
		...selected,
		inspection,
		documentNode,
		runtimeState,
		runtimeMessage,
		previewRevision: computed(() => source.value.previewRevision),
	}
}
