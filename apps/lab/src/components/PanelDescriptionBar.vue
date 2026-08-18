<script setup lang="ts">
/**
 * One-line dismissable panel description. #43 translates only this Lab-owned explanatory copy; the
 * caller still owns the canonical English source string and no inspector/semantic payload is localized.
 */
import { useDismissableNotice } from '../composables/use-dismissable-notice'
import { useLabI18n } from '../composables/use-lab-i18n'

const props = defineProps<{
	storageKey: string
	text: string
}>()

const { dismissed, dismiss } = useDismissableNotice(props.storageKey)
const i18n = useLabI18n()
</script>

<template>
	<div
		v-if="!dismissed"
		:class="pika({ display: 'flex', alignItems: 'center', gap: '8px', padding: '5px 10px', fontSize: '11px', color: 'var(--lab-color-text-muted)', background: 'var(--lab-color-surface-alt)', borderBottom: '1px solid var(--lab-color-border)', flex: '0 0 auto' })"
	>
		<span :class="pika({ flex: '1 1 auto' })">{{ i18n.t(text) }}</span>
		<button
			type="button"
			:aria-label="i18n.t('Dismiss')"
			:class="pika({ padding: '0 4px', fontSize: '13px', lineHeight: '1', border: 'none', background: 'transparent', color: 'var(--lab-color-text-muted)', cursor: 'pointer' })"
			@click="dismiss"
		>
			×
		</button>
	</div>
</template>
