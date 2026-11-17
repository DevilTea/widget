<script setup lang="ts">
import type { InspectorBlueprintSnapshot } from '@deviltea/widget-inspector/protocol'
import { computed } from 'vue'

const props = defineProps<{
	snapshot: InspectorBlueprintSnapshot
	nodeId: number
	selectedNodeId: number | null
	depth: number
}>()

const emit = defineEmits<{
	select: [nodeId: number]
}>()

const node = computed(() => props.snapshot.nodes.find(candidate => candidate.nodeId === props.nodeId) ?? null)
const label = computed(() => {
	const current = node.value
	if (current === null)
		return '(missing node)'
	return `${current.widgetId ?? '?'} : ${current.widgetType ?? '?'}`
})
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
				class="w-[7px] h-[7px] rounded-[999px] flex-[0_0_auto]"
				:style="{ background: node?.resolved ? 'var(--lab-color-ok)' : 'var(--lab-color-danger)' }"
			/>
			<span class="overflow-hidden text-ellipsis whitespace-nowrap">{{ label }}</span>
			<span
				v-if="(node?.diagnostics.length ?? 0) > 0"
				class="ml-[auto] text-[11px] text-lab-danger flex-[0_0_auto]"
			>{{ node?.diagnostics.length }}</span>
		</button>

		<div
			v-for="group in node?.sourceSlots ?? []"
			:key="group.name"
		>
			<div
				class="text-[11px] text-lab-text-muted tracking-[0.03em] uppercase"
				:style="{ paddingLeft: `${6 + (depth + 1) * 14}px` }"
			>
				{{ group.name }}<template v-if="group.placement">
					· {{ group.placement }}
				</template>
			</div>
			<RuntimeBlueprintTreeNode
				v-for="childId in group.children"
				:key="childId"
				:snapshot="snapshot"
				:nodeId="childId"
				:selectedNodeId="selectedNodeId"
				:depth="depth + 2"
				@select="(id) => emit('select', id)"
			/>
		</div>
	</div>
</template>
