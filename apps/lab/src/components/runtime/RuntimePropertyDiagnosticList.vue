<script setup lang="ts">
/** Renders a Property's immutable diagnostic snapshot using its canonical top-level code and fields. */
import type { BlueprintDependencyReference, DiagnosticPath, RuntimePropertyDiagnostic } from '@deviltea/widget-core'
import { formatDependencyReference, formatDiagnosticPath } from '../../lib/diagnostic-format'

defineProps<{
	diagnostics: readonly RuntimePropertyDiagnostic[]
}>()

function pathOf(diagnostic: RuntimePropertyDiagnostic): DiagnosticPath | undefined {
	return 'path' in diagnostic ? diagnostic.path : undefined
}

function resultOf(diagnostic: RuntimePropertyDiagnostic): unknown {
	return 'result' in diagnostic ? diagnostic.result : undefined
}

function dependencyOf(diagnostic: RuntimePropertyDiagnostic): BlueprintDependencyReference | undefined {
	return 'dependency' in diagnostic ? diagnostic.dependency : undefined
}

function receivedOf(diagnostic: RuntimePropertyDiagnostic): unknown {
	return 'received' in diagnostic ? diagnostic.received : undefined
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
				<div v-if="pathOf(diagnostic) !== undefined">
					path: {{ formatDiagnosticPath(pathOf(diagnostic)) }}
				</div>
				<div>result: {{ JSON.stringify(resultOf(diagnostic)) }}</div>
			</dl>
			<dl
				v-if="dependencyOf(diagnostic) !== undefined"
				:class="pika({ margin: '0', fontFamily: 'var(--lab-font-mono)', color: 'var(--lab-color-text-muted)', display: 'flex', flexDirection: 'column', gap: '2px' })"
			>
				<div>dependency: {{ formatDependencyReference(dependencyOf(diagnostic)!) }}</div>
				<div v-if="diagnostic.code === 'dependency-value-rejected'">
					received: {{ JSON.stringify(receivedOf(diagnostic)) }}
				</div>
			</dl>
		</li>
	</ul>
</template>
