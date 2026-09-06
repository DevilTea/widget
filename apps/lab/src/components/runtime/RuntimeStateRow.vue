<script setup lang="ts">
import type { InspectorClient, InspectorRuntimeStateSnapshot, WidgetRef } from '@deviltea/widget-devtools'
import { computed } from 'vue'
import { useRemoteRuntimeMember } from '../../composables/use-remote-runtime-member'
import { formatInspectableValue } from '../../runtime-inspector/format-value'

const props = defineProps<{
	name: string
	client: InspectorClient
	widgetRef: WidgetRef
	initial: InspectorRuntimeStateSnapshot
	selected: boolean
}>()

const emit = defineEmits<{ select: [] }>()

const snapshot = useRemoteRuntimeMember(
	() => props.client,
	() => props.widgetRef,
	() => ({ type: 'state', name: props.name }),
	() => props.initial,
)
const displayValue = computed(() => {
	const current = snapshot.value
	return current?.type === 'state' ? formatInspectableValue(current.value) : '—'
})
</script>

<template>
	<button
		type="button"
		:class="pika({ display: 'flex', alignItems: 'center', gap: '8px', width: '100%', textAlign: 'left', border: 'none', borderRadius: 'var(--lab-radius)', padding: '4px 6px', fontSize: '11px', fontFamily: 'var(--lab-font-mono)', color: 'var(--lab-color-text)', cursor: 'pointer' })"
		:style="{ background: selected ? 'var(--lab-color-surface-alt)' : 'transparent' }"
		@click="emit('select')"
	>
		<span>{{ name }}</span>
		<span :class="pika({ marginLeft: 'auto', color: 'var(--lab-color-text-muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: '160px' })">{{ displayValue }}</span>
	</button>
</template>
