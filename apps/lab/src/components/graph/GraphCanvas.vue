<script setup lang="ts">
/**
 * The readonly Vue Flow canvas (issue #13 Phase 5 "Dependency Graph implementation stack" comment).
 * Viewer-only: pan/zoom/fit and readonly node/edge selection — nodes are never draggable/connectable and
 * no edge is updatable, so this component can never produce graph editing, edge creation/deletion, or
 * reparenting. The only place in this app that imports `@vue-flow/core` (and its required base
 * stylesheet); theming beyond that structural stylesheet comes from PikaCSS tokens, not Vue Flow's own
 * default theme CSS.
 */
import type { NodeMouseEvent } from '@vue-flow/core'
import type { GraphFlowEdge, GraphFlowNode } from '../../graph/vue-flow'
import { Handle, Position, VueFlow } from '@vue-flow/core'
import '@vue-flow/core/dist/style.css'

defineProps<{
	nodes: GraphFlowNode[]
	edges: GraphFlowEdge[]
}>()

const emit = defineEmits<{
	nodeClick: [nodeId: string]
	edgeClick: [edgeId: string]
}>()

function onNodeClick({ node }: NodeMouseEvent): void {
	if (node.type === 'cluster')
		return
	emit('nodeClick', node.id)
}

function onEdgeClick({ edge }: { edge: GraphFlowEdge }): void {
	emit('edgeClick', edge.id)
}

function memberBorderColor(kind: string, invalidCycle: boolean | undefined): string {
	if (invalidCycle)
		return 'var(--lab-color-danger)'
	if (kind === 'state')
		return 'var(--lab-color-success)'
	if (kind === 'method')
		return 'var(--lab-color-accent)'
	return 'var(--lab-color-warning)'
}
</script>

<template>
	<VueFlow
		:nodes="nodes"
		:edges="edges"
		:nodesDraggable="false"
		:nodesConnectable="false"
		:edgesUpdatable="false"
		:elementsSelectable="true"
		:zoomOnDoubleClick="false"
		:minZoom="0.1"
		fitViewOnInit
		:class="pika({ width: '100%', height: '100%' })"
		@nodeClick="onNodeClick"
		@edgeClick="onEdgeClick"
	>
		<template #node-cluster="{ data }">
			<div
				:class="pika({ width: '100%', height: '100%', boxSizing: 'border-box', border: '1px dashed var(--lab-color-border)', borderRadius: 'var(--lab-radius)', background: 'color-mix(in srgb, var(--lab-color-surface) 40%, transparent)' })"
			>
				<span
					:class="pika({ position: 'absolute', top: '4px', left: '8px', fontSize: '10px', fontFamily: 'var(--lab-font-mono)', color: 'var(--lab-color-text-muted)' })"
				>{{ data.label }}</span>
			</div>
		</template>

		<template #node-member="{ data }">
			<div
				:class="pika({ width: '100%', height: '100%', boxSizing: 'border-box', display: 'flex', alignItems: 'center', gap: '4px', padding: '0 8px', borderRadius: 'var(--lab-radius)', background: 'var(--lab-color-surface)', fontSize: '11px', fontFamily: 'var(--lab-font-mono)', color: 'var(--lab-color-text)', cursor: 'pointer' })"
				:style="{ border: `1.5px solid ${memberBorderColor(data.kind, data.invalidCycle)}` }"
			>
				<span :class="pika({ fontSize: '9px', color: 'var(--lab-color-text-muted)', textTransform: 'uppercase' })">{{ data.kind }}</span>
				<span :class="pika({ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' })">{{ data.label }}</span>
				<span
					v-if="data.transitivelyWrites"
					:class="pika({ marginLeft: 'auto', fontSize: '9px', color: 'var(--lab-color-warning)' })"
					title="transitivelyWrites"
				>W</span>
			</div>
			<Handle
				id="t"
				type="target"
				:position="Position.Top"
			/>
			<Handle
				id="b"
				type="source"
				:position="Position.Bottom"
			/>
		</template>

		<template #node-stub="{ data }">
			<div
				:class="pika({ width: '100%', height: '100%', boxSizing: 'border-box', display: 'flex', alignItems: 'center', justifyContent: 'center', borderRadius: '999px', fontSize: '10px', fontFamily: 'var(--lab-font-mono)' })"
				:style="{
					border: `1px dashed ${data.stubStatus === 'invalid' ? 'var(--lab-color-danger)' : 'var(--lab-color-text-muted)'}`,
					color: data.stubStatus === 'invalid' ? 'var(--lab-color-danger)' : 'var(--lab-color-text-muted)',
				}"
			>
				{{ data.label }}
			</div>
			<Handle
				id="t"
				type="target"
				:position="Position.Top"
			/>
		</template>
	</VueFlow>
</template>
