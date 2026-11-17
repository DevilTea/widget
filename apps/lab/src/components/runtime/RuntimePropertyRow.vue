<script setup lang="ts">
import type { InspectorClient } from '@deviltea/widget-inspector/client'
import type { InspectorRuntimePropertySnapshot, WidgetRef } from '@deviltea/widget-inspector/protocol'
import { computed, ref } from 'vue'
import { useLabI18n } from '../../composables/use-lab-i18n'
import { useRemoteRuntimeMember } from '../../composables/use-remote-runtime-member'
import { formatInspectableValue } from '../../runtime-inspector/format-value'
import RuntimePropertyDiagnosticList from './RuntimePropertyDiagnosticList.vue'
import RuntimeValueRow from './RuntimeValueRow.vue'

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
/** The value to open as a tree: only a successful, evaluated Property has one. */
const okValue = computed(() => {
	const current = propertySnapshot.value
	return current !== null && current.status === 'completed' && current.result.ok ? current.result.value : null
})
const failedDiagnostics = computed(() => {
	const current = propertySnapshot.value
	return current !== null && current.status === 'completed' && !current.result.ok ? current.result.diagnostics : []
})
</script>

<template>
	<div>
		<RuntimeValueRow
			:name="name"
			:summary="statusLabel"
			:value="okValue"
			:selected="selected"
			:danger="failedDiagnostics.length > 0"
			@select="emit('select')"
		/>
		<div
			v-if="failedDiagnostics.length > 0"
			:class="pika({ paddingLeft: '30px', marginTop: '4px' })"
		>
			<button
				type="button"
				:class="pika({ fontSize: '11px', color: 'var(--lab-color-accent)', background: 'transparent', border: 'none', cursor: 'pointer', padding: '0 0 4px' })"
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
