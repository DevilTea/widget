<script setup lang="ts">
/**
 * Renders `BlueprintIssue[]` (either a selected node's `getIssues()` or
 * `blueprint.getCollectedIssues()`). Structured-source only: reads `issue.source.type` and, when
 * present, `issue.source.node` for "jump to node" navigation — never parses `issue.message` to infer
 * taxonomy or ownership (issue #13 Widget Lab Phase 4 Checkpoint H).
 */
import type { BlueprintIssue } from '@deviltea/widget-core'
import type { BlueprintInspection, InspectionNodeId } from '@deviltea/widget-core/inspection'

defineProps<{
	issues: readonly BlueprintIssue[]
	inspection: BlueprintInspection
}>()

const emit = defineEmits<{
	navigate: [nodeId: InspectionNodeId]
}>()

function nodeIdOf(issue: BlueprintIssue, inspection: BlueprintInspection): InspectionNodeId | null {
	return inspection.getNodeId(issue.source.node)
}
</script>

<template>
	<ul :class="pika({ listStyle: 'none', margin: '0', padding: '0', display: 'flex', flexDirection: 'column', gap: '6px' })">
		<li
			v-if="issues.length === 0"
			:class="pika({ color: 'var(--lab-color-text-muted)', fontSize: '12px' })"
		>
			No issues.
		</li>
		<li
			v-for="(issue, index) in issues"
			:key="index"
			:class="pika({ border: '1px solid var(--lab-color-border)', borderRadius: 'var(--lab-radius)', padding: '6px 8px', fontSize: '12px' })"
		>
			<div :class="pika({ display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '3px' })">
				<span
					:class="pika({ fontFamily: 'var(--lab-font-mono)', fontSize: '10px', padding: '1px 5px', borderRadius: '999px', background: 'var(--lab-color-surface-alt)', color: 'var(--lab-color-text-muted)' })"
				>{{ issue.source.type }}</span>
				<button
					v-if="nodeIdOf(issue, inspection) !== null"
					type="button"
					:class="pika({ marginLeft: 'auto', fontSize: '11px', color: 'var(--lab-color-accent)', background: 'transparent', border: 'none', cursor: 'pointer', padding: '0' })"
					@click="emit('navigate', nodeIdOf(issue, inspection)!)"
				>
					jump to node
				</button>
			</div>
			<div>{{ issue.message }}</div>
		</li>
	</ul>
</template>
