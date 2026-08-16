<script setup lang="ts">
/**
 * Dirty-draft confirmation for the deterministic Survey tour start (issue #25 OWNER decision — copy
 * locked verbatim). Shown only when `deterministic-start.ts`'s `decideDeterministicStart()` reports
 * `needsConfirmation` (the current showcase's draft Source differs from its applied snapshot); Cancel
 * (button or Escape) leaves the draft/Runtime completely untouched — nothing is reloaded until "Start
 * tour" confirms.
 *
 * Built on `useModalDialog` (issue #25 P1 merge-gate review, blocker 1) — native `showModal()`/focus
 * capture, same as `WelcomeCard.vue`/`ModalRenderer.vue` — rather than a plain `<div>` overlay. Escape
 * policy (locked): the safe Cancel path — `onCancel` below calls the exact same `cancelStart()` the
 * "Cancel" button does, so Escape can never leave the draft ambiguously "maybe about to be replaced".
 * Unlike Welcome, this dialog always has a real initiator (the header's Tutorial/Restart button, or
 * Welcome's "Start the tour"): `useModalDialog` captures whatever had focus right before `showModal()`
 * and restores it on close, so closing/cancelling returns focus to whichever control opened it.
 *
 * Always mounted (never `v-if`'d away in `App.vue`) — `isOpen` alone drives `showModal()`/`close()`.
 */
import { useModalDialog } from '../../composables/use-modal-dialog'
import { useTutorialStore } from '../../composables/use-tutorial'

const tutorial = useTutorialStore()

// `dialogRef` is intentionally not read directly here: `useModalDialog('dialog', ...)` owns the
// `showModal()`/`close()`/focus logic against the `ref="dialog"` element below by name — see
// `use-modal-dialog.ts`'s header for why the template's `eslint-disable` is narrowly justified.
const { onCancel, onNativeClose } = useModalDialog('dialog', {
	isOpen: tutorial.confirmVisible,
	onCancel: () => tutorial.cancelStart(),
})
</script>

<template>
	<!-- eslint-disable vue/no-unused-refs -- `ref="dialog"` below is used by `useModalDialog('dialog', ...)` above, by name, in a different module; see this file's script header. -->
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
				Starting the tutorial will load the Survey teaching example and replace your unapplied changes.
			</p>
			<div :class="pika({ display: 'flex', gap: '8px', marginTop: '4px' })">
				<button
					type="button"
					:class="pika({ padding: '6px 14px', fontSize: '12px', fontWeight: '600', borderRadius: 'var(--lab-radius)', border: '1px solid var(--lab-color-accent)', background: 'var(--lab-color-accent)', color: 'var(--lab-color-accent-contrast)', cursor: 'pointer' })"
					@click="tutorial.confirmStart()"
				>
					Start tour
				</button>
				<button
					type="button"
					:class="pika({ padding: '6px 14px', fontSize: '12px', borderRadius: 'var(--lab-radius)', border: '1px solid var(--lab-color-border)', background: 'var(--lab-color-surface-alt)', color: 'var(--lab-color-text)', cursor: 'pointer' })"
					@click="tutorial.cancelStart()"
				>
					Cancel
				</button>
			</div>
		</div>
	</dialog>
</template>
