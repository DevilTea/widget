<script setup lang="ts">
import type { InspectorBlueprintSnapshot } from '@deviltea/widget-devtools'
import RuntimeBlueprintTreeNode from './RuntimeBlueprintTreeNode.vue'

defineProps<{
	snapshot: InspectorBlueprintSnapshot
	selectedNodeId: number | null
}>()

const emit = defineEmits<{
	select: [nodeId: number]
}>()
</script>

<template>
	<div :class="pika({ overflow: 'auto', height: '100%', padding: '6px 4px' })">
		<RuntimeBlueprintTreeNode
			:snapshot="snapshot"
			:nodeId="snapshot.rootNodeId"
			:selectedNodeId="selectedNodeId"
			:depth="0"
			@select="(id) => emit('select', id)"
		/>
	</div>
</template>
