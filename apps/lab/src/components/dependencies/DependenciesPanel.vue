<script setup lang="ts">
/**
 * Dependencies inspector panel (formerly Graph panel).
 *
 * Provides a unified domain for dependency inspection with two complementary views:
 * - `Relations`: focus-centric 3-column dependency inspector (Used by / Focus / Depends on)
 *   projected directly from authoritative `SemanticGraph` without ELK or Vue Flow.
 * - `Graph`: top-level topological canvas with ELK layout and progressive cluster disclosure.
 *
 * Graph remains the default view. Both views share the authoritative Document-scoped focus
 * and the `Show absent references` filter without duplicating semantic state.
 */
import type { InspectionNodeId } from '@deviltea/widget-core/inspection'
import type { GraphVertexKind } from '../../graph/types'
import { inspectBlueprint } from '@deviltea/widget-core/inspection'
import { computed, nextTick, ref, useTemplateRef } from 'vue'
import { useDependencyGraph } from '../../composables/use-dependency-graph'
import { useGraphEdgeSelection } from '../../composables/use-graph-edge-selection'
import { useLabI18n } from '../../composables/use-lab-i18n'
import { useLabStore } from '../../composables/use-lab-store'
import { projectSemanticGraph } from '../../graph/projection'
import { projectRelations } from '../../graph/relations'
import GraphCanvas from '../graph/GraphCanvas.vue'
import GraphEdgeDetails from '../graph/GraphEdgeDetails.vue'
import GraphLegend from '../graph/GraphLegend.vue'
import PanelDescriptionBar from '../PanelDescriptionBar.vue'
import RelationsView from './relations/RelationsView.vue'

const store = useLabStore()
const i18n = useLabI18n()
const { semanticGraph, layoutState, flow, layoutVersion } = useDependencyGraph()

// Panel-local edge selection for Graph view
const { selected: selectedEdgeData, select: setSelectedEdgeData } = useGraphEdgeSelection(store)

// View switcher: default to 'graph' so existing users do not open a blank focus-centric screen
type DependenciesView = 'graph' | 'relations'
const activeView = ref<DependenciesView>('graph')
const relationsTab = useTemplateRef<HTMLButtonElement>('relationsTab')
const graphTab = useTemplateRef<HTMLButtonElement>('graphTab')

function activateView(view: DependenciesView, moveFocus = false): void {
	activeView.value = view
	if (!moveFocus)
		return

	void nextTick(() => {
		if (view === 'relations')
			relationsTab.value?.focus()
		else
			graphTab.value?.focus()
	})
}

function onViewTabKeydown(event: KeyboardEvent, current: DependenciesView): void {
	let next: DependenciesView | null = null
	if (event.key === 'ArrowLeft' || event.key === 'ArrowRight')
		next = current === 'graph' ? 'relations' : 'graph'
	else if (event.key === 'Home')
		next = 'relations'
	else if (event.key === 'End')
		next = 'graph'

	if (next === null)
		return

	event.preventDefault()
	activateView(next, true)
}

// Relations shares the authoritative dependency projection and the absent-reference preference,
// but deliberately ignores Graph's "show isolated members" presentation filter: a focused member
// must remain inspectable even when it would be hidden from the topology canvas.
const relationsSemanticGraph = computed(() => {
	const inspection = inspectBlueprint(store.documentState.value.blueprint)
	return projectSemanticGraph(inspection, {
		showAbsent: store.graphShowAbsent.value,
		showIsolatedMembers: true,
	})
})

const relationsModel = computed(() => {
	const rootNodeId = inspectBlueprint(store.documentState.value.blueprint).rootNodeId
	return projectRelations(relationsSemanticGraph.value, store.focus.value, rootNodeId)
})

// Graph canvas template ref for manual viewport recovery
const graphCanvas = useTemplateRef<InstanceType<typeof GraphCanvas>>('graphCanvas')
function onFitGraphClick(): void {
	graphCanvas.value?.fitGraph()
}

