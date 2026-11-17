<script setup lang="ts">
/**
 * The readonly Vue Flow canvas (diagnostic #13 Phase 5 "Dependency Graph implementation stack" comment).
 * Viewer-only: pan/zoom/fit and readonly node/edge selection — nodes are never draggable/connectable and
 * no edge is updatable, so this component can never produce graph editing, edge creation/deletion, or
 * reparenting. The only place in this app that imports `@vue-flow/core` (and its required base
 * stylesheet); theming beyond that structural stylesheet comes from the Lab palette tokens, not Vue Flow's own
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

/**
 * Fit leaves 8% around the graph (it used to leave 20%, so a fitted graph used about 40% of the canvas: audit U11).
 * Everything is still in view afterwards; the text itself is 11px or more before the zoom.
 */
const FIT_OPTIONS = { padding: 0.08 } as const

const i18n = useLabI18n()
const vueFlowContainer = ref<HTMLElement | null>(null)
const { fitView, getNodes, onNodesChange, onNodesInitialized, zoomIn, zoomOut } = useVueFlow()

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

	const success = await fitView(FIT_OPTIONS)
	if (success) {
		fitted = true
		return true
	}
	return false
}

function fitGraph(): void {
	void fitView(FIT_OPTIONS)
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

/** Keyboard route to zooming (the wheel and pinch already zoom): a fitted large graph is read by zooming in. */
function zoomGraph(direction: 'in' | 'out'): void {
	void (direction === 'in' ? zoomIn() : zoomOut())
}

defineExpose({ fitGraph, zoomGraph })

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
		class="graph-canvas-surface w-full h-full relative"
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
			class="graph-canvas-flow w-full h-full"
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
						<span class="graph-cluster-meta">{{ data.memberCount }} {{ i18n.t('members') }}</span>
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
						:title="i18n.t('invalid cycle')"
					>! {{ i18n.t('cycle') }}</span>
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
						<button
							type="button"
							class="graph-cluster-identity graph-cluster-identity--collapsed"
							:aria-label="`${data.widgetType} #${data.widgetId}`"
							@click.stop="emit('clusterClick', id)"
						>
							<span
								class="graph-cluster-type"
								:title="data.widgetType"
							>{{ data.widgetType }}</span>
							<span
								class="graph-cluster-id"
								:title="data.widgetId"
							>#{{ data.widgetId }}</span>
						</button>
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
					<div
						class="graph-cluster-counts"
						role="group"
						:aria-label="i18n.t('Member counts')"
					>
						<span
							v-if="data.memberCounts?.state"
							class="graph-kind-count graph-kind-count--state"
							:title="i18n.t('State members')"
						>S {{ data.memberCounts.state }}</span>
						<span
							v-if="data.memberCounts?.property"
							class="graph-kind-count graph-kind-count--property"
							:title="i18n.t('Property members')"
						>P {{ data.memberCounts.property }}</span>
						<span
							v-if="data.memberCounts?.method"
							class="graph-kind-count graph-kind-count--method"
							:title="i18n.t('Method members')"
						>M {{ data.memberCounts.method }}</span>
						<span
							v-if="data.hasInvalidCycle"
							class="graph-cluster-alert"
							:title="i18n.t('invalid cycle')"
						>! {{ i18n.t('cycle') }}</span>
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

			<template #node-member="{ data, id }">
				<div
					class="graph-node--member graph-member-card"
					role="button"
					tabindex="0"
					:aria-label="`${data.kind} ${data.label}`"
					:class="[
						`graph-member-card--${data.kind}`,
						data.invalidCycle && 'graph-member-card--invalid',
						data.isDimmed && 'graph-node--dimmed',
						data.isFocused && 'graph-node--focused',
					]"
					@keydown.enter.prevent.stop="emit('nodeClick', id)"
					@keydown.space.prevent.stop="emit('nodeClick', id)"
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
						role="img"
						:aria-label="i18n.t('Writes State directly or through the Methods it invokes')"
						:title="i18n.t('Writes State directly or through the Methods it invokes')"
					>W</span>
					<span
						v-if="data.transitivelyEmits"
						class="graph-member-flag"
						role="img"
						:aria-label="i18n.t('Emits an Event directly or through the Methods it invokes')"
						:title="i18n.t('Emits an Event directly or through the Methods it invokes')"
					>E</span>
					<span
						v-if="data.invalidCycle"
						class="graph-member-flag graph-member-flag--danger"
						role="img"
						:aria-label="i18n.t('invalid cycle')"
						:title="i18n.t('invalid cycle')"
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
	height: 40px;
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
	align-items: flex-start;
	justify-content: space-between;
	gap: 8px;
	min-width: 0;
}

.graph-cluster-identity--collapsed {
	flex-direction: column;
	align-items: flex-start;
	gap: 1px;
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
	font-size: 11px;
	color: var(--lab-color-text-muted);
}

.graph-cluster-meta {
	flex-shrink: 0;
	font-size: 11px;
	color: var(--lab-color-text-muted);
}

