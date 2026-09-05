<script setup lang="ts">
/**
 * The readonly Vue Flow canvas (diagnostic #13 Phase 5 "Dependency Graph implementation stack" comment).
 * Viewer-only: pan/zoom/fit and readonly node/edge selection — nodes are never draggable/connectable and
 * no edge is updatable, so this component can never produce graph editing, edge creation/deletion, or
 * reparenting. The only place in this app that imports `@vue-flow/core` (and its required base
 * stylesheet); theming beyond that structural stylesheet comes from PikaCSS tokens, not Vue Flow's own
 * default theme CSS.
 *
 * Viewport fit & progressive disclosure:
 * Viewport fit coordinates with both layout readiness and element visibility (via ResizeObserver).
 * Inactive Dockview tabs mount with 0 dimensions; ResizeObserver performs the initial fit as soon as
 * the panel acquires non-zero dimensions. Automatic fit also runs when layoutVersion increments
 * (semantic graph replacement or hierarchy view changes), while avoiding refitting on unrelated
 * Runtime activity or focus deemphasis.
 */
import type { NodeMouseEvent } from '@vue-flow/core'
import type { GraphFlowEdge, GraphFlowNode } from '../../graph/vue-flow'
import { Handle, Position, useVueFlow, VueFlow } from '@vue-flow/core'
import { nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useLabI18n } from '../../composables/use-lab-i18n'
import '@vue-flow/core/dist/style.css'

const props = defineProps<{
	nodes: GraphFlowNode[]
	edges: GraphFlowEdge[]
	layoutVersion?: number
}>()

const emit = defineEmits<{
	nodeClick: [nodeId: string]
	edgeClick: [edgeId: string]
	clusterClick: [clusterId: string]
	toggleCluster: [clusterId: string]
}>()

const i18n = useLabI18n()
const vueFlowContainer = ref<HTMLElement | null>(null)
const { fitView, getNodes, onNodesChange, onNodesInitialized } = useVueFlow()

let fitted = false
let resizeObserver: ResizeObserver | null = null

function areCurrentNodesMeasured(): boolean {
	if (props.nodes.length === 0)
		return false

	const internalNodes = getNodes.value
	if (internalNodes.length !== props.nodes.length)
		return false
	if (!internalNodes || internalNodes.length === 0)
		return false

	const internalMap = new Map<string, (typeof internalNodes)[number]>()
	for (const node of internalNodes) {
		internalMap.set(node.id, node)
	}

	for (const expected of props.nodes) {
		const internal = internalMap.get(expected.id)
		if (!internal)
			return false
		const dimensions = internal.dimensions
		if (!dimensions || dimensions.width <= 0 || dimensions.height <= 0)
			return false
	}

	return true
}

async function attemptFit(): Promise<boolean> {
	if (fitted)
		return true
	const el = vueFlowContainer.value
	if (!el || el.clientWidth === 0 || el.clientHeight === 0)
		return false

	if (!areCurrentNodesMeasured())
		return false

	await nextTick()
	if (!areCurrentNodesMeasured())
		return false

	const success = await fitView({ padding: 0.2 })
	if (success) {
		fitted = true
		return true
	}
	return false
}

function fitGraph(): void {
	void fitView({ padding: 0.2 })
}

onNodesInitialized(() => {
	void attemptFit()
})

onNodesChange(() => {
	if (!fitted)
		void attemptFit()
})

onMounted(() => {
	const el = vueFlowContainer.value
	if (el) {
		resizeObserver = new ResizeObserver(() => {
			if (!fitted)
				void attemptFit()
		})
		resizeObserver.observe(el)
	}
	void attemptFit()
})

onBeforeUnmount(() => {
	resizeObserver?.disconnect()
	resizeObserver = null
})

watch(() => props.layoutVersion, () => {
	fitted = false
	void nextTick(attemptFit)
})

defineExpose({ fitGraph })

