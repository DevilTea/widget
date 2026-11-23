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
 *
 * After a widget is expanded (`frameClusterId`), the automatic fit goes to a readable zoom on that widget instead of the whole
 * layout when the whole layout would make its member text smaller than 11px (`graph/viewport-plan.ts`); the minimap then shows
 * where the viewport is.
 */
import type { GraphNode, NodeMouseEvent } from '@vue-flow/core'
import type { GraphFlowEdge, GraphFlowNode } from '../../graph/vue-flow'
import { Handle, Position, useVueFlow, VueFlow } from '@vue-flow/core'
import { computed, nextTick, onBeforeUnmount, onMounted, ref, useId, watch } from 'vue'
import { useGraphTags } from '../../composables/use-graph-tags'
import { useLabI18n } from '../../composables/use-lab-i18n'
import { edgeKeyboardOrder, edgeName, edgeTabStop, isEdgeNavigationKey, nextEdgeId } from '../../graph/edge-a11y'
import { tagSize } from '../../graph/tag-placement'
import { bottomRightRect, EXPANDED_HEADER_PX, isMinimapCovering, isMinimapUseful, manualMinZoom, MEMBER_FONT_PX, minimapSize, planExpandViewport, toScreenRect } from '../../graph/viewport-plan'
import { GRAPH_EDGE_TYPE } from '../../graph/vue-flow'
import { ARROW_KINDS, arrowMarkerId, ZOOM_BUCKETS, zoomBucket } from '../../graph/zoom-scale'
import GraphDependencyEdge from './GraphDependencyEdge.vue'
import { MiniMap } from './lazy-minimap'
import '@vue-flow/core/dist/style.css'

