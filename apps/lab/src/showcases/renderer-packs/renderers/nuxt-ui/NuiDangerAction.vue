<script setup lang="ts">
/**
 * Nuxt UI pack. Presentation only: a `UButton` that calls Method `ask()` and a `UModal` that is open while State `confirming`
 * is true. The modal is teleported into the pack's overlay container (`UApp`'s portal), which is inside the Preview frame
 * document, so its overlay, its focus trap and its scroll lock are the frame's: the Lab shell around the iframe stays operable.
 * Confirm and Cancel call the Methods; closing the modal (Esc, the close button) is Cancel. Whether confirming is allowed, and
 * what it notifies, is the plugin's.
 *
 * Side by side, the modal is drawn by the pack whose button asked (`PacksHost`), so a page has one open confirmation.
 */

import { useWidget } from '@deviltea/widget-vue'
import UButton from '@nuxt/ui/components/Button.vue'
import UModal from '@nuxt/ui/components/Modal.vue'
import { computed } from 'vue'
import { useInspectAnchor } from '../../../../showcase-host'
import { DangerActionPlugin } from '../../plugins/danger-action'
import { usePacksHost, usePacksText } from '../use-packs-text'

const { useState, useProperties, useMethods, widgetId, widgetType } = useWidget(DangerActionPlugin)
const { confirming } = useState()
const { label, confirmText, density } = useProperties()
const { ask, cancel, confirm } = useMethods()
const { t, text } = usePacksText()
const { host, ownsDialog } = usePacksHost('nui')
const anchor = useInspectAnchor(widgetId, widgetType)

const asking = computed(() => confirming.value === true)
const open = computed({
	get: () => asking.value && ownsDialog(widgetId),
	// Esc, the close button and a click outside all close the modal: State says the question is over.
	set: (next) => {
		if (!next && asking.value)
			cancel()
	},
})
const elsewhere = computed(() => asking.value && !open.value)

function onAsk(): void {
	host.noteAsker(widgetId, 'nui')
	ask()
}
</script>

<template>
	<div
		v-bind="anchor"
		:data-tutorial-target="`packs-${widgetId}`"
		class="flex flex-wrap items-center gap-x-3 gap-y-2"
	>
		<UButton
			color="error"
			variant="outline"
			:size="density === 'compact' ? 'sm' : 'md'"
			aria-haspopup="dialog"
			:label="label === null ? widgetId : text(label)"
			:data-testid="`nui-ask-${widgetId}`"
			@click="onAsk"
		/>
		<p
			v-if="elsewhere"
			class="text-sm text-muted"
		>
			{{ t('confirmingElsewhere') }}
		</p>
		<UModal
			v-model:open="open"
			:title="t('confirmTitle')"
			:description="confirmText === null ? undefined : text(confirmText)"
			:close="{ 'aria-label': t('cancel') }"
			:data-testid="`nui-dialog-${widgetId}`"
		>
			<template #footer>
				<div class="flex w-full justify-end gap-2">
					<UButton
						color="neutral"
						variant="outline"
						:label="t('cancel')"
						:data-testid="`nui-cancel-${widgetId}`"
						@click="cancel()"
					/>
					<UButton
						color="error"
						:label="t('confirm')"
						:data-testid="`nui-confirm-${widgetId}`"
						@click="confirm()"
					/>
				</div>
			</template>
		</UModal>
	</div>
</template>
