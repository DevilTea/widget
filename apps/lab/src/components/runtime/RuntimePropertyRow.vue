<script setup lang="ts">
import type { InspectorClient, InspectorRuntimePropertySnapshot, WidgetRef } from '@deviltea/widget-devtools'
import { computed, ref } from 'vue'
import { useLabI18n } from '../../composables/use-lab-i18n'
import { useRemoteRuntimeMember } from '../../composables/use-remote-runtime-member'
import { formatInspectableValue } from '../../runtime-inspector/format-value'
import RuntimePropertyDiagnosticList from './RuntimePropertyDiagnosticList.vue'

const props = defineProps<{
	name: string
	client: InspectorClient
	widgetRef: WidgetRef
	initial: InspectorRuntimePropertySnapshot
	selected: boolean
}>()

const emit = defineEmits<{ select: [] }>()
const i18n = useLabI18n()
const showDiagnostics = ref(false)
const snapshot = useRemoteRuntimeMember(
	() => props.client,
	() => props.widgetRef,
	() => ({ type: 'property', name: props.name }),
	() => props.initial,
)

const propertySnapshot = computed(() => snapshot.value?.type === 'property' ? snapshot.value.snapshot : null)
const statusLabel = computed(() => {
	const current = propertySnapshot.value
	if (current === null || current.status === 'never-evaluated')
		return i18n.t('Never evaluated')
	return current.result.ok
		? formatInspectableValue(current.result.value)
		: i18n.t('Failed ({count} {diagnosticWord})', {
				count: current.result.diagnostics.length,
				diagnosticWord: current.result.diagnostics.length === 1 ? i18n.t('diagnostic') : i18n.t('diagnostics'),
			})
})
const failedDiagnostics = computed(() => {
	const current = propertySnapshot.value
	return current !== null && current.status === 'completed' && !current.result.ok ? current.result.diagnostics : []
})
</script>

<template>
	<div>
		<button
			type="button"
			:class="pika({ display: 'flex', alignItems: 'center', gap: '8px', width: '100%', textAlign: 'left', border: 'none', borderRadius: 'var(--lab-radius)', padding: '4px 6px', fontSize: '11px', fontFamily: 'var(--lab-font-mono)', color: 'var(--lab-color-text)', cursor: 'pointer' })"
			:style="{ background: selected ? 'var(--lab-color-surface-alt)' : 'transparent' }"
			@click="emit('select')"
		>
			<span>{{ name }}</span>
			<span
				:class="pika({ marginLeft: 'auto', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: '160px' })"
				:style="{ color: failedDiagnostics.length > 0 ? 'var(--lab-color-danger)' : 'var(--lab-color-text-muted)' }"
			>{{ statusLabel }}</span>
		</button>
		<div
			v-if="failedDiagnostics.length > 0"
			:class="pika({ paddingLeft: '14px', marginTop: '4px' })"
		>
			<button
				type="button"
				:class="pika({ fontSize: '10px', color: 'var(--lab-color-accent)', background: 'transparent', border: 'none', cursor: 'pointer', padding: '0 0 4px' })"
				@click="showDiagnostics = !showDiagnostics"
			>
				{{ i18n.t(showDiagnostics ? 'hide diagnostics' : 'show diagnostics') }}
			</button>
			<RuntimePropertyDiagnosticList
				v-if="showDiagnostics"
				:diagnostics="failedDiagnostics"
			/>
		</div>
	</div>
</template>
