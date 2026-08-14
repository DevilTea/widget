<script setup lang="ts">
/**
 * Renders `RuntimePropertyIssue[]` (a failed Property's `ExecutionResult.issues`). Same convention as
 * `blueprint/IssueList.vue`: every field beyond `message` is read from `issue.source`'s machine-readable
 * structure, never parsed out of `message`.
 */
import type { RuntimePropertyIssue } from '@deviltea/widget-core'
import { formatDependencyReference, formatIssuePath } from '../../lib/issue-format'

defineProps<{
	issues: readonly RuntimePropertyIssue[]
}>()
</script>

<template>
	<ul :class="pika({ listStyle: 'none', margin: '0', padding: '0', display: 'flex', flexDirection: 'column', gap: '6px' })">
		<li
			v-for="(issue, index) in issues"
			:key="index"
			:class="pika({ border: '1px solid var(--lab-color-border)', borderRadius: 'var(--lab-radius)', padding: '6px 8px', fontSize: '11px', display: 'flex', flexDirection: 'column', gap: '4px' })"
		>
			<span :class="pika({ fontFamily: 'var(--lab-font-mono)', fontSize: '10px', padding: '1px 5px', borderRadius: '999px', background: 'var(--lab-color-surface-alt)', color: 'var(--lab-color-text-muted)', alignSelf: 'flex-start' })">
				{{ issue.source.type }}
			</span>
			<div>{{ issue.message }}</div>
			<dl
				v-if="issue.source.type === 'property-result'"
				:class="pika({ margin: '0', fontFamily: 'var(--lab-font-mono)', color: 'var(--lab-color-text-muted)', display: 'flex', flexDirection: 'column', gap: '2px' })"
			>
				<div v-if="formatIssuePath(issue.source.path) !== null">
					path: {{ formatIssuePath(issue.source.path) }}
				</div>
				<div>result: {{ JSON.stringify(issue.source.result) }}</div>
			</dl>
			<dl
				v-else-if="issue.source.type === 'property-dependency'"
				:class="pika({ margin: '0', fontFamily: 'var(--lab-font-mono)', color: 'var(--lab-color-text-muted)', display: 'flex', flexDirection: 'column', gap: '2px' })"
			>
				<div>dependency: {{ formatDependencyReference(issue.source.dependency) }}</div>
				<div v-if="'received' in issue.source">
					received: {{ JSON.stringify(issue.source.received) }}
				</div>
			</dl>
		</li>
	</ul>
</template>
