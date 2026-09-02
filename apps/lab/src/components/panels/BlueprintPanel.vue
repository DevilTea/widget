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
import PanelDescriptionBar from '../PanelDescriptionBar.vue'

const store = useLabStore()
const i18n = useLabI18n()

const inspection = computed(() => inspectBlueprint(store.active.value.blueprint))
const selectedNodeId = computed<InspectionNodeId | null>(() => store.focus.value?.nodeId ?? null)
const selectedNode = computed(() => {
	const nodeId = selectedNodeId.value
	return nodeId === null ? null : inspection.value.getNode(nodeId)
})

const showAllDiagnostics = ref(false)
const collectedDiagnostics = computed(() => store.active.value.blueprint.diagnostics)

function selectNode(nodeId: InspectionNodeId): void {
	store.setFocus({ nodeId })
	showAllDiagnostics.value = false
}
</script>

<template>
	<div :class="pika({ display: 'flex', flexDirection: 'column', height: '100%', minHeight: '0' })">
		<PanelDescriptionBar
			storageKey="widget-lab:panel-desc:blueprint"
			text="What the applied Source compiled into — declarations, never live values"
		/>
		<div :class="pika({ display: 'grid', gridTemplateColumns: '220px 1px 1fr', flex: '1 1 auto', minHeight: '0' })">
			<BlueprintTree
				:inspection="inspection"
				:selectedNodeId="selectedNodeId"
				@select="selectNode"
			/>
			<div :class="pika({ background: 'var(--lab-color-border)' })" />
			<div :class="pika({ display: 'flex', flexDirection: 'column', minHeight: '0' })">
				<div :class="pika({ display: 'flex', borderBottom: '1px solid var(--lab-color-border)', flex: '0 0 auto' })">
					<button
						type="button"
						:class="pika({ flex: '1 1 auto', padding: '6px', fontSize: '11px', border: 'none', background: 'transparent', color: 'var(--lab-color-text)', cursor: 'pointer' })"
						:style="{ fontWeight: showAllDiagnostics ? 'normal' : '600', borderBottom: showAllDiagnostics ? 'none' : '2px solid var(--lab-color-accent)' }"
						@click="showAllDiagnostics = false"
					>
						{{ i18n.t('Selected node') }}
					</button>
					<button
						type="button"
						:class="pika({ flex: '1 1 auto', padding: '6px', fontSize: '11px', border: 'none', background: 'transparent', color: 'var(--lab-color-text)', cursor: 'pointer' })"
						:style="{ fontWeight: showAllDiagnostics ? '600' : 'normal', borderBottom: showAllDiagnostics ? '2px solid var(--lab-color-accent)' : 'none' }"
						@click="showAllDiagnostics = true"
					>
						{{ i18n.t('All diagnostics') }} ({{ collectedDiagnostics.length }})
					</button>
				</div>
				<div :class="pika({ flex: '1 1 auto', minHeight: '0', overflow: 'auto' })">
					<BlueprintNodeDetails
						v-if="!showAllDiagnostics"
						:node="selectedNode"
						:blueprint="store.active.value.blueprint"
						:inspection="inspection"
						@navigate="selectNode"
					/>
					<div
						v-else
						:class="pika({ padding: '10px' })"
					>
						<DiagnosticList
							:diagnostics="collectedDiagnostics"
							:inspection="inspection"
							@navigate="selectNode"
						/>
					</div>
				</div>
			</div>
		</div>
	</div>
</template>
