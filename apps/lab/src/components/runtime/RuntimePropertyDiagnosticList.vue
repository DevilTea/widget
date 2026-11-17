<script setup lang="ts">
import type { InspectorDependencyReference, InspectorRuntimeDiagnostic } from '@deviltea/widget-inspector/protocol'
import type { InspectableValue } from '@deviltea/widget-inspector/value'
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
	<ul class="list-none m-0 p-0 flex flex-col gap-[6px]">
		<li
			v-for="(diagnostic, index) in diagnostics"
			:key="index"
			class="border border-lab-border rounded-lab p-[6px_8px] text-[11px] flex flex-col gap-[4px]"
		>
			<span class="font-lab-mono text-[11px] p-[1px_5px] rounded-[999px] bg-lab-surface-alt text-lab-text-muted self-start">
				{{ diagnostic.code }}
			</span>
			<div>{{ diagnostic.message }}</div>
			<dl
				v-if="diagnostic.code === 'invalid-property-result'"
				class="m-0 font-lab-mono text-lab-text-muted flex flex-col gap-[2px]"
			>
				<div v-if="diagnostic.path !== undefined">
					path: {{ formatDiagnosticPath(diagnostic.path) }}
				</div>
				<div>result: {{ valueText(diagnostic.result) }}</div>
			</dl>
			<dl
				v-if="diagnostic.dependency !== undefined"
				class="m-0 font-lab-mono text-lab-text-muted flex flex-col gap-[2px]"
			>
				<div>dependency: {{ dependencyText(diagnostic.dependency) }}</div>
				<div v-if="diagnostic.code === 'dependency-value-rejected'">
					received: {{ valueText(diagnostic.received) }}
				</div>
			</dl>
		</li>
	</ul>
</template>
