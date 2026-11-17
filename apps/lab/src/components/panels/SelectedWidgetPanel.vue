<script setup lang="ts">
/**
 * "Selected widget" (issue #230 PR 3b, the first piece of the Explain area): one widget explained in one place.
 * Left, what the applied source declares for it (Blueprint: identity, location, config, slots, members,
 * diagnostics); right, what it holds right now (Runtime: State, Properties and Methods, with expandable values).
 * Narrow panes stack the two.
 *
 * The widget is the shared Document focus (the Blueprint tree, the Relations/Graph views and Inspect in the
 * Preview all set it). The Runtime half reads the Preview frame through the Inspector client, so it only exists
 * while the Preview shows the same revision as the Document; otherwise the panel says why instead of mixing two
 * revisions. Both halves are the existing detail components, so Blueprint and Runtime stay as they are. Read-only.
 */
import type { InspectionNodeId } from '@deviltea/widget-core/inspection'
import { inspectBlueprint } from '@deviltea/widget-core/inspection'
import { computed } from 'vue'
import { useLabI18n } from '../../composables/use-lab-i18n'
import { useLabStore } from '../../composables/use-lab-store'
import { useSelectedRuntimeWidget } from '../../composables/use-selected-runtime-widget'
import { getRuntimeInspectorSource } from '../../runtime-inspector/source'
import BlueprintNodeDetails from '../blueprint/BlueprintNodeDetails.vue'
import InspectorPanelShell from '../inspector/InspectorPanelShell.vue'
import RuntimeNodeDetails from '../runtime/RuntimeNodeDetails.vue'

const store = useLabStore()
const i18n = useLabI18n()

const blueprint = computed(() => store.documentState.value.blueprint)
const inspection = computed(() => inspectBlueprint(blueprint.value))
const selectedNode = computed(() => {
	const nodeId = store.documentFocus.value?.nodeId
	return nodeId === undefined ? null : inspection.value.getNode(nodeId)
})

const source = computed(() => getRuntimeInspectorSource(store.preview.value, store.documentState.value.revision))
const { connection, selectedNode: runtimeNode, widgetSnapshot } = useSelectedRuntimeWidget()

type RuntimeState = 'ready' | 'loading' | 'no-preview' | 'diverged' | 'unresolved' | 'unavailable'
const runtimeState = computed<RuntimeState>(() => {
	if (selectedNode.value !== null && !selectedNode.value.resolved)
		return 'unresolved'
	if (connection.value === null || store.preview.value === null)
		return 'no-preview'
	if (source.value.isDiverged)
		return 'diverged'
	if (runtimeNode.value === null)
		return 'unavailable'
	return widgetSnapshot.value === null ? 'loading' : 'ready'
})

const runtimeMessage = computed(() => {
	switch (runtimeState.value) {
		case 'unresolved': return i18n.t('This widget did not resolve, so it has no Runtime.')
		case 'no-preview': return i18n.t('No Runtime values yet: there is no valid preview to read them from.')
		case 'diverged': return i18n.t('The preview shows the last valid version (r{preview}), not the current document (r{document}). Runtime values come from the preview: fix the problems and Apply to see this widget\'s values.', { preview: source.value.previewRevision ?? '', document: store.documentState.value.revision })
		case 'unavailable': return i18n.t('This widget is not in the running preview.')
		case 'loading': return i18n.t('Loading Runtime values…')
		default: return ''
	}
})

function navigate(nodeId: InspectionNodeId): void {
	store.setFocus('document', { nodeId })
}
</script>

<template>
	<InspectorPanelShell
		storageKey="widget-lab:panel-desc:widget"
		text="One widget explained: what the source declares for it and what it holds right now. Select a widget with Inspect in the Preview, or in Blueprint or Dependencies"
	>
		<div
			data-testid="selected-widget"
			:data-runtime-state="runtimeState"
			class="@container min-h-0 flex-1 overflow-auto"
		>
			<div class="grid gap-x-4 @min-[600px]:grid-cols-2">
				<section
					data-testid="selected-widget-declaration"
					aria-labelledby="selected-widget-declaration-heading"
					class="min-w-0"
				>
					<h3
						id="selected-widget-declaration-heading"
						class="m-0 border-b border-default bg-muted px-2.5 py-1.5 text-xs font-semibold"
					>
						{{ i18n.t('Declaration') }}
						<span class="font-normal text-muted">· {{ i18n.t('what the source says') }}</span>
					</h3>
					<BlueprintNodeDetails
						embedded
						:node="selectedNode"
						:blueprint="blueprint"
						:inspection="inspection"
						@navigate="navigate"
					/>
				</section>
				<section
					data-testid="selected-widget-runtime"
					aria-labelledby="selected-widget-runtime-heading"
					class="min-w-0 @max-[599px]:mt-2"
				>
					<h3
						id="selected-widget-runtime-heading"
						class="m-0 border-b border-default bg-muted px-2.5 py-1.5 text-xs font-semibold"
					>
						{{ i18n.t('Runtime values') }}
						<span class="font-normal text-muted">· {{ i18n.t('what it holds right now') }}</span>
					</h3>
					<RuntimeNodeDetails
						v-if="runtimeState === 'ready'"
						embedded
						:node="runtimeNode"
						:widgetSnapshot="widgetSnapshot"
						:client="connection?.inspectorClient ?? null"
					/>
					<p
						v-else
						data-testid="selected-widget-runtime-message"
						role="status"
						class="m-0 px-2.5 py-2.5 text-xs text-muted"
					>
						{{ runtimeMessage }}
					</p>
				</section>
			</div>
		</div>
	</InspectorPanelShell>
</template>
