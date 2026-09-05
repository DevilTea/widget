<script setup lang="ts">
/**
 * Panel-local edge-selection details (diagnostic #13 Phase 5 "inspector panel interaction contract": Graph
 * edge selection stays local, never expands into the shared cross-inspector focus). Shows the
 * dependency-container `path` and reference target/operation — both belong in edge details, never on the
 * canvas itself (diagnostic #13 Phase 5 "Graph density"). #43 localizes only the fixed labels around those
 * facts; operation/status/target/path semantic payloads remain verbatim.
 */
import type { BlueprintDependencyReference } from '@deviltea/widget-core'
import type { GraphEdgeOperation, GraphStubStatus } from '../../graph/types'
import type { GraphEdgeData } from '../../graph/vue-flow'
import { computed } from 'vue'
import { useLabI18n } from '../../composables/use-lab-i18n'
import { formatDependencyOperation, formatDependencyTarget, formatDiagnosticPath } from '../../lib/diagnostic-format'

interface DisplaySubEdge {
	readonly id: string
	readonly reference: BlueprintDependencyReference
	readonly operation: GraphEdgeOperation
	readonly path: readonly (string | number)[]
	readonly stubStatus?: GraphStubStatus
	readonly invalidCycle?: boolean
}

const props = defineProps<{
	edge: GraphEdgeData
}>()

const i18n = useLabI18n()

const semanticEdges = computed<readonly DisplaySubEdge[]>(() => {
	if (props.edge.semanticEdges && props.edge.semanticEdges.length > 0) {
		return props.edge.semanticEdges
	}
	return [{
		id: 'single',
		reference: props.edge.reference,
		operation: props.edge.operation,
		path: props.edge.path,
		stubStatus: props.edge.stubStatus,
		invalidCycle: props.edge.invalidCycle,
	}]
})
</script>

<template>
	<div :class="pika({ display: 'flex', flexDirection: 'column', gap: '8px', padding: '8px 10px', fontSize: '11px', fontFamily: 'var(--lab-font-mono)', borderTop: '1px solid var(--lab-color-border)', background: 'var(--lab-color-surface)', maxHeight: '160px', overflowY: 'auto' })">
		<div
			v-if="semanticEdges.length > 1"
			:class="pika({ fontSize: '11px', fontWeight: 'bold', color: 'var(--lab-color-text)' })"
		>
			{{ semanticEdges.length }} {{ i18n.t('aggregated dependencies') }}:
		</div>
		<div
			v-for="(subEdge, index) in semanticEdges"
			:key="subEdge.id || index"
			:class="[
				pika({ display: 'flex', flexDirection: 'column', gap: '2px' }),
				semanticEdges.length > 1 && index < semanticEdges.length - 1 ? pika({ borderBottom: '1px dashed var(--lab-color-border)', paddingBottom: '4px' }) : null,
			]"
		>
			<div :class="pika({ display: 'flex', alignItems: 'center', gap: '6px' })">
				<span :class="pika({ fontSize: '10px', padding: '1px 5px', borderRadius: '999px', background: 'var(--lab-color-surface-alt)', color: 'var(--lab-color-text-muted)' })">{{ subEdge.operation }}</span>
				<span
					v-if="subEdge.stubStatus"
					:class="pika({ fontSize: '10px', color: 'var(--lab-color-danger)' })"
				>{{ subEdge.stubStatus }}</span>
				<span
					v-if="subEdge.invalidCycle"
					:class="pika({ fontSize: '10px', color: 'var(--lab-color-danger)' })"
				>{{ i18n.t('invalid cycle') }}</span>
			</div>
			<div>{{ i18n.t('target') }}: {{ formatDependencyTarget(subEdge.reference.target) }} -&gt; {{ formatDependencyOperation(subEdge.reference.operation) }}</div>
			<div>{{ i18n.t('path') }}: {{ formatDiagnosticPath(subEdge.path) ?? i18n.t('(root)') }}</div>
		</div>
	</div>
</template>
