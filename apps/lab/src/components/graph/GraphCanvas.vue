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
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useGraphTags } from '../../composables/use-graph-tags'
import { useLabI18n } from '../../composables/use-lab-i18n'
import { edgeKeyboardOrder, edgeNameParts, edgeTabStop, isEdgeNavigationKey, nextEdgeId } from '../../graph/edge-a11y'
import { tagSize } from '../../graph/tag-placement'
import { GRAPH_EDGE_TYPE } from '../../graph/vue-flow'
import { ARROW_KINDS, arrowMarkerId, ZOOM_BUCKETS, zoomBucket } from '../../graph/zoom-scale'
import GraphDependencyEdge from './GraphDependencyEdge.vue'
import '@vue-flow/core/dist/style.css'

const props = defineProps<{
	nodes: GraphFlowNode[]
	edges: GraphFlowEdge[]
	layoutVersion?: number
}>()

const emit = defineEmits<{
	nodeClick: [nodeId: string]
	edgeClick: [edgeId: string]
	edgeClear: []
	clusterClick: [clusterId: string]
	toggleCluster: [clusterId: string]
}>()

/**
 * Fit leaves 4% around the graph (it used to leave 20%, then 8%: a fitted graph used about 40% of the canvas, audit U11, and the
 * Survey's card text was under 11px on screen at 1280 x 800). Everything is still in view afterwards, curves included.
 */
const FIT_OPTIONS = { padding: 0.04 } as const

/** Fit may go this far out (the whole expanded Trip budget fits at about 0.06). */
const FIT_MIN_ZOOM = 0.05
/** Whatever Fit settled on, a person can zoom out to about a quarter of it, but never below this unless Fit itself is lower: a small graph is not wheeled down to a dot. */
const MANUAL_MIN_ZOOM = 0.1

const i18n = useLabI18n()
const vueFlowContainer = ref<HTMLElement | null>(null)
const { addSelectedEdges, findEdge, fitBounds, fitView, getNodes, getSelectedEdges, onNodesChange, onNodesInitialized, removeSelectedEdges, setMinZoom, viewport, zoomIn, zoomOut } = useVueFlow()

/**
 * The tags of the edges around the focus ("Depends on #sessions", "Used by #phone"), placed together so that none covers a card,
 * an arrowhead or another tag; one that does not fit is left out (see `graph/tag-placement.ts`). They are re-placed only when
 * the graph, the focus or the zoom bucket changes, not on every wheel tick or pan step (see `composables/use-graph-tags.ts`).
 * They are drawn in one layer above every edge and card (the `zoom-pane` slot of Vue Flow), so no edge is drawn across their text.
 */
const bucket = computed(() => zoomBucket(viewport.value.zoom))
const tagPlacements = useGraphTags({
	edges: () => props.edges,
	cards: () => getNodes.value
		.filter(node => !(node.type === 'cluster' && node.data.isExpanded === true))
		.map(node => ({ x: node.computedPosition.x, y: node.computedPosition.y, width: node.dimensions.width, height: node.dimensions.height })),
	zoom: () => viewport.value.zoom,
	text: (relation, name) => i18n.t(relation === 'depends-on' ? 'Depends on {name}' : 'Used by {name}', { name }),
})
function tagBox(tag: { x: number, y: number, text: string }): { x: number, y: number, width: number, height: number } {
	const { width, height } = tagSize(tag.text, bucket.value.font)
	return { x: tag.x - width / 2, y: tag.y - height / 2, width, height }
}
/** The tag of an edge gives way to the edge's own label while the edge is hovered or selected. */
const hoveredEdgeId = ref<string | null>(null)
/** The edge that has keyboard focus: it shows what a hovered edge shows. */
const focusedEdgeId = ref<string | null>(null)
const tagIsHidden = (edgeId: string): boolean => edgeId === hoveredEdgeId.value || edgeId === focusedEdgeId.value || getSelectedEdges.value.some(edge => edge.id === edgeId)

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

/**
 * Fits the cards and the curves between them. A long edge runs in a corridor ELK reserved beside the cards, so fitting only
 * the cards would cut those curves off at the edge of the canvas.
 */
