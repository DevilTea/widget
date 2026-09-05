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

function memberKindShort(kind: string): string {
	if (kind === 'state')
		return 'S'
	if (kind === 'property')
		return 'P'
	if (kind === 'method')
		return 'M'
	return '?'
}
</script>

<template>
	<div
		ref="vueFlowContainer"
		class="graph-canvas-surface"
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
			class="graph-canvas-flow"
			:class="pika({ width: '100%', height: '100%' })"
			@nodeClick="onNodeClick"
			@edgeClick="onEdgeClick"
		>
			<template #node-cluster="{ data, id }">
				<div
					v-if="data.isExpanded"
					class="graph-node--cluster graph-cluster-card graph-cluster-card--expanded"
					:class="{
						'graph-node--dimmed': data.isDimmed,
						'graph-node--focused': data.isFocused,
						'graph-cluster-card--invalid': data.hasInvalidCycle,
					}"
				>
					<div class="graph-cluster-header">
						<button
							type="button"
							class="graph-cluster-identity"
							:aria-label="`${data.widgetType} #${data.widgetId}`"
							@click.stop="emit('clusterClick', id)"
						>
							<span class="graph-cluster-type">{{ data.widgetType }}</span>
							<span class="graph-cluster-id">#{{ data.widgetId }}</span>
						</button>
						<span class="graph-cluster-meta">{{ data.memberCount }} members</span>
						<button
							type="button"
							class="graph-cluster-toggle"
							:aria-label="i18n.t('Collapse')"
							:title="i18n.t('Collapse')"
							@click.stop="emit('toggleCluster', id)"
						>
							<span aria-hidden="true">−</span>
						</button>
					</div>
					<span
						v-if="data.hasInvalidCycle"
						class="graph-cluster-alert"
						title="invalid cycle"
					>! cycle</span>
				</div>

				<div
					v-else
					class="graph-node--cluster graph-cluster-card graph-cluster-card--collapsed"
					:class="{
						'graph-node--dimmed': data.isDimmed,
						'graph-node--focused': data.isFocused,
						'graph-cluster-card--invalid': data.hasInvalidCycle,
					}"
				>
					<div class="graph-cluster-card-topline">
						<span
							class="graph-cluster-type"
							:title="data.widgetType"
						>{{ data.widgetType }}</span>
						<button
							type="button"
							class="graph-cluster-toggle"
							:aria-label="i18n.t('Expand')"
							:title="i18n.t('Expand')"
							@click.stop="emit('toggleCluster', id)"
						>
							<span aria-hidden="true">+</span>
						</button>
					</div>
					<span
						class="graph-cluster-id"
						:title="data.widgetId"
					>#{{ data.widgetId }}</span>
					<div
						class="graph-cluster-counts"
						aria-label="member counts"
					>
						<span
							v-if="data.memberCounts?.state"
							class="graph-kind-count graph-kind-count--state"
							title="State members"
						>S {{ data.memberCounts.state }}</span>
						<span
							v-if="data.memberCounts?.property"
							class="graph-kind-count graph-kind-count--property"
							title="Property members"
						>P {{ data.memberCounts.property }}</span>
						<span
							v-if="data.memberCounts?.method"
							class="graph-kind-count graph-kind-count--method"
							title="Method members"
						>M {{ data.memberCounts.method }}</span>
						<span
							v-if="data.hasInvalidCycle"
							class="graph-cluster-alert"
							title="invalid cycle"
						>! cycle</span>
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
					class="graph-node--member graph-member-card"
					:class="[
						`graph-member-card--${data.kind}`,
						data.invalidCycle && 'graph-member-card--invalid',
						data.isDimmed && 'graph-node--dimmed',
						data.isFocused && 'graph-node--focused',
					]"
				>
					<span
						class="graph-member-kind"
						:title="data.kind"
					>{{ memberKindShort(data.kind) }}</span>
					<span
						class="graph-member-label"
						:title="data.label"
					>{{ data.label }}</span>
					<span
						v-if="data.transitivelyWrites"
						class="graph-member-flag"
						title="transitivelyWrites"
					>W</span>
					<span
						v-if="data.invalidCycle"
						class="graph-member-flag graph-member-flag--danger"
						aria-label="invalid cycle"
						title="invalid cycle"
					>!</span>
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
					class="graph-node--stub graph-stub-card"
					:class="[
						`graph-stub-card--${data.stubStatus}`,
						data.isDimmed && 'graph-node--dimmed',
					]"
				>
					<span aria-hidden="true">?</span>
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
.graph-canvas-surface {
	background-color: var(--lab-color-surface-alt);
	background-image: radial-gradient(color-mix(in srgb, var(--lab-color-border) 62%, transparent) 0.7px, transparent 0.7px);
	background-size: 18px 18px;
}

