<script setup lang="ts">
/**
 * First-entry welcome card. #45 keeps the tutorial's pending welcome state intact below the supported
 * workbench width while suppressing this native top-layer dialog so the narrow-viewport gate owns the
 * visible/interactive experience. Widening reopens the same pending welcome state.
 */
import { useModalDialog } from '../../composables/use-modal-dialog'
import { useSupportedWorkbenchViewport } from '../../composables/use-supported-workbench-viewport'
import { useTutorialStore } from '../../composables/use-tutorial'

const tutorial = useTutorialStore()
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
		:class="pika({ 'padding': '0', 'border': 'none', 'background': 'transparent', '$::backdrop': { background: 'color-mix(in srgb, black 55%, transparent)' } })"
		@cancel="onCancel"
		@close="onNativeClose"
	>
		<div
			:class="pika({ display: 'flex', flexDirection: 'column', gap: '12px', maxWidth: '420px', padding: '20px 22px', borderRadius: 'var(--lab-radius)', border: '1px solid var(--lab-color-border)', background: 'var(--lab-color-surface)' })"
		>
			<h2
				id="welcome-card-title"
				:class="pika({ margin: '0', fontSize: '16px', lineHeight: '1.35' })"
			>
				Widget Lab lets you change a real app, then see where that behavior comes from.
			</h2>
			<p :class="pika({ margin: '0', fontSize: '13px', color: 'var(--lab-color-text-muted)' })">
				Start with one small interaction; we'll show what changed and why.
			</p>
			<div :class="pika({ display: 'flex', gap: '8px', marginTop: '4px' })">
				<button
					type="button"
					:class="pika({ padding: '6px 14px', fontSize: '12px', fontWeight: '600', borderRadius: 'var(--lab-radius)', border: '1px solid var(--lab-color-accent)', background: 'var(--lab-color-accent)', color: 'var(--lab-color-accent-contrast)', cursor: 'pointer' })"
					@click="tutorial.requestStart()"
				>
					Start the tour
				</button>
				<button
					type="button"
					:class="pika({ padding: '6px 14px', fontSize: '12px', borderRadius: 'var(--lab-radius)', border: '1px solid var(--lab-color-border)', background: 'var(--lab-color-surface-alt)', color: 'var(--lab-color-text)', cursor: 'pointer' })"
					@click="tutorial.dismissWelcome()"
				>
					Explore on my own
				</button>
			</div>
		</div>
	</dialog>
</template>
