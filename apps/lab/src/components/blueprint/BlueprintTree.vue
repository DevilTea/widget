<script setup lang="ts">
import type { BlueprintInspection, InspectionNodeId } from '@deviltea/widget-core/inspection'
import BlueprintTreeNode from './BlueprintTreeNode.vue'

defineProps<{
	inspection: BlueprintInspection
	selectedNodeId: InspectionNodeId | null
}>()

const emit = defineEmits<{
	select: [nodeId: InspectionNodeId]
}>()
</script>

<template>
	<div class="overflow-auto h-full p-[6px_4px]">
		<BlueprintTreeNode
			:inspection="inspection"
			:nodeId="inspection.rootNodeId"
			:selectedNodeId="selectedNodeId"
			:depth="0"
			@select="(id) => emit('select', id)"
		/>
	</div>
</template>
