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
		:class="pika({ 'padding': '0', 'border': 'none', 'background': 'transparent', '$::backdrop': { background: 'color-mix(in srgb, black 55%, transparent)' } })"
		@cancel="onCancel"
		@close="onNativeClose"
	>
		<div
			:class="pika({ display: 'flex', flexDirection: 'column', gap: '12px', maxWidth: '400px', padding: '20px 22px', borderRadius: 'var(--lab-radius)', border: '1px solid var(--lab-color-border)', background: 'var(--lab-color-surface)' })"
		>
			<p
				id="tutorial-confirm-dialog-title"
				:class="pika({ margin: '0', fontSize: '13px' })"
			>
				{{ i18n.t('Starting the tutorial will load the Survey teaching example and replace your unapplied changes.') }}
			</p>
			<div :class="pika({ display: 'flex', gap: '8px', marginTop: '4px' })">
				<button
					type="button"
					:class="pika({ padding: '6px 14px', fontSize: '12px', fontWeight: '600', borderRadius: 'var(--lab-radius)', border: '1px solid var(--lab-color-accent)', background: 'var(--lab-color-accent)', color: 'var(--lab-color-accent-contrast)', cursor: 'pointer' })"
					@click="tutorial.confirmStart()"
				>
					{{ i18n.t('Start tour') }}
				</button>
				<button
					type="button"
					:class="pika({ padding: '6px 14px', fontSize: '12px', borderRadius: 'var(--lab-radius)', border: '1px solid var(--lab-color-border)', background: 'var(--lab-color-surface-alt)', color: 'var(--lab-color-text)', cursor: 'pointer' })"
					@click="tutorial.cancelStart()"
				>
					{{ i18n.t('Cancel') }}
				</button>
			</div>
		</div>
	</dialog>
</template>