function onSelectMember(payload: { nodeId: InspectionNodeId, member: { type: GraphVertexKind, name: string } }): void {
	store.setFocus('document', payload)
}

function onSelectWidget(nodeId: InspectionNodeId): void {
	store.setFocus('document', { nodeId })
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

function onClusterClick(clusterId: string): void {
	const cluster = semanticGraph.value.clusters.find(candidate => candidate.id === clusterId)
	if (cluster !== undefined)
		store.setFocus('document', { nodeId: cluster.nodeId })
}

function onToggleCluster(clusterId: string): void {
	store.toggleGraphCluster(clusterId)
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
		return i18n.t('Laying out…')
	if (status === 'error')
		return i18n.t('Layout failed — the ELK layout worker reported an error. Toggling a filter below re-requests a fresh layout.')
	return null
})
</script>

<template>
	<div :class="pika({ display: 'flex', flexDirection: 'column', height: '100%', minHeight: '0' })">
		<PanelDescriptionBar
			storageKey="widget-lab:panel-desc:dependencies"
			text="The declared semantic dependencies between widget members"
		/>

		<!-- Toolbar -->
		<div
			class="dependencies-toolbar"
			:class="pika({
				display: 'flex',
				alignItems: 'center',
				gap: '10px',
				padding: '4px 8px',
				borderBottom: '1px solid var(--lab-color-border)',
				fontSize: '11px',
				color: 'var(--lab-color-text-muted)',
				flex: '0 0 auto',
				flexWrap: 'wrap',
			})"
		>
			<!-- View Switcher (Relations | Graph) -->
			<div
				role="tablist"
				:aria-label="i18n.t('Dependencies views')"
				:class="pika({
					display: 'inline-flex',
					borderRadius: 'var(--lab-radius)',
					border: '1px solid var(--lab-color-border)',
					overflow: 'hidden',
					background: 'var(--lab-color-surface-alt)',
				})"
			>
				<button
					id="dependencies-view-tab-relations"
					ref="relationsTab"
					type="button"
					role="tab"
					aria-controls="dependencies-view-panel-relations"
					:aria-selected="activeView === 'relations'"
					:tabindex="activeView === 'relations' ? 0 : -1"
					:class="[
						pika({
							padding: '2px 9px',
							fontSize: '11px',
							border: 'none',
							cursor: 'pointer',
							fontFamily: 'var(--lab-font-sans)',
						}),
						activeView === 'relations'
							? pika({ background: 'var(--lab-color-accent)', color: '#fff', fontWeight: 'bold' })
							: pika({ background: 'transparent', color: 'var(--lab-color-text)' }),
					]"
					@click="activateView('relations')"
					@keydown="onViewTabKeydown($event, 'relations')"
				>
					{{ i18n.t('Relations') }}
				</button>
				<button
					id="dependencies-view-tab-graph"
					ref="graphTab"
					type="button"
					role="tab"
					aria-controls="dependencies-view-panel-graph"
					:aria-selected="activeView === 'graph'"
					:tabindex="activeView === 'graph' ? 0 : -1"
					:class="[
						pika({
							padding: '2px 9px',
							fontSize: '11px',
							border: 'none',
							cursor: 'pointer',
							borderLeft: '1px solid var(--lab-color-border)',
							fontFamily: 'var(--lab-font-sans)',
						}),
						activeView === 'graph'
							? pika({ background: 'var(--lab-color-accent)', color: '#fff', fontWeight: 'bold' })
							: pika({ background: 'transparent', color: 'var(--lab-color-text)' }),
					]"
					@click="activateView('graph')"
					@keydown="onViewTabKeydown($event, 'graph')"
				>
					{{ i18n.t('Graph') }}
				</button>
			</div>

			<!-- Shared filter: Show absent references -->
			<label :class="pika({ display: 'flex', alignItems: 'center', gap: '4px', cursor: 'pointer' })">
				<input
					v-model="store.graphShowAbsent.value"
					type="checkbox"
				>
				{{ i18n.t('Show absent references') }}
			</label>

			<!-- Graph-only controls -->
			<template v-if="activeView === 'graph'">
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
					:class="pika({
						'padding': '3px 8px',
						'fontSize': '11px',
						'borderRadius': 'var(--lab-radius)',
						'border': '1px solid var(--lab-color-border)',
						'background': 'var(--lab-color-surface-alt)',
						'color': 'var(--lab-color-text)',
						'cursor': 'pointer',
						'$:disabled': { opacity: '0.5', cursor: 'not-allowed' },
					})"
					@click="onFitGraphClick"
				>
					{{ i18n.t('Fit graph') }}
				</button>
				<button
					type="button"
					:disabled="flow === null"
					:aria-label="i18n.t('Expand all')"
					:class="pika({
						'padding': '3px 8px',
						'fontSize': '11px',
						'borderRadius': 'var(--lab-radius)',
						'border': '1px solid var(--lab-color-border)',
						'background': 'var(--lab-color-surface-alt)',
						'color': 'var(--lab-color-text)',
						'cursor': 'pointer',
						'$:disabled': { opacity: '0.5', cursor: 'not-allowed' },
					})"
					@click="store.expandAllGraphClusters()"
				>
					{{ i18n.t('Expand all') }}
				</button>
				<button
					type="button"
					:disabled="flow === null"
					:aria-label="i18n.t('Collapse all')"
					:class="pika({
						'padding': '3px 8px',
						'fontSize': '11px',
						'borderRadius': 'var(--lab-radius)',
						'border': '1px solid var(--lab-color-border)',
						'background': 'var(--lab-color-surface-alt)',
						'color': 'var(--lab-color-text)',
						'cursor': 'pointer',
						'$:disabled': { opacity: '0.5', cursor: 'not-allowed' },
					})"
					@click="store.collapseAllGraphClusters()"
				>
					{{ i18n.t('Collapse all') }}
				</button>
				<GraphLegend />
				<span
					v-if="statusLabel"
					:class="pika({ marginLeft: 'auto' })"
				>{{ statusLabel }}</span>
			</template>
		</div>

		<!-- Main view area (v-show preserves Graph DOM state & zoom/pan across view switching) -->
		<div :class="pika({ flex: '1 1 auto', minHeight: '0', position: 'relative', display: 'flex', flexDirection: 'column' })">
			<!-- Graph View -->
			<div
				v-show="activeView === 'graph'"
				id="dependencies-view-panel-graph"
				role="tabpanel"
				aria-labelledby="dependencies-view-tab-graph"
				tabindex="0"
				class="dependencies-graph-view"
				:class="pika({ flex: '1 1 auto', minHeight: '0', position: 'relative', display: 'flex', flexDirection: 'column' })"
			>
				<div :class="pika({ flex: '1 1 auto', minHeight: '0', position: 'relative' })">
					<GraphCanvas
						v-if="flow !== null"
						ref="graphCanvas"
						:nodes="flow.nodes"
						:edges="flow.edges"
						:layoutVersion="layoutVersion"
						@nodeClick="onNodeClick"
						@edgeClick="onEdgeClick"
						@clusterClick="onClusterClick"
						@toggleCluster="onToggleCluster"
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

			<!-- Relations View -->
			<div
				v-show="activeView === 'relations'"
				id="dependencies-view-panel-relations"
				role="tabpanel"
				aria-labelledby="dependencies-view-tab-relations"
				tabindex="0"
				class="dependencies-relations-view"
				:class="pika({ flex: '1 1 auto', minHeight: '0', position: 'relative', display: 'flex', flexDirection: 'column' })"
			>
				<RelationsView
					:model="relationsModel"
					@selectMember="onSelectMember"
					@selectWidget="onSelectWidget"
				/>
			</div>
		</div>
	</div>
</template>
