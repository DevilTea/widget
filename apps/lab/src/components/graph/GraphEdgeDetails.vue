<script setup lang="ts">
/**
 * Panel-local edge-selection details (issue #13 Phase 5 "inspector panel interaction contract": Graph
 * edge selection stays local, never expands into the shared cross-inspector focus). Shows the
 * dependency-container `path` and reference target/operation — both belong in edge details, never on the
 * canvas itself (issue #13 Phase 5 "Graph density"). #43 localizes only the fixed labels around those
 * facts; operation/status/target/path semantic payloads remain verbatim.
 */
import type { GraphEdgeData } from '../../graph/vue-flow'
import { computed } from 'vue'
import { useLabI18n } from '../../composables/use-lab-i18n'
import { formatDependencyOperation, formatDependencyTarget, formatIssuePath } from '../../lib/issue-format'

const props = defineProps<{
	edge: GraphEdgeData
}>()

const i18n = useLabI18n()
const pathLabel = computed(() => formatIssuePath(props.edge.path) ?? i18n.t('(root)'))
</script>

<template>
	<div :class="pika({ display: 'flex', flexDirection: 'column', gap: '4px', padding: '8px 10px', fontSize: '11px', fontFamily: 'var(--lab-font-mono)', borderTop: '1px solid var(--lab-color-border)', background: 'var(--lab-color-surface)' })">
		<div :class="pika({ display: 'flex', alignItems: 'center', gap: '6px' })">
			<span :class="pika({ fontSize: '10px', padding: '1px 5px', borderRadius: '999px', background: 'var(--lab-color-surface-alt)', color: 'var(--lab-color-text-muted)' })">{{ edge.operation }}</span>
			<span
				v-if="edge.stubStatus"
				:class="pika({ fontSize: '10px', color: 'var(--lab-color-danger)' })"
			>{{ edge.stubStatus }}</span>
			<span
				v-if="edge.invalidCycle"
				:class="pika({ fontSize: '10px', color: 'var(--lab-color-danger)' })"
			>{{ i18n.t('invalid cycle') }}</span>
		</div>
		<div>{{ i18n.t('target') }}: {{ formatDependencyTarget(edge.reference.target) }} -&gt; {{ formatDependencyOperation(edge.reference.operation) }}</div>
		<div>{{ i18n.t('path') }}: {{ pathLabel }}</div>
	</div>
</template>