async function fitContent(): Promise<boolean> {
	let minX = Infinity
	let minY = Infinity
	let maxX = -Infinity
	let maxY = -Infinity
	for (const node of getNodes.value) {
		minX = Math.min(minX, node.computedPosition.x)
		minY = Math.min(minY, node.computedPosition.y)
		maxX = Math.max(maxX, node.computedPosition.x + node.dimensions.width)
		maxY = Math.max(maxY, node.computedPosition.y + node.dimensions.height)
	}
	for (const edge of props.edges) {
		for (const point of edge.data?.route ?? []) {
			minX = Math.min(minX, point.x)
			minY = Math.min(minY, point.y)
			maxX = Math.max(maxX, point.x)
			maxY = Math.max(maxY, point.y)
		}
	}
	// Fit may reach far out; afterwards the manual zoom floor follows the zoom Fit settled on.
	setMinZoom(FIT_MIN_ZOOM)
	const success = Number.isFinite(minX)
		? await fitBounds({ x: minX, y: minY, width: maxX - minX, height: maxY - minY }, FIT_OPTIONS)
		: await fitView(FIT_OPTIONS)
	const fitZoom = viewport.value.zoom
	setMinZoom(Math.max(FIT_MIN_ZOOM, Math.min(fitZoom, Math.max(MANUAL_MIN_ZOOM, fitZoom * 0.25))))
	return success
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

	const success = await fitContent()
	if (success) {
		fitted = true
		return true
	}
	return false
}

