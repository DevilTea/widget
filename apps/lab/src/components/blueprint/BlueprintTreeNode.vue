<script setup lang="ts">
/**
 * One row of the recovered source topology (issue #13 Widget Lab Phase 4 Checkpoint H): traverses via
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

function isPlainObject(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value)
}

const inspectionNode = computed(() => props.inspection.getNode(props.nodeId))

const label = computed(() => {
	const node = inspectionNode.value
	if (node === null)
		return '(missing node)'
	if (node.resolved)
		return `${node.node.id} : ${node.node.type}`

	// Unresolved: best-effort display hints from `rawDefinition` only — never treated as semantic identity.
	const raw = node.node.rawDefinition
	const hintedId = isPlainObject(raw) && typeof raw.id === 'string' ? raw.id : '?'
	const hintedType = isPlainObject(raw) && typeof raw.type === 'string' ? raw.type : '?'
	return `${hintedId} : ${hintedType}`
})

const issueCount = computed(() => inspectionNode.value?.node.getIssues().length ?? 0)
</script>

<template>
	<div>
		<button
			type="button"
			:class="pika({
				display: 'flex',
				alignItems: 'center',
				gap: '6px',
				width: '100%',
				textAlign: 'left',
				border: 'none',
				borderRadius: 'var(--lab-radius)',
				padding: '3px 6px',
				fontSize: '12px',
				fontFamily: 'var(--lab-font-mono)',
				color: 'var(--lab-color-text)',
				cursor: 'pointer',
			})"
			:style="{
				paddingLeft: `${6 + depth * 14}px`,
				background: nodeId === selectedNodeId ? 'var(--lab-color-surface-alt)' : 'transparent',
			}"
			@click="emit('select', nodeId)"
		>
			<span
				:class="pika({ width: '7px', height: '7px', borderRadius: '999px', flex: '0 0 auto' })"
				:style="{ background: inspectionNode?.resolved ? 'var(--lab-color-success)' : 'var(--lab-color-danger)' }"
			/>
			<span :class="pika({ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' })">{{ label }}</span>
			<span
				v-if="issueCount > 0"
				:class="pika({ marginLeft: 'auto', fontSize: '10px', color: 'var(--lab-color-danger)', flex: '0 0 auto' })"
			>{{ issueCount }}</span>
		</button>

		<div
			v-for="group in inspectionNode?.sourceSlots ?? []"
			:key="group.name"
		>
			<div
				:class="pika({ fontSize: '10px', color: 'var(--lab-color-text-muted)', letterSpacing: '0.03em', textTransform: 'uppercase' })"
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
