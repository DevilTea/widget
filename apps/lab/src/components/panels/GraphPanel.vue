<script setup lang="ts">
/** Dependency Graph panel. #43 localizes Lab-owned controls/status prose, never semantic graph labels. */
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
const { selected: selectedEdgeData, select: setSelectedEdgeData } = useGraphEdgeSelection(store)

const graphCanvas = useTemplateRef<InstanceType<typeof GraphCanvas>>('graphCanvas')
function onFitGraphClick(): void {
	graphCanvas.value?.fitGraph()
}

function onNodeClick(nodeId: string): void {
	const vertex = semanticGraph.value.vertices.find(candidate => candidate.id === nodeId)
	if (vertex === undefined)
		return
	store.setFocus({
		nodeId: vertex.nodeId,
		member: { type: vertex.kind, name: vertex.name },
	})
}

function onEdgeClick(data: unknown): void {
	if (typeof data !== 'object' || data === null)
		return
	setSelectedEdgeData(data as Parameters<typeof setSelectedEdgeData>[0])
}

const edgeKindCounts = computed(() => {
	const counts = { reads: 0, writes: 0, invokes: 0 }
	for (const edge of semanticGraph.value.edges)
		counts[edge.operation]++
	return counts
})
</script>

<template>
	<div
		data-tutorial-target="graph"
		:class="pika({ display: 'flex', flexDirection: 'column', height: '100%', minHeight: '0' })"
	>
		<PanelDescriptionBar
			storageKey="widget-lab:panel-desc:graph"
			text="The declared semantic dependencies between widget members"
		/>
		<div :class="pika({ display: 'flex', alignItems: 'center', gap: '8px', padding: '6px 10px', borderBottom: '1px solid var(--lab-color-border)', flex: '0 0 auto' })">
			<GraphLegend />
			<span :class="pika({ fontSize: '11px', color: 'var(--lab-color-text-muted)' })">
				{{ edgeKindCounts.reads }} reads · {{ edgeKindCounts.writes }} writes · {{ edgeKindCounts.invokes }} invokes
			</span>
			<label :class="pika({ display: 'inline-flex', alignItems: 'center', gap: '4px', fontSize: '11px', marginLeft: 'auto' })">
				<input
					type="checkbox"
					:checked="store.graphShowAbsentReferences.value"
					@change="store.graphShowAbsentReferences.value = ($event.target as HTMLInputElement).checked"
				>
				{{ i18n.t('Show absent references') }}
			</label>
			<label :class="pika({ display: 'inline-flex', alignItems: 'center', gap: '4px', fontSize: '11px' })">
				<input
					type="checkbox"
					:checked="store.graphShowIsolatedMembers.value"
					@change="store.graphShowIsolatedMembers.value = ($event.target as HTMLInputElement).checked"
				>
				{{ i18n.t('Show isolated members') }}
			</label>
			<button
				type="button"
				:disabled="flow.nodes.length === 0"
				:class="pika({ 'padding': '3px 8px', 'fontSize': '11px', 'borderRadius': 'var(--lab-radius)', 'border': '1px solid var(--lab-color-border)', 'background': 'var(--lab-color-surface-alt)', 'color': 'var(--lab-color-text)', 'cursor': 'pointer', '$:disabled': { opacity: '0.5', cursor: 'not-allowed' } })"
				@click="onFitGraphClick"
			>
				{{ i18n.t('Fit graph') }}
			</button>
		</div>

		<div :class="pika({ position: 'relative', flex: '1 1 auto', minHeight: '0' })">
			<GraphCanvas
				ref="graphCanvas"
				:nodes="flow.nodes"
				:edges="flow.edges"
				:selectedEdgeId="selectedEdgeData?.id ?? null"
				@node-click="onNodeClick"
				@edge-click="onEdgeClick"
			/>
			<div
				v-if="layoutState.status === 'loading'"
				:class="pika({ position: 'absolute', inset: '0', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '12px', color: 'var(--lab-color-text-muted)', pointerEvents: 'none' })"
			>
				{{ i18n.t('Laying out…') }}
			</div>
			<div
				v-else-if="layoutState.status === 'error'"
				role="alert"
				:class="pika({ position: 'absolute', top: '12px', left: '12px', right: '12px', padding: '8px 10px', borderRadius: 'var(--lab-radius)', border: '1px solid var(--lab-color-danger)', background: 'var(--lab-color-surface)', color: 'var(--lab-color-danger)', fontSize: '12px' })"
			>
				{{ i18n.t('Layout failed — the ELK layout worker reported an error. Toggling a filter below re-requests a fresh layout.') }}
			</div>
			<div
				v-else-if="flow.nodes.length === 0"
				:class="pika({ position: 'absolute', inset: '0', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '12px', color: 'var(--lab-color-text-muted)', pointerEvents: 'none' })"
			>
				{{ i18n.t('No graph yet — this Blueprint has no widgets to lay out.') }}
			</div>
		</div>

		<GraphEdgeDetails
			v-if="selectedEdgeData !== null"
			:edge="selectedEdgeData"
			@close="setSelectedEdgeData(null)"
		/>
	</div>
</template>
