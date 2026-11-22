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
import type { PanelVisibilityApi } from '../../composables/use-panel-visibility'
import { computed } from 'vue'
import { useLabI18n } from '../../composables/use-lab-i18n'
import { useLabStore } from '../../composables/use-lab-store'
import { usePanelVisibility } from '../../composables/use-panel-visibility'
import { useSelectedWidgetRuntime } from '../../composables/use-selected-widget-runtime'
import BlueprintNodeDetails from '../blueprint/BlueprintNodeDetails.vue'
import InspectorPanelShell from '../inspector/InspectorPanelShell.vue'
import RuntimeNodeDetails from '../runtime/RuntimeNodeDetails.vue'

const props = defineProps<{ params?: { api?: PanelVisibilityApi } }>()
const store = useLabStore()
const i18n = useLabI18n()

const blueprint = computed(() => store.documentState.value.blueprint)
const visible = usePanelVisibility(props.params?.api)
// The linked/diverged rules are shared with the Explain tab (`use-selected-widget-runtime.ts`).
const {
	inspection,
	documentNode: selectedNode,
	connection,
	selectedNode: runtimeNode,
	widgetSnapshot,
	runtimeState,
	runtimeMessage,
} = useSelectedWidgetRuntime(visible)

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
