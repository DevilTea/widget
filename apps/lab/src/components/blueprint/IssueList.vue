<script setup lang="ts">
/**
 * Renders `BlueprintIssue[]` (either a selected node's `getIssues()` or
 * `blueprint.getCollectedIssues()`). Checkpoint H structured-source rendering: every field shown
 * beyond the human `message` is read from `issue.source`'s machine-readable structure (`path`,
 * `input`, `slot`/`index`, dependency `member`/`dependency` reference, `related` locations) —
 * `message` is never parsed to infer taxonomy or ownership.
 */
import type { BlueprintIssue, BlueprintIssueLocation, BlueprintWidgetNode } from '@deviltea/widget-core'
import type { BlueprintInspection, InspectionNodeId } from '@deviltea/widget-core/inspection'
import { formatDependencyReference, formatIssuePath } from '../../lib/issue-format'

defineProps<{
	issues: readonly BlueprintIssue[]
	inspection: BlueprintInspection
}>()

const emit = defineEmits<{
	navigate: [nodeId: InspectionNodeId]
}>()

function nodeIdOf(node: BlueprintWidgetNode, inspection: BlueprintInspection): InspectionNodeId | null {
	return inspection.getNodeId(node)
}

function relatedLocationLabel(location: BlueprintIssueLocation): string {
	switch (location.type) {
		case 'widget':
			return 'widget'
		case 'slot':
			return `slot "${location.slot}"`
		case 'slot-child':
			return `slot "${location.slot}"[${location.index}]`
		case 'property':
			return `property "${location.name}"`
		case 'method':
			return `method "${location.name}"`
	}
}

function onNavigateToLocation(location: BlueprintIssueLocation, inspection: BlueprintInspection): void {
	const nodeId = nodeIdOf(location.node, inspection)
	if (nodeId !== null)
		emit('navigate', nodeId)
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
			:class="pika({ border: '1px solid var(--lab-color-border)', borderRadius: 'var(--lab-radius)', padding: '6px 8px', fontSize: '12px', display: 'flex', flexDirection: 'column', gap: '4px' })"
		>
			<div :class="pika({ display: 'flex', alignItems: 'center', gap: '6px' })">
				<span
					:class="pika({ fontFamily: 'var(--lab-font-mono)', fontSize: '10px', padding: '1px 5px', borderRadius: '999px', background: 'var(--lab-color-surface-alt)', color: 'var(--lab-color-text-muted)' })"
				>{{ issue.source.type }}</span>
				<button
					v-if="nodeIdOf(issue.source.node, inspection) !== null"
					type="button"
					:class="pika({ marginLeft: 'auto', fontSize: '11px', color: 'var(--lab-color-accent)', background: 'transparent', border: 'none', cursor: 'pointer', padding: '0' })"
					@click="emit('navigate', nodeIdOf(issue.source.node, inspection)!)"
				>
					jump to node
				</button>
			</div>

			<div>{{ issue.message }}</div>

			<!-- Machine-readable source fields, by `source.type` — never derived from `message`. -->
			<dl
				v-if="issue.source.type === 'definition' && formatIssuePath(issue.source.path) !== null"
				:class="pika({ margin: '0', fontSize: '11px', fontFamily: 'var(--lab-font-mono)', color: 'var(--lab-color-text-muted)' })"
			>
				path: {{ formatIssuePath(issue.source.path) }}
			</dl>
			<dl
				v-else-if="issue.source.type === 'config'"
				:class="pika({ margin: '0', fontSize: '11px', fontFamily: 'var(--lab-font-mono)', color: 'var(--lab-color-text-muted)', display: 'flex', flexDirection: 'column', gap: '2px' })"
			>
				<div>input: {{ JSON.stringify(issue.source.input) }}</div>
				<div v-if="formatIssuePath(issue.source.path) !== null">
					path: {{ formatIssuePath(issue.source.path) }}
				</div>
			</dl>
			<dl
				v-else-if="issue.source.type === 'structure' && 'slot' in issue.source"
				:class="pika({ margin: '0', fontSize: '11px', fontFamily: 'var(--lab-font-mono)', color: 'var(--lab-color-text-muted)' })"
			>
				slot: "{{ issue.source.slot }}"<template v-if="'index' in issue.source">
					[{{ issue.source.index }}]
				</template>
			</dl>
			<dl
				v-else-if="issue.source.type === 'dependency'"
				:class="pika({ margin: '0', fontSize: '11px', fontFamily: 'var(--lab-font-mono)', color: 'var(--lab-color-text-muted)', display: 'flex', flexDirection: 'column', gap: '2px' })"
			>
				<div>member: {{ issue.source.member.type }} "{{ issue.source.member.name }}"</div>
				<div v-if="issue.source.dependency">
					dependency: {{ formatDependencyReference(issue.source.dependency) }}
				</div>
			</dl>

			<div
				v-if="issue.source.related && issue.source.related.length > 0"
				:class="pika({ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '4px', fontSize: '11px' })"
			>
				<span :class="pika({ color: 'var(--lab-color-text-muted)' })">related:</span>
				<button
					v-for="(location, relatedIndex) in issue.source.related"
					:key="relatedIndex"
					type="button"
					:disabled="nodeIdOf(location.node, inspection) === null"
					:class="pika({ 'fontSize': '11px', 'color': 'var(--lab-color-accent)', 'background': 'var(--lab-color-surface-alt)', 'border': '1px solid var(--lab-color-border)', 'borderRadius': '999px', 'cursor': 'pointer', 'padding': '1px 7px', '$:disabled': { color: 'var(--lab-color-text-muted)', cursor: 'default' } })"
					@click="onNavigateToLocation(location, inspection)"
				>
					{{ relatedLocationLabel(location) }}
				</button>
			</div>
		</li>
	</ul>
</template>
