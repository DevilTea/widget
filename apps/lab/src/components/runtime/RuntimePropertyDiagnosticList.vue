<script setup lang="ts">
import type { InspectableValue, InspectorDependencyReference, InspectorRuntimeDiagnostic } from '@deviltea/widget-devtools'
import { formatDependencyReference, formatDiagnosticPath } from '../../lib/diagnostic-format'
import { formatInspectableValue } from '../../runtime-inspector/format-value'

defineProps<{
	diagnostics: readonly InspectorRuntimeDiagnostic[]
}>()

function valueText(value: InspectableValue | undefined): string {
	return value === undefined ? 'undefined' : formatInspectableValue(value)
}

function dependencyText(reference: InspectorDependencyReference): string {
	return formatDependencyReference(reference)
}
</script>

<template>
	<ul :class="pika({ listStyle: 'none', margin: '0', padding: '0', display: 'flex', flexDirection: 'column', gap: '6px' })">
		<li
			v-for="(diagnostic, index) in diagnostics"
			:key="index"
			:class="pika({ border: '1px solid var(--lab-color-border)', borderRadius: 'var(--lab-radius)', padding: '6px 8px', fontSize: '11px', display: 'flex', flexDirection: 'column', gap: '4px' })"
		>
			<span :class="pika({ fontFamily: 'var(--lab-font-mono)', fontSize: '10px', padding: '1px 5px', borderRadius: '999px', background: 'var(--lab-color-surface-alt)', color: 'var(--lab-color-text-muted)', alignSelf: 'flex-start' })">
				{{ diagnostic.code }}
			</span>
			<div>{{ diagnostic.message }}</div>
			<dl
				v-if="diagnostic.code === 'invalid-property-result'"
				:class="pika({ margin: '0', fontFamily: 'var(--lab-font-mono)', color: 'var(--lab-color-text-muted)', display: 'flex', flexDirection: 'column', gap: '2px' })"
			>
				<div v-if="diagnostic.path !== undefined">
					path: {{ formatDiagnosticPath(diagnostic.path) }}
				</div>
				<div>result: {{ valueText(diagnostic.result) }}</div>
			</dl>
			<dl
				v-if="diagnostic.dependency !== undefined"
				:class="pika({ margin: '0', fontFamily: 'var(--lab-font-mono)', color: 'var(--lab-color-text-muted)', display: 'flex', flexDirection: 'column', gap: '2px' })"
			>
				<div>dependency: {{ dependencyText(diagnostic.dependency) }}</div>
				<div v-if="diagnostic.code === 'dependency-value-rejected'">
					received: {{ valueText(diagnostic.received) }}
				</div>
			</dl>
		</li>
	</ul>
</template>
