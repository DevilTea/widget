<script setup lang="ts">
/**
 * One-line dismissable panel description. #43 translates only this Lab-owned explanatory copy; the
 * caller still owns the canonical English source string and no inspector/semantic payload is localized.
 */
import UButton from '@nuxt/ui/components/Button.vue'
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
		<!--
			First surface moved to Nuxt UI (issue #230 PR 2). `-my-1.5` lets the 24px target overlap the bar's
			padding so the bar keeps its height; `hover:bg-accented` because the bar itself is `surface-alt`,
			which is also Nuxt UI's `bg-elevated`, so the default ghost hover would be invisible here; `outline-primary` +
			`focus-visible:outline-2` replace the default 25%-opacity focus outline with a solid accent ring.
		-->
		<UButton
			icon="i-lucide-x"
			color="neutral"
			variant="ghost"
			size="xs"
			square
			class="-my-1.5 text-muted outline-primary hover:bg-accented hover:text-default focus-visible:outline-2"
			:aria-label="i18n.t('Dismiss')"
			@click="dismiss"
		/>
	</div>
</template>