.graph-cluster-card {
	width: 100%;
	height: 100%;
	box-sizing: border-box;
	position: relative;
	border: 1px solid var(--lab-color-border);
	border-radius: calc(var(--lab-radius) + 2px);
	background: color-mix(in srgb, var(--lab-color-surface) 96%, transparent);
	color: var(--lab-color-text);
	font-family: var(--lab-font-mono);
	transition: border-color 140ms ease, box-shadow 140ms ease, opacity 160ms ease;
}

.graph-cluster-card--collapsed {
	display: flex;
	flex-direction: column;
	gap: 3px;
	padding: 8px 10px;
	box-shadow: 0 2px 8px color-mix(in srgb, var(--lab-color-text) 7%, transparent);
}

.graph-cluster-card--collapsed:hover {
	border-color: color-mix(in srgb, var(--lab-color-accent) 50%, var(--lab-color-border));
	box-shadow: 0 5px 16px color-mix(in srgb, var(--lab-color-text) 10%, transparent);
}

.graph-cluster-card--expanded {
	border-color: color-mix(in srgb, var(--lab-color-border) 84%, var(--lab-color-text-muted));
	background: color-mix(in srgb, var(--lab-color-surface) 72%, transparent);
	box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--lab-color-surface-alt) 65%, transparent);
}

.graph-cluster-card--invalid {
	border-color: color-mix(in srgb, var(--lab-color-danger) 72%, var(--lab-color-border));
}

.graph-cluster-header {
	position: absolute;
	top: 0;
	left: 0;
	right: 0;
	height: 38px;
	display: flex;
	align-items: center;
	gap: 7px;
	padding: 0 8px 0 10px;
	border-bottom: 1px solid color-mix(in srgb, var(--lab-color-border) 78%, transparent);
	background: color-mix(in srgb, var(--lab-color-surface-alt) 80%, transparent);
	border-radius: calc(var(--lab-radius) + 1px) calc(var(--lab-radius) + 1px) 0 0;
}

.graph-cluster-identity {
	min-width: 0;
	flex: 1;
	display: flex;
	align-items: baseline;
	gap: 6px;
	padding: 0;
	border: 0;
	background: transparent;
	color: inherit;
	font: inherit;
	text-align: left;
	cursor: pointer;
}

.graph-cluster-card-topline {
	display: flex;
	align-items: center;
	justify-content: space-between;
	gap: 8px;
	min-width: 0;
}

.graph-cluster-type {
	min-width: 0;
	overflow: hidden;
	text-overflow: ellipsis;
	white-space: nowrap;
	font-size: 12px;
	font-weight: 650;
	letter-spacing: -0.01em;
	color: var(--lab-color-text);
}

.graph-cluster-id {
	min-width: 0;
	overflow: hidden;
	text-overflow: ellipsis;
	white-space: nowrap;
	font-size: 9px;
	color: var(--lab-color-text-muted);
}

.graph-cluster-meta {
	flex-shrink: 0;
	font-size: 9px;
	color: var(--lab-color-text-muted);
}

.graph-cluster-counts {
	display: flex;
	align-items: center;
	gap: 4px;
	min-height: 18px;
	margin-top: auto;
}

.graph-kind-count {
	display: inline-flex;
	align-items: center;
	min-width: 22px;
	height: 16px;
	padding: 0 5px;
	border: 1px solid color-mix(in srgb, var(--graph-kind-color) 42%, var(--lab-color-border));
	border-radius: 999px;
	background: color-mix(in srgb, var(--graph-kind-color) 8%, var(--lab-color-surface));
	color: color-mix(in srgb, var(--graph-kind-color) 72%, var(--lab-color-text));
	font-size: 8px;
	font-weight: 700;
	line-height: 1;
}

