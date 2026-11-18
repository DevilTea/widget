<script setup lang="ts">
/**
 * The one edge of the Graph: a dependency, drawn as Bezier curves (`graph/edge-geometry.ts`) from the card that declares
 * it to the member it depends on, with the arrowhead on the target (the marker is part of the Vue Flow edge, see
 * `toVueFlow()`). It follows the points ELK routed for the edge, so it passes between the cards and never behind one; when
 * the layout gave no points it is the plain two-point Bezier between the handles.
 *
 * Two labels, both hidden until they are meant to show (see `GraphCanvas.vue`): the operation or dependency count while the
 * edge is hovered or selected, and, while a widget or member is focused, what the edge is to it in the words of the Relations
 * view ("Depends on" when it leaves the focus, "Used by" when it arrives).
 */
import type { EdgeProps } from '@vue-flow/core'
import type { GraphEdgeData } from '../../graph/vue-flow'
import { BaseEdge, EdgeText } from '@vue-flow/core'
import { computed } from 'vue'
import { useLabI18n } from '../../composables/use-lab-i18n'
import { routeLabelPoint, routePath, straightRoute } from '../../graph/edge-geometry'

const props = defineProps<EdgeProps<GraphEdgeData>>()
const i18n = useLabI18n()

const route = computed(() => props.data?.route ?? straightRoute({ x: props.sourceX, y: props.sourceY }, { x: props.targetX, y: props.targetY }))
const path = computed(() => routePath(route.value))
const labelPoint = computed(() => routeLabelPoint(route.value))
// Tags of the two directions sit at different heights, so the two edges of a pair of cards that run in opposite directions
// do not put their tags on top of each other.
const relationPoint = computed(() => routeLabelPoint(route.value, props.data?.relation === 'depends-on' ? 0.35 : 0.65))
const relationLabel = computed(() => props.data?.relation === 'depends-on' ? i18n.t('Depends on') : i18n.t('Used by'))
</script>

<template>
	<BaseEdge
		:id="id"
		:path="path"
		:labelX="labelPoint.x"
		:labelY="labelPoint.y"
		:label="label"
		:markerEnd="markerEnd"
		:labelShowBg="true"
		:labelBgPadding="[5, 3]"
		:labelBgBorderRadius="4"
		:interactionWidth="20"
	/>
	<g
		v-if="data?.relation"
		class="graph-edge-relation"
		:data-relation="data.relation"
	>
		<EdgeText
			:x="relationPoint.x"
			:y="relationPoint.y"
			:label="relationLabel"
			:labelShowBg="true"
			:labelBgPadding="[5, 3]"
			:labelBgBorderRadius="4"
		/>
	</g>
</template>
