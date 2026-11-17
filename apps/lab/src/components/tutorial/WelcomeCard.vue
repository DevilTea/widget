<script setup lang="ts">
/**
 * First-entry welcome card. #45 preserves pending welcome state below the supported workbench width while
 * suppressing the native top-layer dialog; #43 localizes only presentation copy.
 */
import { useLabI18n } from '../../composables/use-lab-i18n'
import { useModalDialog } from '../../composables/use-modal-dialog'
import { useSupportedWorkbenchViewport } from '../../composables/use-supported-workbench-viewport'
import { useTutorialStore } from '../../composables/use-tutorial'

const tutorial = useTutorialStore()
const i18n = useLabI18n()
const supportedViewport = useSupportedWorkbenchViewport()

const { onCancel, onNativeClose } = useModalDialog('dialog', {
	isOpen: tutorial.welcomeVisible,
	canShowModal: supportedViewport,
	onCancel: () => tutorial.dismissWelcome(),
})
</script>

<template>
	<!-- eslint-disable vue/no-unused-refs -- consumed by `useModalDialog('dialog', ...)`. -->
	<dialog
		ref="dialog"
		aria-labelledby="welcome-card-title"
		class="p-0 [border:none] bg-transparent backdrop:[background:color-mix(in_srgb,black_55%,transparent)]"
		@cancel="onCancel"
		@close="onNativeClose"
	>
		<div
			class="flex flex-col gap-[12px] max-w-[420px] p-[20px_22px] rounded-lab border border-lab-border bg-lab-surface"
		>
			<h2
				id="welcome-card-title"
				class="m-0 text-[16px] leading-[1.35]"
			>
				{{ i18n.t('Widget Lab lets you change a real app, then see where that behavior comes from.') }}
			</h2>
			<p class="m-0 text-[13px] text-lab-text-muted">
				{{ i18n.t("Start with one small interaction; we'll show what changed and why.") }}
			</p>
			<div class="flex gap-[8px] mt-[4px]">
				<button
					type="button"
					class="p-[6px_14px] text-[12px] font-semibold rounded-lab border border-lab-accent bg-lab-accent text-lab-accent-contrast cursor-pointer"
					@click="tutorial.requestStart()"
				>
					{{ i18n.t('Start the tour') }}
				</button>
				<button
					type="button"
					class="p-[6px_14px] text-[12px] rounded-lab border border-lab-border bg-lab-surface-alt text-lab-text cursor-pointer"
					@click="tutorial.dismissWelcome()"
				>
					{{ i18n.t('Explore on my own') }}
				</button>
			</div>
		</div>
	</dialog>
</template>
