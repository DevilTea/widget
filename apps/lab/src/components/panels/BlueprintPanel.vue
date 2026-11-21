<script setup lang="ts">
/**
 * Blueprint Inspector (diagnostic #13 Widget Lab Phase 4 Checkpoint H). Readonly consumer of
 * `@deviltea/widget-core/inspection`: never mutates State, invokes Methods, or forces Property
 * evaluation. Narrow/tall tree-over-details layout, with a separate "All diagnostics"
 * (`blueprint.diagnostics`) view kept distinct from the selected node's own
 * `getDiagnostics()`. #43 localizes only fixed Lab chrome; node/type/member identities and core diagnostic
 * messages stay verbatim.
 */
import type { InspectionNodeId } from '@deviltea/widget-core/inspection'
import { inspectBlueprint } from '@deviltea/widget-core/inspection'
import { computed, ref } from 'vue'
import { useLabI18n } from '../../composables/use-lab-i18n'
import { useLabStore } from '../../composables/use-lab-store'
import BlueprintNodeDetails from '../blueprint/BlueprintNodeDetails.vue'
import BlueprintTree from '../blueprint/BlueprintTree.vue'
import DiagnosticList from '../blueprint/DiagnosticList.vue'
import InspectorPanelShell from '../inspector/InspectorPanelShell.vue'
import InspectorSplitLayout from '../inspector/InspectorSplitLayout.vue'

const store = useLabStore()
const i18n = useLabI18n()

const inspection = computed(() => inspectBlueprint(store.documentState.value.blueprint))
const selectedNodeId = computed<InspectionNodeId | null>(() => store.documentFocus.value?.nodeId ?? null)
const selectedNode = computed(() => {
	const nodeId = selectedNodeId.value
	return nodeId === null ? null : inspection.value.getNode(nodeId)
})

const showAllDiagnostics = ref(false)
const collectedDiagnostics = computed(() => store.documentState.value.blueprint.diagnostics)

function selectNode(nodeId: InspectionNodeId): void {
	store.setFocus('document', { nodeId })
	showAllDiagnostics.value = false
}
</script>

<template>
	<InspectorPanelShell
		storageKey="widget-lab:panel-desc:blueprint"
		text="What the applied Source compiled into — declarations, never live values"
	>
		<InspectorSplitLayout>
			<template #tree>
				<BlueprintTree
					:inspection="inspection"
					:selectedNodeId="selectedNodeId"
					@select="selectNode"
				/>
			</template>
			<template #details>
				<div class="flex border-b border-b-lab-border flex-none">
					<button
						type="button"
						class="flex-auto p-[6px] text-[11px] [border:none] bg-transparent text-lab-text cursor-pointer"
						:style="{ fontWeight: showAllDiagnostics ? 'normal' : '600', borderBottom: showAllDiagnostics ? 'none' : '2px solid var(--lab-color-accent)' }"
						@click="showAllDiagnostics = false"
					>
						{{ i18n.t('Selected node') }}
					</button>
					<button
						type="button"
						class="flex-auto p-[6px] text-[11px] [border:none] bg-transparent text-lab-text cursor-pointer"
						:style="{ fontWeight: showAllDiagnostics ? '600' : 'normal', borderBottom: showAllDiagnostics ? '2px solid var(--lab-color-accent)' : 'none' }"
						@click="showAllDiagnostics = true"
					>
						{{ i18n.t('All diagnostics') }} ({{ collectedDiagnostics.length }})
					</button>
				</div>
				<div class="flex-auto min-h-0 overflow-auto">
					<BlueprintNodeDetails
						v-if="!showAllDiagnostics"
						:node="selectedNode"
						:blueprint="store.documentState.value.blueprint"
						:inspection="inspection"
						@navigate="selectNode"
					/>
					<div
						v-else
						class="p-[10px]"
					>
						<DiagnosticList
							:diagnostics="collectedDiagnostics"
							:inspection="inspection"
							@navigate="selectNode"
						/>
					</div>
				</div>
			</template>
		</InspectorSplitLayout>
	</InspectorPanelShell>
</template>
