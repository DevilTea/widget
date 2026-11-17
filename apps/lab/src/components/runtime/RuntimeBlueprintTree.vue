<script setup lang="ts">
import type { InspectorBlueprintSnapshot } from '@deviltea/widget-inspector/protocol'
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
	<div class="overflow-auto h-full p-[6px_4px]">
		<RuntimeBlueprintTreeNode
			:snapshot="snapshot"
			:nodeId="snapshot.rootNodeId"
			:selectedNodeId="selectedNodeId"
			:depth="0"
			@select="(id) => emit('select', id)"
		/>
	</div>
</template>
