<script setup lang="ts">
/**
 * The one edge of the Graph: a dependency, drawn as Bezier curves (`graph/edge-geometry.ts`) from the card that declares
 * it to the member it depends on, with the arrowhead on the target. It follows the points ELK routed for the edge, so it
 * passes between the cards and never behind one; when the layout gave no points it is the plain two-point Bezier between the
 * handles.
 *
 * The arrowhead is one of the `<marker>`s `GraphCanvas.vue` defines, picked by the edge's colour family and by the zoom
 * bucket (`graph/zoom-scale.ts`), so it stays 12 screen px or more long at any zoom. The same bucket sizes the text.
 *
 * Both labels are drawn here (a rectangle and a text, sized by the same `tagSize()` the tag placement used), not by Vue Flow's
 * `EdgeText`, which measures its box once at mount and so drew the box of 11px text around text of any other size.
 *
 * Two labels, both hidden until they are meant to show (see `GraphCanvas.vue`): the operation or dependency count while the
 * edge is hovered or selected, and, while a widget or member is focused, the tag `GraphCanvas.vue` placed for this edge: what the
 * edge is to the focus in the words of the Relations view, with the other end's name ("Depends on #open-day" when it leaves the
 * focus, "Used by #sessions" when it arrives), so it cannot be read backwards.
 */
import type { EdgeProps } from '@vue-flow/core'
import type { GraphEdgeData } from '../../graph/vue-flow'
import { BaseEdge, useVueFlow } from '@vue-flow/core'
import { computed, inject } from 'vue'
import { routeLabelPoint, routePath, straightRoute } from '../../graph/edge-geometry'
import { tagSize } from '../../graph/tag-placement'
import { arrowMarkerId, zoomBucket } from '../../graph/zoom-scale'
import { GraphTagsKey } from './graph-tags'

const props = defineProps<EdgeProps<GraphEdgeData>>()
const { viewport } = useVueFlow()
const tags = inject(GraphTagsKey, undefined)

// The bucket object changes only when the zoom crosses a bucket boundary, so a wheel tick inside one re-renders nothing.
const bucket = computed(() => zoomBucket(viewport.value.zoom))
/** How many times larger than the nominal 11px the text is drawn in this bucket. */
const textScale = computed(() => bucket.value.font / 11)

const route = computed(() => props.data?.route ?? straightRoute({ x: props.sourceX, y: props.sourceY }, { x: props.targetX, y: props.targetY }))
const path = computed(() => routePath(route.value))
const labelPoint = computed(() => routeLabelPoint(route.value))
const markerEnd = computed(() => `url(#${arrowMarkerId(props.data?.arrow ?? 'muted', bucket.value)})`)

const labelStyle = computed(() => ({ fontSize: `${bucket.value.font}px` }))
const labelRadius = computed(() => 4 * textScale.value)
/** The box of a label with this text at this zoom bucket, by its centre. */
function boxOf(text: string, centre: { x: number, y: number }) {
	const { width, height } = tagSize(text, bucket.value.font)
	return { x: centre.x - width / 2, y: centre.y - height / 2, width, height }
}
const labelBox = computed(() => boxOf(String(props.label ?? ''), labelPoint.value))

const tag = computed(() => tags?.value.get(props.id))
const tagBox = computed(() => (tag.value ? boxOf(tag.value.text, tag.value) : undefined))
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
			{{ label }}
		</text>
	</g>
	<g
		v-if="tag && tagBox"
		class="graph-edge-relation"
		:data-relation="data?.relation"
	>
		<rect
			class="vue-flow__edge-textbg"
			:x="tagBox.x"
			:y="tagBox.y"
			:width="tagBox.width"
			:height="tagBox.height"
			:rx="labelRadius"
		/>
		<text
			class="vue-flow__edge-text"
			:x="tag.x"
			:y="tag.y"
			text-anchor="middle"
			dominant-baseline="central"
			:style="labelStyle"
		>
			{{ tag.text }}
		</text>
	</g>
</template>