function fitGraph(): void {
	void fitContent()
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

/**
 * Keyboard access to the edges (issue #230 follow-up; the pure part is `graph/edge-a11y.ts`).
 *
 * Vue Flow means its edges to be focusable, but writes `tabIndex` (capital I) on the edge's SVG `<g>`, which SVG ignores, and
 * binds its key handler as `onKeyDown`, which Vue turns into a listener for an event named `key-down` that never fires. Both are
 * repaired from outside, without a fork: every edge gets a real lowercase `tabindex` through Vue Flow's own `domAttributes`
 * escape hatch, and the keys are handled here, delegated on the canvas.
 *
 * The edges are one Tab stop (`tabindex="0"` on the first edge of the keyboard order, `-1` on the rest) and the arrow keys
 * move between them, so a graph with dozens of edges costs one Tab press. Enter or Space selects the edge as a click does
 * (which opens its details under the canvas), Escape clears the selection.
 */
const keyboardOrder = computed(() => edgeKeyboardOrder(props.edges))
const flowEdges = computed<GraphFlowEdge[]>(() => {
	const tabStop = edgeTabStop(props.edges)
	return props.edges.map(edge => ({
		...edge,
		ariaLabel: i18n.t('{label}: {source} → {target}', edgeNameParts(edge)),
		domAttributes: { tabindex: edge.id === tabStop ? 0 : -1 },
	}))
})

/** The id of the edge an event happened on, when its target is the edge element itself (not something inside or outside it). */
function edgeIdOfTarget(target: EventTarget | null): string | null {
	return target instanceof Element && target.classList.contains('vue-flow__edge') ? target.getAttribute('data-id') : null
}

function focusEdge(edgeId: string): void {
	for (const element of vueFlowContainer.value?.querySelectorAll<SVGGElement>('.vue-flow__edge') ?? []) {
		if (element.getAttribute('data-id') === edgeId) {
			element.focus()
			return
		}
	}
}

function onCanvasKeydown(event: KeyboardEvent): void {
	const edgeId = edgeIdOfTarget(event.target)
	if (edgeId === null || event.altKey || event.ctrlKey || event.metaKey)
		return
	if (event.key === 'Enter' || event.key === ' ') {
		event.preventDefault()
		const edge = findEdge(edgeId)
		if (edge !== undefined)
			addSelectedEdges([edge])
		emit('edgeClick', edgeId)
	}
	else if (event.key === 'Escape') {
		// Only an Escape that has something to clear is consumed, so it can still close whatever contains the Graph.
		if (getSelectedEdges.value.length === 0)
			return
		event.preventDefault()
		event.stopPropagation()
		removeSelectedEdges(getSelectedEdges.value)
		emit('edgeClear')
	}
	else if (isEdgeNavigationKey(event.key)) {
		const next = nextEdgeId(keyboardOrder.value, edgeId, event.key)
		if (next === null)
			return
		event.preventDefault()
		focusEdge(next)
	}
}

function onCanvasFocusin(event: FocusEvent): void {
	focusedEdgeId.value = edgeIdOfTarget(event.target)
}

function onCanvasFocusout(): void {
	focusedEdgeId.value = null
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
		@keydown="onCanvasKeydown"
		@focusin="onCanvasFocusin"
		@focusout="onCanvasFocusout"
	>
		<!--
			The arrowheads: one marker per colour family and zoom bucket (graph/zoom-scale.ts), a triangle whose tip is the end of the
			edge. Vue Flow's own `arrowclosed` marker draws at a quarter of its nominal size (a 7 x 11px triangle at 28), so these are
			defined here, and `GraphDependencyEdge.vue` points each edge at the one for its zoom.
		-->
		<svg
			class="graph-arrow-defs"
			width="0"
			height="0"
			aria-hidden="true"
			focusable="false"
		>
			<defs>
				<template
					v-for="level in ZOOM_BUCKETS"
					:key="level.min"
				>
					<marker
						v-for="kind in ARROW_KINDS"
						:id="arrowMarkerId(kind, level)"
						:key="kind"
						viewBox="0 0 10 8"
						refX="10"
						refY="4"
						:markerWidth="level.arrow"
						:markerHeight="level.arrow * 0.8"
						markerUnits="userSpaceOnUse"
						orient="auto-start-reverse"
					>
						<path
							d="M0 0 L10 4 L0 8 Z"
							:class="`graph-arrow graph-arrow--${kind}`"
						/>
					</marker>
				</template>
			</defs>
		</svg>
		<VueFlow
			:nodes="nodes"
			:edges="flowEdges"
			:nodesDraggable="false"
			:nodesConnectable="false"
			:edgesUpdatable="false"
			:elementsSelectable="true"
			:zoomOnDoubleClick="false"
			:minZoom="0.05"
			class="graph-canvas-flow w-full h-full"
			@nodeClick="onNodeClick"
			@edgeClick="onEdgeClick"
			@edgeMouseEnter="hoveredEdgeId = $event.edge.id"
			@edgeMouseLeave="hoveredEdgeId = null"
		>
			<!-- The focus tags, above every edge and card: a tag is part of no edge, so an edge drawn later cannot cross its text. -->
			<template #zoom-pane>
				<svg
					class="graph-tag-layer"
					aria-hidden="true"
				>
					<g
						v-for="[edgeId, tag] in tagPlacements"
						:key="edgeId"
						class="graph-tag"
						:class="{ 'graph-tag--hidden': tagIsHidden(edgeId) }"
						:data-edge-id="edgeId"
						:data-relation="tag.relation"
					>
						<rect
							class="graph-tag-bg"
							:x="tagBox(tag).x"
							:y="tagBox(tag).y"
							:width="tagBox(tag).width"
							:height="tagBox(tag).height"
							:rx="4 * bucket.font / 11"
						/>
						<text
							class="graph-tag-text"
							:x="tag.x"
							:y="tag.y"
							text-anchor="middle"
							dominant-baseline="central"
							:style="{ fontSize: `${bucket.font}px` }"
							v-text="tag.text"
						/>
					</g>
				</svg>
			</template>

			<template #[`edge-${GRAPH_EDGE_TYPE}`]="edge">
				<GraphDependencyEdge v-bind="edge" />
			</template>

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
	/* 13/12px (it was 12/11): at the default Fit of a 1280 x 800 window (0.84) the type and the id are still about 11px on screen. */
	font-size: 13px;
	font-weight: 650;
	letter-spacing: -0.01em;
	color: var(--lab-color-text);
}

.graph-cluster-id {
	min-width: 0;
	overflow: hidden;
	text-overflow: ellipsis;
	white-space: nowrap;
	font-size: 12px;
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
	font-size: 12px;
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

/*
 * Vue Flow needs a handle on every node, but an edge does not attach to it: it starts and ends where ELK routed it, on the
 * card's border, spread along it so edges of one card stay apart. A visible dot would be a connection point that is not one.
 */
:deep(.vue-flow__handle) {
	width: 1px;
	height: 1px;
	opacity: 0;
	pointer-events: none;
}

:deep(.graph-edge) {
	transition: opacity 160ms ease;
}

/*
 * A solid mix with the canvas, not a transparent one: the old 68% transparent muted line was 2.84:1 against the canvas in the light
 * theme (under the 3:1 a line needs); this is 3.7:1 there and 4.5:1 in the dark theme.
 */
:deep(.graph-edge .vue-flow__edge-path) {
	stroke: color-mix(in srgb, var(--lab-color-text-muted) 82%, var(--lab-color-surface-alt));
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
:deep(.graph-edge:focus-visible .vue-flow__edge-path),
:deep(.graph-edge.selected .vue-flow__edge-path) {
	stroke-width: 2.4;
}

/*
 * The focus indicator of an edge reached with the keyboard: a wide accent band along the whole curve, under the line
 * (`GraphDependencyEdge.vue` draws the path), instead of the browser's outline, which would be the box around the curve. The
 * focused edge is also drawn at full opacity, so focus is visible on an edge the current selection dims.
 */
:deep(.graph-edge) {
	outline: none;
}

:deep(.graph-edge-focus-ring) {
	fill: none;
	stroke: var(--lab-color-accent);
	stroke-width: 9;
	stroke-linecap: round;
	stroke-opacity: 0.4;
	opacity: 0;
	pointer-events: none;
}

:deep(.graph-edge:focus-visible) {
	opacity: 1;
}

:deep(.graph-edge:focus-visible .graph-edge-focus-ring) {
	opacity: 1;
}

@media (forced-colors: active) {
	:deep(.graph-edge-focus-ring) {
		stroke: Highlight;
		stroke-opacity: 1;
	}
}

:deep(.graph-edge--dimmed) {
	opacity: 0.25;
}

/* The arrowheads: the fill matches the stroke of the edge they end (the accent one is an edge around the focus). */
.graph-arrow--muted {
	fill: color-mix(in srgb, var(--lab-color-text-muted) 82%, var(--lab-color-surface-alt));
}

.graph-arrow--writes {
	fill: color-mix(in srgb, var(--lab-color-warning) 76%, var(--lab-color-text-muted));
}

.graph-arrow--invokes {
	fill: color-mix(in srgb, var(--lab-color-accent) 74%, var(--lab-color-text-muted));
}

.graph-arrow--danger {
	fill: var(--lab-color-danger);
}

.graph-arrow--accent {
	fill: var(--lab-color-accent);
}

.graph-arrow-defs {
	position: absolute;
	width: 0;
	height: 0;
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
:deep(.graph-edge:focus-visible .vue-flow__edge-text),
:deep(.graph-edge:focus-visible .vue-flow__edge-textbg),
:deep(.graph-edge.selected .vue-flow__edge-text),
:deep(.graph-edge.selected .vue-flow__edge-textbg) {
	opacity: 1;
}

/*
 * Direction while something is focused (issue #230): the edges around the focus are drawn in the accent colour and heavier
 * (the arrowhead follows), every other edge is dimmed, and each edge around the focus carries a tag in the Relations view's
 * words: "Depends on #other" when it leaves the focus, "Used by #other" when it arrives. The tag gives way to the operation
 * label while the edge itself is hovered.
 */
:deep(.graph-edge--depends-on:not(.graph-edge--invalid-cycle, .graph-edge--invalid) .vue-flow__edge-path),
:deep(.graph-edge--used-by:not(.graph-edge--invalid-cycle, .graph-edge--invalid) .vue-flow__edge-path) {
	stroke: var(--lab-color-accent);
}

:deep(.graph-edge--depends-on .vue-flow__edge-path),
:deep(.graph-edge--used-by .vue-flow__edge-path) {
	stroke-width: 2.2;
}

.graph-tag-layer {
	position: absolute;
	top: 0;
	left: 0;
	width: 1px;
	height: 1px;
	overflow: visible;
	pointer-events: none;
}

.graph-tag-bg {
	fill: var(--lab-color-surface);
	stroke: var(--lab-color-border);
	stroke-width: 0.6px;
	fill-opacity: 0.97;
}

.graph-tag-text {
	fill: var(--lab-color-text);
	font-family: var(--lab-font-mono);
	font-weight: 700;
}

.graph-tag--hidden {
	opacity: 0;
}

/*
 * Audit U20: a node reached with the keyboard gets a visible ring. The edges are one Tab stop with their own indicator (the
 * accent band above; see the keyboard section of the script).
 */
:deep(.vue-flow__node:focus-visible) {
	outline: 2px solid var(--lab-color-accent);
	outline-offset: 2px;
	border-radius: var(--lab-radius);
}
</style>