.graph-kind-count--state,
.graph-member-card--state {
	--graph-kind-color: var(--lab-color-ok);
}

.graph-kind-count--property,
.graph-member-card--property {
	--graph-kind-color: var(--lab-color-warning);
}

.graph-kind-count--method,
.graph-member-card--method {
	--graph-kind-color: var(--lab-color-accent);
}

.graph-cluster-toggle {
	width: 21px;
	height: 21px;
	flex: 0 0 21px;
	display: inline-grid;
	place-items: center;
	padding: 0;
	border: 1px solid var(--lab-color-border);
	border-radius: 6px;
	background: color-mix(in srgb, var(--lab-color-surface) 88%, transparent);
	color: var(--lab-color-text-muted);
	font-family: var(--lab-font-mono);
	font-size: 13px;
	font-weight: 700;
	line-height: 1;
	cursor: pointer;
	transition: color 120ms ease, border-color 120ms ease, background 120ms ease;
}

.graph-cluster-toggle:hover,
.graph-cluster-toggle:focus-visible {
	border-color: color-mix(in srgb, var(--lab-color-accent) 58%, var(--lab-color-border));
	background: color-mix(in srgb, var(--lab-color-accent) 8%, var(--lab-color-surface));
	color: var(--lab-color-accent);
	outline: none;
}

.graph-cluster-alert {
	flex-shrink: 0;
	font-size: 8px;
	font-weight: 700;
	color: var(--lab-color-danger);
	text-transform: uppercase;
	letter-spacing: 0.03em;
}

.graph-cluster-card--expanded > .graph-cluster-alert {
	position: absolute;
	top: 41px;
	right: 8px;
}

.graph-member-card {
	--graph-kind-color: var(--lab-color-text-muted);
	width: 100%;
	height: 100%;
	box-sizing: border-box;
	display: flex;
	align-items: center;
	gap: 6px;
	padding: 0 8px 0 6px;
	border: 1px solid var(--lab-color-border);
	border-left: 3px solid var(--graph-kind-color);
	border-radius: var(--lab-radius);
	background: var(--lab-color-surface);
	color: var(--lab-color-text);
	font-family: var(--lab-font-mono);
	font-size: 10px;
	cursor: pointer;
	box-shadow: 0 1px 3px color-mix(in srgb, var(--lab-color-text) 6%, transparent);
	transition: border-color 120ms ease, box-shadow 120ms ease, opacity 160ms ease;
}

.graph-member-card:hover {
	border-top-color: color-mix(in srgb, var(--graph-kind-color) 38%, var(--lab-color-border));
	border-right-color: color-mix(in srgb, var(--graph-kind-color) 38%, var(--lab-color-border));
	border-bottom-color: color-mix(in srgb, var(--graph-kind-color) 38%, var(--lab-color-border));
	box-shadow: 0 3px 8px color-mix(in srgb, var(--lab-color-text) 9%, transparent);
}

.graph-member-card--invalid {
	--graph-kind-color: var(--lab-color-danger);
}

.graph-member-kind {
	width: 17px;
	height: 17px;
	flex: 0 0 17px;
	display: inline-grid;
	place-items: center;
	border: 1px solid color-mix(in srgb, var(--graph-kind-color) 42%, var(--lab-color-border));
	border-radius: 5px;
	background: color-mix(in srgb, var(--graph-kind-color) 8%, var(--lab-color-surface-alt));
	color: color-mix(in srgb, var(--graph-kind-color) 78%, var(--lab-color-text));
	font-size: 8px;
	font-weight: 800;
}

.graph-member-label {
	min-width: 0;
	flex: 1;
	overflow: hidden;
	text-overflow: ellipsis;
	white-space: nowrap;
}

.graph-member-flag {
	flex-shrink: 0;
	display: inline-grid;
	place-items: center;
	min-width: 15px;
	height: 15px;
	padding: 0 3px;
	border-radius: 999px;
	background: color-mix(in srgb, var(--lab-color-warning) 10%, transparent);
	color: var(--lab-color-warning);
	font-size: 8px;
	font-weight: 800;
}

.graph-member-flag--danger {
	background: color-mix(in srgb, var(--lab-color-danger) 10%, transparent);
	color: var(--lab-color-danger);
}

