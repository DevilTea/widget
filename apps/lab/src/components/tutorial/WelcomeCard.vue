<script setup lang="ts">
/**
 * First-entry welcome card (issue #25 P1 Scope B, copy locked by the gate review's point 1 and adopted
 * verbatim in Proposal v2): no architecture vocabulary, no showcase choice — Survey is the fixed
 * first-run tour, selectable from the persistent header entry point once dismissed. Dismissing (either
 * button, or Escape) never reappears again this session (`tutorial/session-flags.ts`'s
 * `welcome-dismissed` flag) and never blocks ordinary Lab use afterward.
 *
 * Built on `useModalDialog` (issue #25 P1 merge-gate review, blocker 1) — the same native
 * `showModal()`/focus-capture pattern `ModalRenderer.vue` proves — rather than a plain `<div>` overlay,
 * so the background workbench is genuinely `inert` (not just visually obscured) while this is showing.
 *
 * This component is always mounted (never `v-if`'d away in `App.vue`): `isOpen` alone, via
 * `useModalDialog`'s watcher, decides `showModal()`/`close()`. Escape policy (locked): safe-dismiss to
 * "Explore on my own" — `onCancel` below calls the exact same `dismissWelcome()` that button does, so
 * Escape can never leave the DOM closed while `welcomeVisible` (and therefore tutorial state) still
 * thinks it is open. Welcome has no click-initiator (it opens automatically on first load, not from a
 * button press) — `useModalDialog`'s captured "previously focused" element is typically `document.body`
 * here, so its focus-restore step is a documented no-op, not a real "return to caller" case.
 */
import { useModalDialog } from '../../composables/use-modal-dialog'
import { useTutorialStore } from '../../composables/use-tutorial'

const tutorial = useTutorialStore()

// `dialogRef` is intentionally not read directly here: `useModalDialog('dialog', ...)` owns the
// `showModal()`/`close()`/focus logic against the `ref="dialog"` element below by name — see
// `use-modal-dialog.ts`'s header for why the template's `eslint-disable` is narrowly justified.
const { onCancel, onNativeClose } = useModalDialog('dialog', {
	isOpen: tutorial.welcomeVisible,
	onCancel: () => tutorial.dismissWelcome(),
})
</script>

<template>
	<!-- eslint-disable vue/no-unused-refs -- `ref="dialog"` below is used by `useModalDialog('dialog', ...)` above, by name, in a different module; see this file's script header. -->
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
