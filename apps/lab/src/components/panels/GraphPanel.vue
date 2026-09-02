<script setup lang="ts">
/**
 * Dependency Graph panel (diagnostic #13 Phase 5 "Dependency Graph semantic representation" / "implementation
 * stack" / "inspector panel interaction contract"). Available even for an invalid Blueprint — it
 * projects compile-time inspection facts only and never waits on/depends on Runtime. Canvas-prioritized
 * layout with compact/collapsible details, per the interaction contract. #43 localizes fixed Lab chrome
 * only; graph node/edge semantic identities remain verbatim.
 */
import { computed, useTemplateRef } from 'vue'
import { useDependencyGraph } from '../../composables/use-dependency-graph'
import { useGraphEdgeSelection } from '../../composables/use-graph-edge-selection'
import { useLabI18n } from '../../composables/use-lab-i18n'
import { useLabStore } from '../../composables/use-lab-store'
import GraphCanvas from '../graph/GraphCanvas.vue'
import GraphEdgeDetails from '../graph/GraphEdgeDetails.vue'
import GraphLegend from '../graph/GraphLegend.vue'
import PanelDescriptionBar from '../PanelDescriptionBar.vue'

const store = useLabStore()
const i18n = useLabI18n()
const { semanticGraph, layoutState, flow } = useDependencyGraph()

// Panel-local edge selection (diagnostic #13 Phase 5: stays local, never expands into shared focus; reset on
// applied Blueprint identity change, not on ordinary tab switching — see the composable's own comment).
const { selected: selectedEdgeData, select: setSelectedEdgeData } = useGraphEdgeSelection(store)

// diagnostic #27 Finding 1: manual recovery for the viewport-fit policy — same `fitView` path
// `GraphCanvas.vue` already calls automatically once a new laid-out graph's nodes render.
const graphCanvas = useTemplateRef<InstanceType<typeof GraphCanvas>>('graphCanvas')
function onFitGraphClick(): void {
	graphCanvas.value?.fitGraph()
}

function onNodeClick(nodeId: string): void {
	const vertex = semanticGraph.value.vertices.find(candidate => candidate.id === nodeId)
	if (vertex === undefined)
		return
	store.setFocus('document', {
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

// diagnostic #25 P4 Scope D copy audit: say why, and what to do next, rather than a bare status word.
const statusLabel = computed(() => {
	const status = layoutState.value.status
	if (status === 'idle' || status === 'loading')
		return i18n.t('Laying out…')
	if (status === 'error')
		return i18n.t('Layout failed — the ELK layout worker reported an error. Toggling a filter below re-requests a fresh layout.')
	return null
})
</script>

<template>
	<div :class="pika({ display: 'flex', flexDirection: 'column', height: '100%', minHeight: '0' })">
		<PanelDescriptionBar
			storageKey="widget-lab:panel-desc:graph"
			text="The declared semantic dependencies between widget members"
		/>
		<div :class="pika({ display: 'flex', alignItems: 'center', gap: '12px', padding: '4px 8px', borderBottom: '1px solid var(--lab-color-border)', fontSize: '11px', color: 'var(--lab-color-text-muted)', flex: '0 0 auto' })">
			<label :class="pika({ display: 'flex', alignItems: 'center', gap: '4px', cursor: 'pointer' })">
				<input
					v-model="store.graphShowAbsent.value"
					type="checkbox"
				>
				{{ i18n.t('Show absent references') }}
			</label>
			<label :class="pika({ display: 'flex', alignItems: 'center', gap: '4px', cursor: 'pointer' })">
				<input
					v-model="store.graphShowIsolatedMembers.value"
					type="checkbox"
				>
				{{ i18n.t('Show isolated members') }}
			</label>
			<button
				type="button"
				:disabled="flow === null"
				:aria-label="i18n.t('Fit graph')"
				:class="pika({ 'padding': '3px 8px', 'fontSize': '11px', 'borderRadius': 'var(--lab-radius)', 'border': '1px solid var(--lab-color-border)', 'background': 'var(--lab-color-surface-alt)', 'color': 'var(--lab-color-text)', 'cursor': 'pointer', '$:disabled': { opacity: '0.5', cursor: 'not-allowed' } })"
				@click="onFitGraphClick"
			>
				{{ i18n.t('Fit graph') }}
			</button>
			<GraphLegend />
			<span
				v-if="statusLabel"
				:class="pika({ marginLeft: 'auto' })"
			>{{ statusLabel }}</span>
		</div>

		<div :class="pika({ flex: '1 1 auto', minHeight: '0', position: 'relative' })">
			<GraphCanvas
				v-if="flow !== null"
				ref="graphCanvas"
				:nodes="flow.nodes"
				:edges="flow.edges"
				@nodeClick="onNodeClick"
				@edgeClick="onEdgeClick"
			/>
			<div
				v-else
				:class="pika({ padding: '16px', fontSize: '12px', color: 'var(--lab-color-text-muted)' })"
			>
				{{ statusLabel ?? i18n.t('No graph yet — this Blueprint has no widgets to lay out.') }}
			</div>
		</div>

		<GraphEdgeDetails
			v-if="selectedEdgeData !== null"
			:edge="selectedEdgeData"
		/>
	</div>
</template>
