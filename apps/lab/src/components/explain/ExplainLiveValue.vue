<script setup lang="ts">
/**
 * The current value of one State or Property of another widget, as the Explain tab's "why" sentences show it ("now: ...").
 * It subscribes to that member of the Preview Runtime through the Inspector client (`useRemoteRuntimeMember`), so it is live
 * and passive: a Property shows "not evaluated yet" until the Preview itself evaluated it, never a value forced by the Lab.
 */
import type { InspectorClient } from '@deviltea/widget-inspector/client'
import type { WidgetRef } from '@deviltea/widget-inspector/protocol'
import { computed } from 'vue'
import { useLabI18n } from '../../composables/use-lab-i18n'
import { useRemoteRuntimeMember } from '../../composables/use-remote-runtime-member'
import { formatInspectableValue } from '../../runtime-inspector/format-value'

const props = defineProps<{
	client: InspectorClient
	widgetRef: WidgetRef
	member: { readonly type: 'state' | 'property', readonly name: string }
}>()

const i18n = useLabI18n()
const snapshot = useRemoteRuntimeMember(
	() => props.client,
	() => props.widgetRef,
	() => ({ type: props.member.type, name: props.member.name }),
	() => null,
)

/** Longer summaries are cut here; the whole text is the tooltip, and "Current values" of that widget shows the tree. */
const SUMMARY_LENGTH = 60

const full = computed<{ text: string, kind: 'value' | 'empty' | 'status' | 'failed' } | null>(() => {
	const member = snapshot.value
	if (member === null)
		return null
	if (member.type === 'state')
		return member.value.type === 'null' ? { text: i18n.t('no value'), kind: 'empty' } : { text: formatInspectableValue(member.value), kind: 'value' }
	if (member.type !== 'property')
		return null
	const current = member.snapshot
	if (current.status === 'never-evaluated')
		return { text: i18n.t('not evaluated yet'), kind: 'status' }
	if (!current.result.ok)
		return { text: i18n.t('failed'), kind: 'failed' }
	return current.result.value.type === 'null'
		? { text: i18n.t('no value'), kind: 'empty' }
		: { text: formatInspectableValue(current.result.value), kind: 'value' }
})

const shown = computed(() => {
	const text = full.value?.text ?? '…'
	return text.length > SUMMARY_LENGTH ? `${text.slice(0, SUMMARY_LENGTH - 1)}…` : text
})
</script>

<template>
	<span
		data-testid="explain-live-value"
		:data-member="member.name"
		:data-value-kind="full?.kind ?? 'loading'"
		:title="full?.text"
	>
		<code
			v-if="full?.kind === 'value'"
			class="font-lab-mono"
			v-text="shown"
		/>
		<em
			v-else
			:class="full?.kind === 'failed' ? 'text-error' : 'text-muted'"
			v-text="shown"
		/>
	</span>
</template>
