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
		class="flex items-center gap-[8px] p-[5px_10px] text-[11px] text-lab-text-muted bg-lab-surface-alt border-b border-b-lab-border flex-none"
	>
		<span class="flex-auto">{{ i18n.t(text) }}</span>
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
