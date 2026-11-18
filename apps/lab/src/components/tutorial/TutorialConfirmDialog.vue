<script setup lang="ts">
/**
 * Dirty-draft confirmation for deterministic tutorial start. #45 preserves the pending confirmation
 * below the supported workbench width but suppresses the native top-layer dialog; #43 localizes only
 * the visible presentation copy.
 */
import { useLabI18n } from '../../composables/use-lab-i18n'
import { useModalDialog } from '../../composables/use-modal-dialog'
import { useSupportedWorkbenchViewport } from '../../composables/use-supported-workbench-viewport'
import { useTutorialStore } from '../../composables/use-tutorial'

const tutorial = useTutorialStore()
const i18n = useLabI18n()
const supportedViewport = useSupportedWorkbenchViewport()

const { onCancel, onNativeClose } = useModalDialog('dialog', {
	isOpen: tutorial.confirmVisible,
	canShowModal: supportedViewport,
	onCancel: () => tutorial.cancelStart(),
})
</script>

<template>
	<!-- eslint-disable vue/no-unused-refs -- consumed by `useModalDialog('dialog', ...)`. -->
	<dialog
		ref="dialog"
		role="alertdialog"
		aria-labelledby="tutorial-confirm-dialog-title"
		class="p-0 [border:none] bg-transparent backdrop:[background:color-mix(in_srgb,black_55%,transparent)]"
		@cancel="onCancel"
		@close="onNativeClose"
	>
		<div
			class="flex flex-col gap-[12px] max-w-[400px] p-[20px_22px] rounded-lab border border-lab-border bg-lab-surface"
		>
			<p
				id="tutorial-confirm-dialog-title"
				class="m-0 text-[13px]"
			>
				{{ i18n.t(tutorial.confirmMessage.value) }}
			</p>
			<div class="flex gap-[8px] mt-[4px]">
				<button
					type="button"
					class="p-[6px_14px] text-[12px] font-semibold rounded-lab border border-lab-accent bg-lab-accent text-lab-accent-contrast cursor-pointer"
					@click="tutorial.confirmStart()"
				>
					{{ i18n.t('Start tour') }}
				</button>
				<button
					type="button"
					class="p-[6px_14px] text-[12px] rounded-lab border border-lab-border bg-lab-surface-alt text-lab-text cursor-pointer"
					@click="tutorial.cancelStart()"
				>
					{{ i18n.t('Cancel') }}
				</button>
			</div>
		</div>
	</dialog>
</template>
