<script setup lang="ts">
import type { InspectorBlueprintSnapshot } from '@deviltea/widget-devtools'
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
			:class="pika({ display: 'flex', alignItems: 'center', gap: '6px', width: '100%', textAlign: 'left', border: 'none', borderRadius: 'var(--lab-radius)', padding: '3px 6px', fontSize: '12px', fontFamily: 'var(--lab-font-mono)', color: 'var(--lab-color-text)', cursor: 'pointer' })"
			:style="{
				paddingLeft: `${6 + depth * 14}px`,
				background: nodeId === selectedNodeId ? 'var(--lab-color-surface-alt)' : 'transparent',
			}"
			@click="emit('select', nodeId)"
		>
			<span
				:class="pika({ width: '7px', height: '7px', borderRadius: '999px', flex: '0 0 auto' })"
				:style="{ background: node?.resolved ? 'var(--lab-color-ok)' : 'var(--lab-color-danger)' }"
			/>
			<span :class="pika({ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' })">{{ label }}</span>
			<span
				v-if="(node?.diagnostics.length ?? 0) > 0"
				:class="pika({ marginLeft: 'auto', fontSize: '10px', color: 'var(--lab-color-danger)', flex: '0 0 auto' })"
			>{{ node?.diagnostics.length }}</span>
		</button>

		<div
			v-for="group in node?.sourceSlots ?? []"
			:key="group.name"
		>
			<div
				:class="pika({ fontSize: '10px', color: 'var(--lab-color-text-muted)', letterSpacing: '0.03em', textTransform: 'uppercase' })"
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
