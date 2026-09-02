<script setup lang="ts">
/**
 * One State member row (diagnostic #13 Phase 5 "Runtime Inspector becomes strictly passive"): renders the
 * current passive inspection snapshot from `getSnapshot()` and updates on `subscribe()` notifications.
 * Never calls `state.get()`/`state.set()` — the readonly `RuntimeStateInspection` facade is the only
 * surface this component touches.
 */
import type { RuntimeStateInspection } from '@deviltea/widget-core/inspection'
import { computed } from 'vue'
import { useMemberSnapshot } from '../../composables/use-runtime-member'
import { createStateMemberViewModel } from '../../runtime-inspector/viewmodel'

const props = defineProps<{
	name: string
	inspection: RuntimeStateInspection<unknown>
	selected: boolean
}>()

const emit = defineEmits<{
	select: []
}>()

const snapshot = useMemberSnapshot(createStateMemberViewModel, () => props.inspection)
const displayValue = computed(() => JSON.stringify(snapshot.value?.value ?? null))
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
