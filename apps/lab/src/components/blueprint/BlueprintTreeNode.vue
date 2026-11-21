<script setup lang="ts">
/**
 * One row of the recovered source topology (diagnostic #13 Widget Lab Phase 4 Checkpoint H): traverses via
 * `inspection.getNode(id).sourceSlots`, never via resolved `.slots`, so unresolved nodes and
 * `raw-slot` placement — the whole point of Blueprint recovery — render exactly like everything else.
 * Recursive by filename self-reference (a standard Vue SFC feature — no import needed).
 */
import type { BlueprintInspection, InspectionNodeId } from '@deviltea/widget-core/inspection'
import { computed } from 'vue'

const props = defineProps<{
	inspection: BlueprintInspection
	nodeId: InspectionNodeId
	selectedNodeId: InspectionNodeId | null
	depth: number
}>()

const emit = defineEmits<{
	select: [nodeId: InspectionNodeId]
}>()

const inspectionNode = computed(() => props.inspection.getNode(props.nodeId))

const label = computed(() => {
	const node = inspectionNode.value
	if (node === null)
		return '(missing node)'
	if (node.resolved)
		return `${node.node.id} : ${node.node.type}`

	// Unresolved: Core's best-effort `id`/`type` hints — display only, never semantic identity.
	return `${node.id ?? '?'} : ${node.type ?? '?'}`
})

const diagnosticCount = computed(() => inspectionNode.value?.node.diagnostics.length ?? 0)
</script>

<template>
	<div>
		<button
			type="button"
			class="flex items-center gap-[6px] w-full text-left [border:none] rounded-lab p-[4px_6px] min-h-[24px] text-[12px] font-lab-mono text-lab-text cursor-pointer"
			:style="{
				paddingLeft: `${6 + depth * 14}px`,
				background: nodeId === selectedNodeId ? 'var(--lab-color-surface-alt)' : 'transparent',
			}"
			@click="emit('select', nodeId)"
		>
			<span
				class="w-[7px] h-[7px] rounded-[999px] flex-none"
				:style="{ background: inspectionNode?.resolved ? 'var(--lab-color-ok)' : 'var(--lab-color-danger)' }"
			/>
			<span class="overflow-hidden text-ellipsis whitespace-nowrap">{{ label }}</span>
			<span
				v-if="diagnosticCount > 0"
				class="ml-auto text-[11px] text-lab-danger flex-none"
			>{{ diagnosticCount }}</span>
		</button>

		<div
			v-for="group in inspectionNode?.sourceSlots ?? []"
			:key="group.name"
		>
			<div
				class="text-[11px] text-lab-text-muted tracking-[0.03em] uppercase"
				:style="{ paddingLeft: `${6 + (depth + 1) * 14}px` }"
			>
				{{ group.name }} · {{ group.placement }}
			</div>
			<BlueprintTreeNode
				v-for="childId in group.children"
				:key="childId"
				:inspection="inspection"
				:nodeId="childId"
				:selectedNodeId="selectedNodeId"
				:depth="depth + 2"
				@select="(id) => emit('select', id)"
			/>
		</div>
	</div>
</template>