.graph-cluster-counts {
	display: flex;
	align-items: center;
	gap: 4px;
	min-height: 20px;
	margin-top: auto;
}

.graph-kind-count {
	display: inline-flex;
	align-items: center;
	min-width: 28px;
	height: 20px;
	padding: 0 6px;
	border: 1px solid color-mix(in srgb, var(--graph-kind-color) 42%, var(--lab-color-border));
	border-radius: 999px;
	background: color-mix(in srgb, var(--graph-kind-color) 8%, var(--lab-color-surface));
	color: color-mix(in srgb, var(--graph-kind-color) 72%, var(--lab-color-text));
	font-size: 11px;
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
	width: 24px;
	height: 24px;
	flex: 0 0 24px;
	display: inline-grid;
	place-items: center;
	padding: 0;
	border: 1px solid var(--lab-color-border);
	border-radius: 6px;
	background: color-mix(in srgb, var(--lab-color-surface) 88%, transparent);
	color: var(--lab-color-text-muted);
	font-family: var(--lab-font-mono);
	font-size: 15px;
	font-weight: 700;
	line-height: 1;
	cursor: pointer;
	transition: color 120ms ease, border-color 120ms ease, background 120ms ease;
}

.graph-cluster-toggle:hover {
	border-color: color-mix(in srgb, var(--lab-color-accent) 58%, var(--lab-color-border));
	background: color-mix(in srgb, var(--lab-color-accent) 8%, var(--lab-color-surface));
	color: var(--lab-color-accent);
}

/* Audit U20: a visible keyboard focus ring on every Graph control, not only a tint. */
.graph-cluster-toggle:focus-visible,
.graph-cluster-identity:focus-visible {
	outline: 2px solid var(--lab-color-accent);
	outline-offset: 2px;
}

/* A 24px target; the collapsed card keeps its own stacked, left-aligned identity. */
.graph-cluster-identity {
	min-height: 24px;
}

.graph-cluster-identity:not(.graph-cluster-identity--collapsed) {
	align-items: center;
}

.graph-cluster-alert {
	flex-shrink: 0;
	font-size: 11px;
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
	font-size: 12px;
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

.graph-member-card:focus-visible {
	outline: 2px solid var(--lab-color-accent);
	outline-offset: 2px;
}

.graph-member-card--invalid {
	--graph-kind-color: var(--lab-color-danger);
}

.graph-member-kind {
	width: 20px;
	height: 20px;
	flex: 0 0 20px;
	display: inline-grid;
	place-items: center;
	border: 1px solid color-mix(in srgb, var(--graph-kind-color) 42%, var(--lab-color-border));
	border-radius: 5px;
	background: color-mix(in srgb, var(--graph-kind-color) 8%, var(--lab-color-surface-alt));
	color: color-mix(in srgb, var(--graph-kind-color) 78%, var(--lab-color-text));
	font-size: 11px;
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
	min-width: 20px;
	height: 20px;
	padding: 0 4px;
	border-radius: 999px;
	background: color-mix(in srgb, var(--lab-color-warning) 10%, transparent);
	color: var(--lab-color-warning);
	font-size: 11px;
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
	font-size: 11px;
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

/*
 * Edge labels (audit U11). Labels of neighbouring edges ran into each other ("1 dep-deps"), so a label is shown only
 * for the edge that is hovered or selected. The kind of edge stays readable without it: the stroke is solid,
 * bold or dashed (see the key above the canvas and the Legend), and the label is part of the edge's accessible name.
 * 11px is the smallest text anywhere in the Lab.
 */
:deep(.vue-flow__edge-text) {
	fill: var(--lab-color-text);
	font-family: var(--lab-font-mono);
	font-size: 11px;
	font-weight: 700;
}

:deep(.vue-flow__edge-textbg) {
	fill: var(--lab-color-surface);
	stroke: var(--lab-color-border);
	stroke-width: 0.6px;
	fill-opacity: 0.97;
}

:deep(.graph-edge .vue-flow__edge-text),
:deep(.graph-edge .vue-flow__edge-textbg) {
	opacity: 0;
	transition: opacity 120ms ease;
}

:deep(.graph-edge:hover .vue-flow__edge-text),
:deep(.graph-edge:hover .vue-flow__edge-textbg),
:deep(.graph-edge.selected .vue-flow__edge-text),
:deep(.graph-edge.selected .vue-flow__edge-textbg) {
	opacity: 1;
}

/*
 * Audit U20: a node reached with the keyboard gets a visible ring. Edges are not part of the Tab order: Vue Flow writes
 * their `tabIndex` attribute with a capital I, which an SVG element ignores, so they never take focus (the Relations view is the
 * keyboard route to the same facts).
 */
:deep(.vue-flow__node:focus-visible) {
	outline: 2px solid var(--lab-color-accent);
	outline-offset: 2px;
	border-radius: var(--lab-radius);
}
</style>
