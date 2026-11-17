<script setup lang="ts">
/**
 * Confirmation shown when loading a preset or switching showcase would replace an unapplied editor draft
 * (audit U03). Same native-`<dialog>` modal pattern as the tutorial's dirty-draft confirmation
 * (`tutorial/TutorialConfirmDialog.vue`, `useModalDialog`): the store's `confirmVisible` is the single source
 * of truth, Escape/backdrop-less close means "keep editing", and focus returns to the control that asked.
 * "Keep editing" comes first so it takes the initial focus: the destructive choice is never the default.
 */
import UButton from '@nuxt/ui/components/Button.vue'
import { useDraftGuard } from '../composables/use-draft-guard'
import { useLabI18n } from '../composables/use-lab-i18n'
import { useModalDialog } from '../composables/use-modal-dialog'
import { useSupportedWorkbenchViewport } from '../composables/use-supported-workbench-viewport'

const guard = useDraftGuard()
const i18n = useLabI18n()
const supportedViewport = useSupportedWorkbenchViewport()

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
				{{ i18n.t('Discard unapplied changes?') }}
			</h2>
			<p
				id="draft-guard-dialog-body"
				class="m-0 text-sm text-muted"
			>
				{{ i18n.t('The JSON editor has changes that were not applied. Loading “{subject}” will discard them.', { subject: i18n.t(guard.subject.value) }) }}
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
