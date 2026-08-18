<script setup lang="ts">
/**
 * One Property member row (issue #13 Phase 5 "Runtime Inspector becomes strictly passive"): shows
 * `Never evaluated` until some real Runtime consumer naturally evaluates it, then the latest completed
 * `ExecutionResult` retained by core inspection — a success value, or a semantic failure rendered via
 * `RuntimePropertyIssueList`. Never labeled `fresh`/`dirty`/`active`/`stale`, and never forces evaluation
 * itself (only reads `getSnapshot()`/`subscribe()`). #43 translates only status/action chrome; the
 * Property name, successful value, and core RuntimePropertyIssue payload remain verbatim.
 */
import type { RuntimePropertyInspection } from '@deviltea/widget-core/inspection'
import { computed, ref } from 'vue'
import { useLabI18n } from '../../composables/use-lab-i18n'
import { useMemberSnapshot } from '../../composables/use-runtime-member'
import { createPropertyMemberViewModel } from '../../runtime-inspector/viewmodel'
import RuntimePropertyIssueList from './RuntimePropertyIssueList.vue'

const props = defineProps<{
	name: string
	inspection: RuntimePropertyInspection<unknown>
	selected: boolean
}>()

const emit = defineEmits<{
	select: []
}>()

const i18n = useLabI18n()
const snapshot = useMemberSnapshot(createPropertyMemberViewModel, () => props.inspection)
const showIssues = ref(false)

const statusLabel = computed(() => {
	const current = snapshot.value
	if (current === null || current.status === 'never-evaluated')
		return i18n.t('Never evaluated')
	return current.result.success
		? JSON.stringify(current.result.value)
		: i18n.t('Failed ({count} {issueWord})', {
				count: current.result.issues.length,
				issueWord: current.result.issues.length === 1 ? i18n.t('issue') : i18n.t('issues'),
			})
})

const failedIssues = computed(() => {
	const current = snapshot.value
	return current !== null && current.status === 'completed' && !current.result.success ? current.result.issues : []
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
				:style="{ color: failedIssues.length > 0 ? 'var(--lab-color-danger)' : 'var(--lab-color-text-muted)' }"
			>{{ statusLabel }}</span>
		</button>
		<div
			v-if="failedIssues.length > 0"
			:class="pika({ paddingLeft: '14px', marginTop: '4px' })"
		>
			<button
				type="button"
				:class="pika({ fontSize: '10px', color: 'var(--lab-color-accent)', background: 'transparent', border: 'none', cursor: 'pointer', padding: '0 0 4px' })"
				@click="showIssues = !showIssues"
			>
				{{ i18n.t(showIssues ? 'hide issues' : 'show issues') }}
			</button>
			<RuntimePropertyIssueList
				v-if="showIssues"
				:issues="failedIssues"
			/>
		</div>
	</div>
</template>
