<script setup lang="ts">
/**
 * The readonly Vue Flow canvas (diagnostic #13 Phase 5 "Dependency Graph implementation stack" comment).
 * Viewer-only: pan/zoom/fit and readonly node/edge selection — nodes are never draggable/connectable and
 * no edge is updatable, so this component can never produce graph editing, edge creation/deletion, or
 * reparenting. The only place in this app that imports `@vue-flow/core` (and its required base
 * stylesheet); theming beyond that structural stylesheet comes from PikaCSS tokens, not Vue Flow's own
 * default theme CSS.
 *
 * Viewport fit (diagnostic #27 Finding 1): `useVueFlow()` called here — before this component's own
 * template renders `<VueFlow>` — creates a store and provides it via Vue's `provide()`, which `<VueFlow>`
 * then injects instead of creating its own (this is `@vue-flow/core`'s documented same-component-instance
 * pattern; see `useVueFlow.d.ts`'s doc comment). That gives this component `fitView` and
 * `onNodesInitialized` for the *same* flow instance its own template renders.
 *
 * `GraphPanel.vue` renders this component behind `v-if="flow !== null"`, and every distinct laid-out
 * semantic graph transits through `flow === null` first (`LayoutSession.request()` sets `status:
 * 'loading'` synchronously — see `layout-session.ts`) before the next `flow` object appears, so this
 * component fully unmounts and remounts for every new graph, never just receives new `nodes`/`edges`
 * props in place. `onNodesInitialized` therefore fires exactly once per mount, after Vue Flow has
 * measured real node dimensions — a reliable readiness boundary `fitViewOnInit` alone is not, because it
 * fires from `<VueFlow>`'s own mount, which can race ahead of that measurement. Fitting there (rather than
 * relying on `fitViewOnInit`) satisfies the policy "first valid laid-out graph shown in a panel -> fit"
 * and "a new semantic graph -> fit the new graph" for both the very first mount and every subsequent
 * remount, without needing to special-case either. `fitGraph()` is exposed for the panel's explicit
 * **Fit graph** button — same `fitView` call, no separate mechanism.
 */
import type { NodeMouseEvent } from '@vue-flow/core'
import type { GraphFlowEdge, GraphFlowNode } from '../../graph/vue-flow'
import { Handle, Position, useVueFlow, VueFlow } from '@vue-flow/core'
import '@vue-flow/core/dist/style.css'

defineProps<{
	nodes: GraphFlowNode[]
	edges: GraphFlowEdge[]
}>()

const emit = defineEmits<{
	nodeClick: [nodeId: string]
	edgeClick: [edgeId: string]
}>()

const { fitView, onNodesInitialized } = useVueFlow()

function fitGraph(): void {
	void fitView({ padding: 0.2 })
}

onNodesInitialized(fitGraph)

defineExpose({ fitGraph })

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
		return 'var(--lab-color-ok)'
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
