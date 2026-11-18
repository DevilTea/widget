<script setup lang="ts">
/**
 * The one edge of the Graph: a dependency, drawn as Bezier curves (`graph/edge-geometry.ts`) from the card that declares
 * it to the member it depends on, with the arrowhead on the target. It follows the points ELK routed for the edge, so it
 * passes between the cards and never behind one; when the layout gave no points it is the plain two-point Bezier between the
 * handles.
 *
 * The arrowhead is one of the `<marker>`s `GraphCanvas.vue` defines, picked by the edge's colour family and by the zoom
 * bucket (`graph/zoom-scale.ts`), so it stays 12 screen px or more long at any zoom. The same bucket sizes the label.
 *
 * The label (the operation, or the dependency count of an aggregate) is hidden until the edge is hovered or selected. It is
 * drawn here as a rectangle and a text sized by the same `tagSize()` the focus tags use, not by Vue Flow's `EdgeText`, which
 * measures its box once at mount and so drew the box of 11px text around text of any other size. The focus tags ("Depends on
 * #x") are not part of an edge: `GraphCanvas.vue` draws them in a layer above all edges and cards.
 */
import type { EdgeProps } from '@vue-flow/core'
import type { GraphEdgeData } from '../../graph/vue-flow'
import { BaseEdge, useVueFlow } from '@vue-flow/core'
import { computed } from 'vue'
import { routeLabelPoint, routePath, straightRoute } from '../../graph/edge-geometry'
import { tagSize } from '../../graph/tag-placement'
import { arrowMarkerId, zoomBucket } from '../../graph/zoom-scale'

const props = defineProps<EdgeProps<GraphEdgeData>>()
const { viewport } = useVueFlow()

// The bucket object changes only when the zoom crosses a bucket boundary, so a wheel tick inside one re-renders nothing.
const bucket = computed(() => zoomBucket(viewport.value.zoom))

const route = computed(() => props.data?.route ?? straightRoute({ x: props.sourceX, y: props.sourceY }, { x: props.targetX, y: props.targetY }))
const path = computed(() => routePath(route.value))
const labelPoint = computed(() => routeLabelPoint(route.value))
const markerEnd = computed(() => `url(#${arrowMarkerId(props.data?.arrow ?? 'muted', bucket.value)})`)

const labelStyle = computed(() => ({ fontSize: `${bucket.value.font}px` }))
const labelRadius = computed(() => 4 * bucket.value.font / 11)
const labelBox = computed(() => {
	const { width, height } = tagSize(String(props.label ?? ''), bucket.value.font)
	return { x: labelPoint.value.x - width / 2, y: labelPoint.value.y - height / 2, width, height }
})
</script>

<template>
	<BaseEdge
		:id="id"
		:path="path"
		:markerEnd="markerEnd"
		:interactionWidth="20"
	/>
	<g
		v-if="label"
		class="graph-edge-label"
	>
		<rect
			class="vue-flow__edge-textbg"
			:x="labelBox.x"
			:y="labelBox.y"
			:width="labelBox.width"
			:height="labelBox.height"
			:rx="labelRadius"
		/>
		<text
			class="vue-flow__edge-text"
			:x="labelPoint.x"
			:y="labelPoint.y"
			text-anchor="middle"
			dominant-baseline="central"
			:style="labelStyle"
		>
			<tspan>{{ label }}</tspan>
		</text>
	</g>
</template>
