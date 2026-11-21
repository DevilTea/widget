<script setup lang="ts">
/**
 * Presentation only: Core's diagnostics for a draft's document, each with its code, where its node sits in the source
 * (the JSON Pointer of `blueprint.getSourcePath(node)`, which is also a `SourcePatch` path), the plugin's `reason` when it
 * gave one, and Core's own English message. Nothing is interpreted here.
 */
import type { FindingDiagnostic } from '../domain'
import { formatPointer } from '../domain'
import { useRepairText } from './use-repair-text'

defineProps<{ diagnostics: readonly FindingDiagnostic[] }>()

const { t, tf } = useRepairText()
</script>

<template>
	<p
		v-if="diagnostics.length === 0"
		class="diagnostics-none"
	>
		{{ t('noDiagnostics') }}
	</p>
	<ul
		v-else
		class="diagnostics"
	>
		<li
			v-for="(diagnostic, index) in diagnostics"
			:key="index"
			class="diagnostic"
			data-testid="repair-diagnostic"
			:data-code="diagnostic.code"
		>
			<code class="diagnostic-code">{{ diagnostic.code }}</code>
			<span
				v-if="diagnostic.sourcePath !== null"
				class="diagnostic-path"
				data-testid="repair-diagnostic-path"
			>{{ tf('diagnosticAt', { path: formatPointer(diagnostic.sourcePath) }) }}</span>
			<span
				v-if="diagnostic.reason !== undefined"
				class="diagnostic-reason"
			>{{ tf('diagnosticReason', { reason: diagnostic.reason }) }}</span>
			<span class="diagnostic-message">{{ diagnostic.message }}</span>
		</li>
	</ul>
</template>

<style scoped>
.diagnostics {
	display: flex;
	flex-direction: column;
	gap: 6px;
	margin: 0;
	padding: 0;
	list-style: none;
}

.diagnostics-none {
	margin: 0;
	color: var(--repair-ok);
}

.diagnostic {
	display: flex;
	flex-wrap: wrap;
	align-items: baseline;
	gap: 2px 10px;
	padding: 6px 8px;
	border: 1px solid var(--repair-border);
	border-radius: var(--repair-radius);
	background: var(--repair-surface-alt);
	font-size: 13px;
}

.diagnostic-code,
.diagnostic-path,
.diagnostic-reason {
	font-family: var(--repair-font-mono);
	font-size: 12px;
}

.diagnostic-code {
	color: var(--repair-danger);
	font-weight: 600;
}

.diagnostic-path,
.diagnostic-reason {
	color: var(--repair-text-muted);
}

.diagnostic-message {
	flex-basis: 100%;
	color: var(--repair-text);
}
</style>