const props = defineProps<{
	nodes: GraphFlowNode[]
	edges: GraphFlowEdge[]
	layoutVersion?: number
	/** The widget this layout generation frames at a readable zoom (it was just expanded); null fits the whole layout. */
	frameClusterId?: string | null
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
const FIT_PADDING = 0.04
const FIT_OPTIONS = { padding: FIT_PADDING } as const

/**
 * Fit may go this far out. One widget is expanded at a time (issue #254): the Trip budget with its largest widget expanded fits
 * at about 0.2, but a larger Document may need less (the fully expanded Trip budget, no longer offered, fitted at about 0.06).
 */
const FIT_MIN_ZOOM = 0.05
/** Vue Flow's own default, stated so the readable zoom on expand is clamped to the same limit the canvas has. */
const MAX_ZOOM = 2
const ZOOM_LIMITS = { min: FIT_MIN_ZOOM, max: MAX_ZOOM } as const
/** The member cards' font size, bound into the stylesheet below, so the readable zoom and the CSS cannot disagree. */
const memberFontSize = `${MEMBER_FONT_PX}px`
/** The expanded widget's header height, bound into the stylesheet: the minimap gives way to the header (`minimapObstacles`). */
const expandedHeaderHeight = `${EXPANDED_HEADER_PX}px`

const i18n = useLabI18n()
const vueFlowContainer = ref<HTMLElement | null>(null)
const { addSelectedEdges, dimensions, findEdge, fitBounds, fitView, getNodes, getSelectedEdges, onNodesChange, onNodesInitialized, removeSelectedEdges, setCenter, setMinZoom, setViewport, viewport, zoomIn, zoomOut } = useVueFlow()

/**
 * The tags of the edges around the focus ("Depends on #sessions", "Used by #phone"), placed together so that none covers a card,
 * an arrowhead or another tag; one with no room on its own edge is set beside it with a short leader line, and one that fits
 * nowhere is left out (see `graph/tag-placement.ts`). They are re-placed only when
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
 * The box of the cards and the curves between them, in flow units (null before anything is measured). A long edge runs in a
 * corridor ELK reserved beside the cards, so fitting only the cards would cut those curves off at the edge of the canvas.
 */
const contentBounds = computed<{ x: number, y: number, width: number, height: number } | null>(() => {
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
	return Number.isFinite(minX) ? { x: minX, y: minY, width: maxX - minX, height: maxY - minY } : null
})

/** Fits the whole layout (`contentBounds`). Afterwards the manual zoom floor follows the zoom Fit settled on. */
async function fitContent(): Promise<boolean> {
	// Fit may reach far out.
	setMinZoom(FIT_MIN_ZOOM)
	const bounds = contentBounds.value
	const success = bounds !== null ? await fitBounds(bounds, FIT_OPTIONS) : await fitView(FIT_OPTIONS)
	setMinZoom(manualMinZoom(viewport.value.zoom, ZOOM_LIMITS))
	return success
}

/**
 * The automatic fit of a new layout generation. After an expansion (`frameClusterId`) whose whole layout would put member text
 * under 11px, it shows the expanded widget at the readable zoom instead, top edge at the top of the pane
 * (`graph/viewport-plan.ts`); the manual zoom floor still follows the whole layout's Fit. Otherwise it fits the whole layout.
 */
async function fitGeneration(): Promise<boolean> {
	const frameId = props.frameClusterId ?? null
	const expanded = frameId === null ? undefined : getNodes.value.find(node => node.id === frameId)
	const bounds = contentBounds.value
	if (expanded === undefined || bounds === null)
		return fitContent()
	const plan = planExpandViewport({
		content: bounds,
		expanded: { x: expanded.computedPosition.x, y: expanded.computedPosition.y, width: expanded.dimensions.width, height: expanded.dimensions.height },
		pane: { width: dimensions.value.width, height: dimensions.value.height },
		padding: FIT_PADDING,
		limits: ZOOM_LIMITS,
	})
	if (plan.kind === 'fit')
		return fitContent()
	setMinZoom(manualMinZoom(plan.fitZoom, ZOOM_LIMITS))
	return setViewport(plan.viewport)
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
	// One frame more: a size change made in the same frame (the Graph key folding or unfolding as the pane is first measured,
	// `DependenciesPanel.vue`) is laid out by then, so the fit uses the canvas as it will stay.
	await new Promise<void>(resolve => requestAnimationFrame(() => resolve()))
	if (fitted)
		return true
	if (el.clientWidth === 0 || el.clientHeight === 0 || !areCurrentNodesMeasured())
		return false

	const success = await fitGeneration()
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

/**
 * The minimap (`@vue-flow/minimap`): the cards in miniature with the viewport as a rectangle; dragging it pans, a click centres the
 * viewport on that point at the current zoom. Shown only while part of the graph is out of view, the canvas is at least 320 x 160 and
 * no focus tag is under it (`isMinimapUseful()`); about a fifth of the canvas wide (`minimapSize()`). It is `aria-hidden`: it repeats
 * what the canvas shows, has no keyboard operation and no tab stop, and the zoom buttons, Fit graph and Relations are the keyboard and
 * screen-reader routes.
 */
/** Its distance from the canvas edges, bound into the stylesheet, and its 1px border on each side. */
const MINIMAP_MARGIN = 8
const MINIMAP_BORDER = 1
const minimapMargin = `${MINIMAP_MARGIN}px`
const minimapDrawing = computed(() => contentBounds.value === null ? null : minimapSize(dimensions.value, contentBounds.value))
/**
 * What the minimap gives way to, on screen: the focus tags that are showing (box and leader line; a tag hidden while its edge is hovered,
 * focused or selected does not count) and the header of the expanded widget (type, id and Collapse).
 */
const minimapObstacles = computed(() => [...tagPlacements.value.entries()]
	.filter(([edgeId]) => !tagIsHidden(edgeId))
	.map(([, tag]) => {
		let left = tag.x - tag.width / 2
		let top = tag.y - tag.height / 2
		let right = left + tag.width
		let bottom = top + tag.height
		for (const point of tag.leader === undefined ? [] : [tag.leader.from, tag.leader.to]) {
			left = Math.min(left, point.x)
			top = Math.min(top, point.y)
			right = Math.max(right, point.x)
			bottom = Math.max(bottom, point.y)
		}
		return toScreenRect({ x: left, y: top, width: right - left, height: bottom - top }, viewport.value)
	})
	.concat(getNodes.value
		.filter(node => node.type === 'cluster' && node.data.isExpanded === true)
		.map(node => toScreenRect({ x: node.computedPosition.x, y: node.computedPosition.y, width: node.dimensions.width, height: EXPANDED_HEADER_PX }, viewport.value))))

/**
 * While the minimap is being dragged (pointer down on it until the pointer is released, plus a frame so d3-zoom's own mouseup runs
 * first) its state is frozen: dragging pans the canvas, which can bring a tag under it or the whole graph into view, and unmounting it
 * under the pointer would leave d3-zoom's window listeners panning a minimap that is gone.
 */
const minimapDragging = ref(false)
function onMinimapPointerdown(): void {
	minimapDragging.value = true
	const release = (): void => {
		window.removeEventListener('pointerup', release)
		window.removeEventListener('pointercancel', release)
		requestAnimationFrame(() => {
			minimapDragging.value = false
		})
	}
	window.addEventListener('pointerup', release)
	window.addEventListener('pointercancel', release)
}

/** Mounted while it is useful (the canvas size and "part of the graph is out of view"); the size rule and that rule alone unmount it. */
const showMinimap = computed(() => minimapDragging.value || (minimapDrawing.value !== null && isMinimapUseful(contentBounds.value, dimensions.value, viewport.value)))
/**
 * Hidden (`visibility: hidden`, no pointer events), not unmounted, while a tag or the expanded widget's header would be under it:
 * that changes as the canvas pans, also during a drag of the minimap itself.
 */
const minimapCovering = computed(() => {
	const drawing = minimapDrawing.value
	if (minimapDragging.value || drawing === null)
		return false
	const box = bottomRightRect(dimensions.value, { width: drawing.width + 2 * MINIMAP_BORDER, height: drawing.height + 2 * MINIMAP_BORDER }, MINIMAP_MARGIN)
	return isMinimapCovering(box, minimapObstacles.value)
})

function minimapNodeClass(node: GraphNode): string {
	if (node.type === 'cluster')
		return node.data?.isExpanded === true ? 'graph-minimap-node graph-minimap-node--expanded' : 'graph-minimap-node graph-minimap-node--cluster'
	return 'graph-minimap-node'
}

function onMinimapClick({ position }: { position: { x: number, y: number } }): void {
	void setCenter(position.x, position.y, { zoom: viewport.value.zoom })
}

/** Keyboard route to zooming (the wheel and pinch already zoom): a fitted large graph is read by zooming in. */
function zoomGraph(direction: 'in' | 'out'): void {
	void (direction === 'in' ? zoomIn() : zoomOut())
}

/**
 * Focuses the expand/collapse button of a widget card in the given state (`expanded`: the card shows its members). Returns
 * false while there is no such button or it cannot take focus yet (Vue Flow keeps a card hidden until it has measured it).
 */
function focusClusterToggle(clusterId: string, expanded: boolean): boolean {
	const toggle = vueFlowContainer.value?.querySelector<HTMLButtonElement>(
		`.vue-flow__node[data-id="${CSS.escape(clusterId)}"] .graph-cluster-toggle[aria-expanded="${expanded}"]`,
	)
	if (toggle === null || toggle === undefined)
		return false
	toggle.focus({ preventScroll: true })
	return document.activeElement === toggle
}

defineExpose({ fitGraph, zoomGraph, focusClusterToggle })

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
 * Vue Flow's own focusability is no use for a roving stop: a focusable edge gets `tabIndex: 0` as a DOM property (Vue sets it on
 * the SVG `<g>` and it shows as `tabindex="0"`, on every edge, and it beats a `tabindex` attribute from `domAttributes`), and its
 * key handler is bound as `onKeyDown`, which Vue turns into a listener for an event named `key-down` that never fires. So every
 * edge is made `focusable: false` (the projection sets it on), which also takes away the `role="group"`, `aria-describedby` and
 * key handler that came with it. Without a fork, `domAttributes` gives back the role and a real lowercase `tabindex`, and the keys
 * are handled here, delegated on the canvas.
 *
 * The edges are one roving Tab stop: exactly one edge has `tabindex="0"`, the rest `-1`, and the arrow keys move between
 * them, so a graph with dozens of edges costs one Tab press and Tab or Shift+Tab leaves the group from whichever edge the
 * arrows reached. The stop starts on the first edge of the keyboard order (the rendered attribute) and follows focus after
 * that: `focusin` rewrites the two `tabindex` attributes in the DOM directly, so moving does not rebuild the edges and Vue
 * Flow is not handed a new edge list per key press (Vue leaves the attribute alone while the rendered value is unchanged).
 * When the graph, the focused widget or member, or the language changes, the stop goes back to the first edge of the new
 * order, unless an edge has focus. Enter or Space selects the edge as a click does (which opens its details under the
 * canvas), Escape clears the selection.
 *
 * Vue Flow's own description of an edge ("Press enter or space to select an edge... press delete to remove it", English
 * only, and wrong for a readonly inspector) and its role description ("edge") are replaced through the same `domAttributes`.
 * The edge keeps Vue Flow's `role="group"`: a composite role (a `listbox` of `option`s) would need the role on Vue Flow's own
 * `<svg>` containers, of which there is one per z-level and which it re-creates, so it is not set from outside.
 */