function onNodeClick({ node }: NodeMouseEvent): void {
	if (node.type === 'cluster') {
		emit('clusterClick', node.id)
		return
	}
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
	<div
		ref="vueFlowContainer"
		:class="pika({ width: '100%', height: '100%', position: 'relative' })"
	>
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
			<template #node-cluster="{ data, id }">
				<div
					v-if="data.isExpanded"
					class="graph-node--cluster graph-node--cluster-expanded"
					:class="[
						pika({ width: '100%', height: '100%', boxSizing: 'border-box', border: '1px dashed var(--lab-color-border)', borderRadius: 'var(--lab-radius)', background: 'color-mix(in srgb, var(--lab-color-surface) 40%, transparent)', position: 'relative' }),
						data.isDimmed && 'graph-node--dimmed',
						data.isFocused && 'graph-node--focused',
					]"
				>
					<div :class="pika({ position: 'absolute', top: '4px', left: '8px', right: '8px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' })">
						<span
							:class="pika({ fontSize: '10px', fontFamily: 'var(--lab-font-mono)', color: 'var(--lab-color-text-muted)', cursor: 'pointer' })"
							@click.stop="emit('clusterClick', id)"
						>{{ data.label }}</span>
						<button
							type="button"
							:aria-label="i18n.t('Collapse')"
							:class="pika({ padding: '1px 6px', fontSize: '10px', fontWeight: 'bold', fontFamily: 'var(--lab-font-mono)', borderRadius: 'var(--lab-radius)', border: '1px solid var(--lab-color-border)', background: 'var(--lab-color-surface)', color: 'var(--lab-color-text-muted)', cursor: 'pointer' })"
							@click.stop="emit('toggleCluster', id)"
						>
							−
						</button>
					</div>
				</div>
				<div
					v-else
					class="graph-node--cluster graph-node--cluster-collapsed"
					:class="[
						pika({ width: '100%', height: '100%', boxSizing: 'border-box', display: 'flex', flexDirection: 'column', justifyContent: 'center', gap: '3px', padding: '6px 10px', borderRadius: 'var(--lab-radius)', background: 'var(--lab-color-surface)', cursor: 'pointer', border: '1.5px solid var(--lab-color-border)' }),
						data.isDimmed && 'graph-node--dimmed',
						data.isFocused && 'graph-node--focused',
					]"
					:style="{ borderColor: data.hasInvalidCycle ? 'var(--lab-color-danger)' : undefined }"
					@click="emit('clusterClick', id)"
				>
					<div :class="pika({ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '6px' })">
						<span :class="pika({ fontSize: '11px', fontWeight: 'bold', fontFamily: 'var(--lab-font-mono)', color: 'var(--lab-color-text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' })">{{ data.widgetId }}</span>
						<button
							type="button"
							:aria-label="i18n.t('Expand')"
							:class="pika({ padding: '1px 6px', fontSize: '10px', fontWeight: 'bold', fontFamily: 'var(--lab-font-mono)', borderRadius: 'var(--lab-radius)', border: '1px solid var(--lab-color-border)', background: 'var(--lab-color-surface-alt)', color: 'var(--lab-color-text)', cursor: 'pointer' })"
							@click.stop="emit('toggleCluster', id)"
						>
							+
						</button>
					</div>
					<div :class="pika({ display: 'flex', alignItems: 'center', justifyContent: 'space-between', fontSize: '10px', color: 'var(--lab-color-text-muted)' })">
						<span :class="pika({ fontFamily: 'var(--lab-font-mono)' })">{{ data.widgetType }}</span>
						<span :class="pika({ fontSize: '9px', padding: '1px 5px', borderRadius: '999px', background: 'var(--lab-color-surface-alt)', flexShrink: '0' })">{{ data.memberCount }} members</span>
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
				</div>
			</template>

			<template #node-member="{ data }">
				<div
					class="graph-node--member"
					:class="[
						pika({ width: '100%', height: '100%', boxSizing: 'border-box', display: 'flex', alignItems: 'center', gap: '4px', padding: '0 8px', borderRadius: 'var(--lab-radius)', background: 'var(--lab-color-surface)', fontSize: '11px', fontFamily: 'var(--lab-font-mono)', color: 'var(--lab-color-text)', cursor: 'pointer' }),
						data.isDimmed && 'graph-node--dimmed',
						data.isFocused && 'graph-node--focused',
					]"
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
					class="graph-node--stub"
					:class="[
						pika({ width: '100%', height: '100%', boxSizing: 'border-box', display: 'flex', alignItems: 'center', justifyContent: 'center', borderRadius: 'var(--lab-radius)', background: 'var(--lab-color-surface)', fontSize: '10px', fontFamily: 'var(--lab-font-mono)' }),
						data.isDimmed && 'graph-node--dimmed',
					]"
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
	</div>
</template>

<style scoped>
:deep(.graph-node--dimmed) {
	opacity: 0.25;
	filter: grayscale(0.5);
	transition: opacity 0.2s, filter 0.2s;
}

:deep(.graph-node--focused) {
	box-shadow: 0 0 0 2px var(--lab-color-accent);
}

:deep(.graph-edge--dimmed) {
	opacity: 0.15;
	transition: opacity 0.2s;
}
</style>
