<script setup lang="ts">
/**
 * Confirmation shown when loading a preset or switching showcase would replace an unapplied editor draft
 * (audit U03), or when a showcase switch would drop committed edits that Undo cannot restore (Lab UX phase 2). Same native-`<dialog>` modal pattern as the tutorial's dirty-draft confirmation
 * (`tutorial/TutorialConfirmDialog.vue`, `useModalDialog`): the store's `confirmVisible` is the single source
 * of truth, Escape/backdrop-less close means "keep editing", and focus returns to the control that asked.
 * "Keep editing" comes first so it takes the initial focus: the destructive choice is never the default.
 */
import UButton from '@nuxt/ui/components/Button.vue'
import { computed } from 'vue'
import { useDraftGuard } from '../composables/use-draft-guard'
import { useLabI18n } from '../composables/use-lab-i18n'
import { useModalDialog } from '../composables/use-modal-dialog'
import { useSupportedWorkbenchViewport } from '../composables/use-supported-workbench-viewport'

const guard = useDraftGuard()
const i18n = useLabI18n()
const supportedViewport = useSupportedWorkbenchViewport()

/** One dialog names everything the action discards (Lab UX phase 2): the draft, committed edits Undo cannot restore, or both. */
const title = computed(() => i18n.t(guard.loss.value === 'draft' ? 'Discard unapplied changes?' : guard.loss.value === 'edits' ? 'Discard your edits?' : 'Discard your changes?'))
const body = computed(() => {
	const subject = i18n.t(guard.subject.value)
	switch (guard.loss.value) {
		case 'edits': return i18n.t('You edited this document. Opening “{subject}” replaces it, and Undo cannot bring your edits back.', { subject })
		case 'draft-and-edits': return i18n.t('The JSON editor has changes that were not applied, and you edited this document. Opening “{subject}” discards both, and Undo cannot bring them back.', { subject })
		default: return i18n.t('The JSON editor has changes that were not applied. Loading “{subject}” will discard them.', { subject })
	}
})

const { onCancel, onNativeClose } = useModalDialog('dialog', {
	isOpen: guard.confirmVisible,
	canShowModal: supportedViewport,
	onCancel: () => guard.cancel(),
})
</script>

<template>
	<!-- eslint-disable vue/no-unused-refs -- consumed by `useModalDialog('dialog', ...)`. -->
	<dialog
		ref="dialog"
		data-testid="draft-guard-dialog"
		role="alertdialog"
		aria-labelledby="draft-guard-dialog-title"
		aria-describedby="draft-guard-dialog-body"
		class="m-auto border-0 bg-transparent p-0 backdrop:bg-black/55"
		@cancel="onCancel"
		@close="onNativeClose"
	>
		<div class="flex max-w-md flex-col gap-3 rounded-(--lab-radius) border border-default bg-default p-5 text-default shadow-lg">
			<h2
				id="draft-guard-dialog-title"
				class="m-0 text-sm font-semibold"
			>
				{{ title }}
			</h2>
			<p
				id="draft-guard-dialog-body"
				:data-loss="guard.loss.value"
				class="m-0 text-sm text-muted"
			>
				{{ body }}
			</p>
			<div class="mt-1 flex justify-end gap-2">
				<UButton
					data-testid="draft-guard-keep"
					color="neutral"
					variant="outline"
					size="sm"
					:label="i18n.t('Keep editing')"
					@click="guard.cancel()"
				/>
				<UButton
					data-testid="draft-guard-discard"
					color="error"
					size="sm"
					:label="i18n.t('Discard changes')"
					@click="guard.confirm()"
				/>
			</div>
		</div>
	</dialog>
</template>