const edgeKeysId = useId()
const keyboardOrder = computed(() => edgeKeyboardOrder(props.edges))

function edgeAccessibleName(edge: GraphFlowEdge): string {
	const { kind, source, target, label, invalidCycle } = edgeName(edge)
	let name: string
	if (kind === 'absent')
		name = i18n.t('{source} depends on a target that is absent ({label})', { source, label })
	else if (kind === 'invalid')
		name = i18n.t('{source} has an invalid dependency ({label})', { source, label })
	else if (kind === 'used-by')
		name = i18n.t('{target} is used by {source} ({label})', { source, target, label })
	else
		name = i18n.t('{source} depends on {target} ({label})', { source, target, label })
	return invalidCycle ? i18n.t('{name}, invalid cycle', { name }) : name
}

const flowEdges = computed<GraphFlowEdge[]>(() => {
	const tabStop = edgeTabStop(props.edges)
	const roleDescription = i18n.t('dependency')
	return props.edges.map(edge => ({
		...edge,
		ariaLabel: edgeAccessibleName(edge),
		// Vue Flow's own focusability is off (the projection sets it on): it would write `tabIndex=0` on every edge, and that DOM
		// property wins over the roving `tabindex` attribute below. The role it would have set with it is given back here.
		focusable: false,
		domAttributes: {
			'role': 'group',
			'tabindex': edge.id === tabStop ? 0 : -1,
			'aria-describedby': edgeKeysId,
			'aria-roledescription': roleDescription,
		},
	}))
})