.graph-stub-card {
	width: 100%;
	height: 100%;
	box-sizing: border-box;
	display: flex;
	align-items: center;
	justify-content: center;
	gap: 4px;
	border: 1px dashed var(--lab-color-text-muted);
	border-radius: 999px;
	background: color-mix(in srgb, var(--lab-color-surface) 80%, transparent);
	color: var(--lab-color-text-muted);
	font-family: var(--lab-font-mono);
	font-size: 9px;
}

.graph-stub-card--invalid {
	border-color: var(--lab-color-danger);
	color: var(--lab-color-danger);
}

.graph-node--dimmed {
	opacity: 0.16;
	filter: saturate(0.45);
	transition: opacity 160ms ease, filter 160ms ease;
}

.graph-node--focused {
	box-shadow: 0 0 0 2px color-mix(in srgb, var(--lab-color-accent) 76%, transparent), 0 7px 20px color-mix(in srgb, var(--lab-color-accent) 16%, transparent);
}

:deep(.vue-flow__handle) {
	width: 5px;
	height: 5px;
	border: 1px solid var(--lab-color-surface);
	background: var(--lab-color-text-muted);
	opacity: 0.14;
	transition: opacity 120ms ease;
}

:deep(.vue-flow__node:hover .vue-flow__handle),
:deep(.vue-flow__node.selected .vue-flow__handle) {
	opacity: 0.5;
}

:deep(.graph-edge) {
	transition: opacity 160ms ease;
}

:deep(.graph-edge .vue-flow__edge-path) {
	stroke: color-mix(in srgb, var(--lab-color-text-muted) 68%, transparent);
	stroke-width: 1.25;
	transition: stroke 120ms ease, stroke-width 120ms ease, opacity 160ms ease;
}

:deep(.graph-edge--reads .vue-flow__edge-path) {
	stroke-width: 1.15;
}

:deep(.graph-edge--writes .vue-flow__edge-path) {
	stroke: color-mix(in srgb, var(--lab-color-warning) 76%, var(--lab-color-text-muted));
	stroke-width: 1.9;
}

:deep(.graph-edge--invokes .vue-flow__edge-path) {
	stroke: color-mix(in srgb, var(--lab-color-accent) 74%, var(--lab-color-text-muted));
	stroke-width: 1.45;
	stroke-dasharray: 6 4;
}

:deep(.graph-edge--stub .vue-flow__edge-path) {
	stroke-dasharray: 3 4;
	stroke-width: 1;
}

:deep(.graph-edge--invalid-cycle .vue-flow__edge-path) {
	stroke: var(--lab-color-danger);
	stroke-width: 2;
}

:deep(.graph-edge:hover .vue-flow__edge-path),
:deep(.graph-edge.selected .vue-flow__edge-path) {
	stroke-width: 2.4;
}

:deep(.graph-edge--dimmed) {
	opacity: 0.1;
}

:deep(.vue-flow__edge-text) {
	fill: var(--lab-color-text-muted);
	font-family: var(--lab-font-mono);
	font-size: 9px;
	font-weight: 600;
}

:deep(.vue-flow__edge-textbg) {
	fill: var(--lab-color-surface);
	fill-opacity: 0.86;
}

:deep(.graph-edge:not(.graph-edge--aggregate) .vue-flow__edge-text),
:deep(.graph-edge:not(.graph-edge--aggregate) .vue-flow__edge-textbg) {
	opacity: 0.46;
	transition: opacity 120ms ease;
}

:deep(.graph-edge:not(.graph-edge--aggregate):hover .vue-flow__edge-text),
:deep(.graph-edge:not(.graph-edge--aggregate):hover .vue-flow__edge-textbg),
:deep(.graph-edge:not(.graph-edge--aggregate).selected .vue-flow__edge-text),
:deep(.graph-edge:not(.graph-edge--aggregate).selected .vue-flow__edge-textbg) {
	opacity: 1;
}

:deep(.graph-edge--aggregate .vue-flow__edge-text) {
	fill: var(--lab-color-text);
	font-size: 9px;
	font-weight: 700;
}

:deep(.graph-edge--aggregate .vue-flow__edge-textbg) {
	fill: var(--lab-color-surface);
	stroke: var(--lab-color-border);
	stroke-width: 0.6px;
	fill-opacity: 0.96;
}
</style>
