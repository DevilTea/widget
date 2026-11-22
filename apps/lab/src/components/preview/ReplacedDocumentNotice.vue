<script setup lang="ts">
/**
 * "Loaded “<preset>”. Undo to get your edits back." (Lab UX phase 2, report item 10). Shown above the Preview after a preset
 * load (from the Examples menu or a tutorial start) replaced committed edits: that load is an ordinary commit, so instead of
 * asking first the Lab says what happened and offers Undo. It reads `LabStore.replacedNotice` and goes away with Undo, any later
 * commit, a showcase switch (the store clears or outdates it) or its own Dismiss.
 *
 * The wrapper is always in the page and is the live region, so the message is announced when it appears (a region inserted
 * together with its text is not reliably read). It is inline, above the Preview, like the stale-preview notice: nothing is
 * covered and nothing goes away on a timer. The phase 3 commit model can reuse it for other "this happened, Undo" notes.
 */
import UButton from '@nuxt/ui/components/Button.vue'
import { useLabI18n } from '../../composables/use-lab-i18n'
import { useLabStore } from '../../composables/use-lab-store'

const store = useLabStore()
const i18n = useLabI18n()

function onUndo(): void {
	if (store.canUndo.value)
		void store.undoLastApply()
}
</script>

<template>
	<div
		role="status"
		class="contents"
	>
		<div
			v-if="store.replacedNoticeVisible.value && store.replacedNotice.value !== null"
			data-testid="replaced-document-notice"
			class="mx-4 mt-2.5 flex flex-none flex-wrap items-center gap-x-2 gap-y-1 rounded-(--lab-radius) border border-(--lab-color-accent) bg-(--lab-color-surface-alt) px-2 py-1 text-[11px] text-(--lab-color-text)"
		>
			<span class="min-w-0 flex-1 wrap-anywhere">
				{{ i18n.t('Loaded “{subject}”. Undo to get your edits back.', { subject: i18n.t(store.replacedNotice.value.subject) }) }}
			</span>
			<UButton
				data-testid="replaced-document-undo"
				color="neutral"
				variant="outline"
				size="xs"
				icon="i-lucide-undo-2"
				:label="i18n.t('Undo')"
				:aria-label="i18n.t('Undo last change')"
				:aria-disabled="!store.canUndo.value"
				class="aria-disabled:opacity-50"
				@click="onUndo"
			/>
			<UButton
				data-testid="replaced-document-dismiss"
				color="neutral"
				variant="ghost"
				size="xs"
				square
				icon="i-lucide-x"
				:aria-label="i18n.t('Dismiss notice')"
				@click="store.dismissReplacedNotice()"
			/>
		</div>
	</div>
</template>