/** Makes `edgeId` the one edge in the Tab order, in the DOM only (see above). */
function setEdgeTabStop(edgeId: string | null): void {
	for (const element of vueFlowContainer.value?.querySelectorAll<SVGGElement>('.vue-flow__edge') ?? [])
		element.setAttribute('tabindex', edgeId !== null && element.getAttribute('data-id') === edgeId ? '0' : '-1')
}

// A new graph, focus or language: back to the first edge of the new order, unless an edge has focus (then it stays the stop).
watch(flowEdges, async () => {
	await nextTick()
	const focused = edgeIdOfTarget(document.activeElement)
	setEdgeTabStop(focused !== null && keyboardOrder.value.includes(focused) ? focused : edgeTabStop(props.edges))
}, { flush: 'post' })

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
	const edgeId = edgeIdOfTarget(event.target)
	focusedEdgeId.value = edgeId
	// The roving Tab stop follows focus, however the edge was reached (Tab, an arrow key, a click).
	if (edgeId !== null)
		setEdgeTabStop(edgeId)
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
		<!-- What the keys do on an edge, for a screen reader: every edge points here with aria-describedby. -->
		<span
			:id="edgeKeysId"
			class="graph-edge-keys"
			hidden
		>{{ i18n.t('Arrow keys move between the dependencies, Enter or Space shows the details, Escape clears the selection.') }}</span>
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
		<!--
			deleteKeyCode: Vue Flow's default deletes the selected cards and edges on Backspace (a document-level listener), which a
			readonly inspector must never do. selectionKeyCode / multiSelectionKeyCode: no Shift-drag selection box and no
			Ctrl/Cmd multi-selection either; one card or one edge is selected at a time and the details show that one.
		-->
		<VueFlow
			:nodes="nodes"
			:edges="flowEdges"
			:nodesDraggable="false"
			:nodesConnectable="false"
			:edgesUpdatable="false"
			:elementsSelectable="true"
			:zoomOnDoubleClick="false"
			:minZoom="FIT_MIN_ZOOM"
			:maxZoom="MAX_ZOOM"
			:deleteKeyCode="null"
			:selectionKeyCode="null"
			:multiSelectionKeyCode="null"
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
						:class="{ 'graph-tag--hidden': tagIsHidden(edgeId), 'graph-tag--leader': tag.leader !== undefined }"
						:data-edge-id="edgeId"
						:data-relation="tag.relation"
					>
						<!-- A tag beside its edge: the leader line back to the point of the edge it is about, ending in a dot on the edge. -->
						<template v-if="tag.leader !== undefined">
							<line
								class="graph-tag-leader"
								:x1="tag.leader.from.x"
								:y1="tag.leader.from.y"
								:x2="tag.leader.to.x"
								:y2="tag.leader.to.y"
								:style="{ strokeWidth: `${1.2 * bucket.font / 11}px` }"
							/>
							<circle
								class="graph-tag-leader-dot"
								:cx="tag.leader.from.x"
								:cy="tag.leader.from.y"
								:r="2.5 * bucket.font / 11"
							/>
						</template>
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

			<MiniMap
				v-if="showMinimap"
				class="graph-minimap"
				:class="{ 'graph-minimap--covering': minimapCovering }"
				data-testid="graph-minimap"
				:data-covering="minimapCovering"
				aria-hidden="true"
				position="bottom-right"
				pannable
				:width="minimapDrawing?.width"
				:height="minimapDrawing?.height"
				:ariaLabel="null"
				:nodeClassName="minimapNodeClass"
				:nodeBorderRadius="6"
				:nodeStrokeWidth="0"
				@click="onMinimapClick"
				@pointerdown.capture="onMinimapPointerdown"
			/>

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
							aria-expanded="true"
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
							aria-expanded="false"
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
	/* EXPANDED_HEADER_PX (graph/viewport-plan.ts): the minimap gives way to this box. */
	height: v-bind(expandedHeaderHeight);
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

