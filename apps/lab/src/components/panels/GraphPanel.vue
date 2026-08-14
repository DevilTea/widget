<script setup lang="ts">
/**
 * Dependency Graph panel (issue #13 Phase 5 "Dependency Graph semantic representation" / "implementation
 * stack" / "inspector panel interaction contract"). Available even for an invalid Blueprint — it
 * projects compile-time inspection facts only and never waits on/depends on Runtime. Canvas-prioritized
 * layout with compact/collapsible details, per the interaction contract.
 */
import { computed } from 'vue'
import { useDependencyGraph } from '../../composables/use-dependency-graph'
import { useGraphEdgeSelection } from '../../composables/use-graph-edge-selection'
import { useLabStore } from '../../composables/use-lab-store'
import GraphCanvas from '../graph/GraphCanvas.vue'
import GraphEdgeDetails from '../graph/GraphEdgeDetails.vue'

const store = useLabStore()
const { semanticGraph, layoutState, flow } = useDependencyGraph()

// Panel-local edge selection (issue #13 Phase 5: stays local, never expands into shared focus; reset on
// applied Blueprint identity change, not on ordinary tab switching — see the composable's own comment).
const { selected: selectedEdgeData, select: setSelectedEdgeData } = useGraphEdgeSelection(store)

function onNodeClick(nodeId: string): void {
	const vertex = semanticGraph.value.vertices.find(candidate => candidate.id === nodeId)
	if (vertex === undefined)
		return
	store.setFocus({
		nodeId: vertex.nodeId,
		member: { type: vertex.kind, name: vertex.name },
	})
}

function onEdgeClick(edgeId: string): void {
	for (const edge of flow.value?.edges ?? []) {
		if (edge.id === edgeId) {
			setSelectedEdgeData(edge.data ?? null)
			return
		}
	}
	setSelectedEdgeData(null)
}

const statusLabel = computed(() => {
	const status = layoutState.value.status
	if (status === 'idle' || status === 'loading')
		return 'Laying out…'
	if (status === 'error')
		return 'Layout failed.'
	return null
})
</script>

<template>
	<div :class="pika({ display: 'flex', flexDirection: 'column', height: '100%', minHeight: '0' })">
		<div :class="pika({ display: 'flex', alignItems: 'center', gap: '12px', padding: '4px 8px', borderBottom: '1px solid var(--lab-color-border)', fontSize: '11px', color: 'var(--lab-color-text-muted)', flex: '0 0 auto' })">
			<label :class="pika({ display: 'flex', alignItems: 'center', gap: '4px', cursor: 'pointer' })">
				<input
					v-model="store.graphShowAbsent.value"
					type="checkbox"
				>
				Show absent references
			</label>
			<label :class="pika({ display: 'flex', alignItems: 'center', gap: '4px', cursor: 'pointer' })">
				<input
					v-model="store.graphShowIsolatedMembers.value"
					type="checkbox"
				>
				Show isolated members
			</label>
			<span
				v-if="statusLabel"
				:class="pika({ marginLeft: 'auto' })"
			>{{ statusLabel }}</span>
		</div>

		<div :class="pika({ flex: '1 1 auto', minHeight: '0', position: 'relative' })">
			<GraphCanvas
				v-if="flow !== null"
				:nodes="flow.nodes"
				:edges="flow.edges"
				@nodeClick="onNodeClick"
				@edgeClick="onEdgeClick"
			/>
			<div
				v-else
				:class="pika({ padding: '16px', fontSize: '12px', color: 'var(--lab-color-text-muted)' })"
			>
				{{ statusLabel ?? 'No graph.' }}
			</div>
		</div>

		<GraphEdgeDetails
			v-if="selectedEdgeData !== null"
			:edge="selectedEdgeData"
		/>
	</div>
</template>
