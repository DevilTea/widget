<script setup lang="ts">
import type { InspectorClient } from '@deviltea/widget-inspector/client'
import type { InspectorRuntimeStateSnapshot, WidgetRef } from '@deviltea/widget-inspector/protocol'
import { computed } from 'vue'
import { useRemoteRuntimeMember } from '../../composables/use-remote-runtime-member'
import { formatInspectableValue } from '../../runtime-inspector/format-value'
import RuntimeValueRow from './RuntimeValueRow.vue'

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
const current = computed(() => snapshot.value)
const displayValue = computed(() => {
	const member = current.value
	return member?.type === 'state' ? formatInspectableValue(member.value) : '—'
})
</script>

<template>
	<RuntimeValueRow
		:name="name"
		:summary="displayValue"
		:value="current?.type === 'state' ? current.value : null"
		:selected="selected"
		@select="emit('select')"
	/>
</template>