/*
 * An expanded widget's header keeps its type, id, member count and Collapse button together at the left. Expanding frames the widget
 * from its left edge when it is wider than the canvas (graph/viewport-plan.ts), so a Collapse button at the far right would be out
 * of view, and so would the keyboard focus that moves to it after the expansion.
 */
.graph-cluster-header > .graph-cluster-identity {
	flex: 0 1 auto;
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
	/* MEMBER_FONT_PX (graph/viewport-plan.ts): the readable zoom on expand is computed from it. */
	font-size: v-bind(memberFontSize);
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
 * The focus indicator of an edge reached with the keyboard: a solid accent band, 7 screen px wide at any zoom, along the whole curve, under the line
 * (`GraphDependencyEdge.vue` draws the path), instead of the browser's outline, which would be the box around the curve. The
 * focused edge is also drawn at full opacity, so focus is visible on an edge the current selection dims.
 */
:deep(.graph-edge) {
	outline: none;
}

:deep(.graph-edge-focus-ring) {
	fill: none;
	stroke: var(--lab-color-accent);
	/* Screen px at any zoom: in flow units a band is a hairline once Fit has zoomed a large graph out. */
	stroke-width: 7px;
	vector-effect: non-scaling-stroke;
	stroke-linecap: round;
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

.graph-tag-leader {
	stroke: var(--lab-color-accent);
	fill: none;
}

.graph-tag-leader-dot {
	fill: var(--lab-color-accent);
}

.graph-tag--hidden {
	opacity: 0;
}

/*
 * The minimap, in the Lab tokens (it follows the light and dark themes): a surface panel with the cards in the border colour, the
 * expanded widget as an outline, the area outside the viewport shaded and the viewport itself outlined in the accent colour. CSS
 * fills beat the presentation attributes the component sets.
 */
.graph-minimap {
	margin: v-bind(minimapMargin);
	overflow: hidden;
	border: 1px solid var(--lab-color-border);
	border-radius: var(--lab-radius);
	background: var(--lab-color-surface);
	box-shadow: 0 2px 8px color-mix(in srgb, var(--lab-color-text) 10%, transparent);
	line-height: 0;
}

/* Something it must not cover is under it (a focus tag, the expanded widget's header): out of sight and out of the way, still mounted. */
.graph-minimap--covering {
	visibility: hidden;
	pointer-events: none;
}

.graph-minimap.pannable {
	cursor: grab;
}

.graph-minimap.dragging {
	cursor: grabbing;
}

.graph-minimap :deep(.graph-minimap-node) {
	fill: color-mix(in srgb, var(--lab-color-text-muted) 45%, var(--lab-color-surface));
}

.graph-minimap :deep(.graph-minimap-node--expanded) {
	fill: color-mix(in srgb, var(--lab-color-accent) 8%, var(--lab-color-surface));
	stroke: color-mix(in srgb, var(--lab-color-accent) 55%, var(--lab-color-border));
	stroke-width: 1px;
	vector-effect: non-scaling-stroke;
}

.graph-minimap :deep(.vue-flow__minimap-mask) {
	fill: color-mix(in srgb, var(--lab-color-text) 14%, transparent);
	stroke: var(--lab-color-accent);
	stroke-width: 1.5px;
	vector-effect: non-scaling-stroke;
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
