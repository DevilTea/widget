<script setup lang="ts">
/**
 * Blueprint Inspector (issue #13 Widget Lab Phase 4 Checkpoint H). Readonly consumer of
 * `@deviltea/widget-core/inspection`: never mutates State, invokes Methods, or forces Property
 * evaluation. Narrow/tall tree-over-details layout, with a separate "All issues"
 * (`blueprint.getCollectedIssues()`) view kept distinct from the selected node's own
 * `getIssues()`.
 */
import type { InspectionNodeId } from '@deviltea/widget-core/inspection'
import { inspectBlueprint } from '@deviltea/widget-core/inspection'
import { computed, ref } from 'vue'
import { useLabStore } from '../../composables/use-lab-store'
import BlueprintNodeDetails from '../blueprint/BlueprintNodeDetails.vue'
import BlueprintTree from '../blueprint/BlueprintTree.vue'
import IssueList from '../blueprint/IssueList.vue'
import PanelDescriptionBar from '../PanelDescriptionBar.vue'

const store = useLabStore()

const inspection = computed(() => inspectBlueprint(store.active.value.blueprint))
const selectedNodeId = computed<InspectionNodeId | null>(() => store.focus.value?.nodeId ?? null)
const selectedNode = computed(() => {
	const nodeId = selectedNodeId.value
	return nodeId === null ? null : inspection.value.getNode(nodeId)
})

const showAllIssues = ref(false)
const collectedIssues = computed(() => store.active.value.blueprint.getCollectedIssues())

function selectNode(nodeId: InspectionNodeId): void {
	store.setFocus({ nodeId })
	showAllIssues.value = false
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
						:style="{ fontWeight: showAllIssues ? 'normal' : '600', borderBottom: showAllIssues ? 'none' : '2px solid var(--lab-color-accent)' }"
						@click="showAllIssues = false"
					>
						Selected node
					</button>
					<button
						type="button"
						:class="pika({ flex: '1 1 auto', padding: '6px', fontSize: '11px', border: 'none', background: 'transparent', color: 'var(--lab-color-text)', cursor: 'pointer' })"
						:style="{ fontWeight: showAllIssues ? '600' : 'normal', borderBottom: showAllIssues ? '2px solid var(--lab-color-accent)' : 'none' }"
						@click="showAllIssues = true"
					>
						All issues ({{ collectedIssues.length }})
					</button>
				</div>
				<div :class="pika({ flex: '1 1 auto', minHeight: '0', overflow: 'auto' })">
					<BlueprintNodeDetails
						v-if="!showAllIssues"
						:node="selectedNode"
						:blueprint="store.active.value.blueprint"
						:inspection="inspection"
						@navigate="selectNode"
					/>
					<div
						v-else
						:class="pika({ padding: '10px' })"
					>
						<IssueList
							:issues="collectedIssues"
							:inspection="inspection"
							@navigate="selectNode"
						/>
					</div>
				</div>
			</div>
		</div>
	</div>
</template>
