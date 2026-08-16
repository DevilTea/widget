<script setup lang="ts">
/**
 * One-line, dismissable first-use description bar (issue #25 P1 Scope F "explanatory UI copy" —
 * "first-use descriptions should explain them in plain language"). Dismissed per browser session via
 * `useDismissableNotice` (`sessionStorage`), never reappearing until a new session; every panel keeps
 * its own `storageKey` so dismissing one never hides another.
 */
import { useDismissableNotice } from '../composables/use-dismissable-notice'

const props = defineProps<{
	storageKey: string
	text: string
}>()

const { dismissed, dismiss } = useDismissableNotice(props.storageKey)
</script>

<template>
	<div
		v-if="!dismissed"
		:class="pika({ display: 'flex', alignItems: 'center', gap: '8px', padding: '5px 10px', fontSize: '11px', color: 'var(--lab-color-text-muted)', background: 'var(--lab-color-surface-alt)', borderBottom: '1px solid var(--lab-color-border)', flex: '0 0 auto' })"
	>
		<span :class="pika({ flex: '1 1 auto' })">{{ text }}</span>
		<button
			type="button"
			aria-label="Dismiss"
			:class="pika({ padding: '0 4px', fontSize: '13px', lineHeight: '1', border: 'none', background: 'transparent', color: 'var(--lab-color-text-muted)', cursor: 'pointer' })"
			@click="dismiss"
		>
			×
		</button>
	</div>
</template>
