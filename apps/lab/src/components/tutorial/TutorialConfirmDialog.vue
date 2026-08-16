<script setup lang="ts">
/**
 * Dirty-draft confirmation for the deterministic Survey tour start (issue #25 OWNER decision — copy
 * locked verbatim). Shown only when `deterministic-start.ts`'s `decideDeterministicStart()` reports
 * `needsConfirmation` (the current showcase's draft Source differs from its applied snapshot); Cancel
 * leaves the draft/Runtime completely untouched — nothing is reloaded until "Start tour" confirms.
 */
import { useTutorialStore } from '../../composables/use-tutorial'

const tutorial = useTutorialStore()
</script>

<template>
	<div
		:class="pika({ position: 'absolute', inset: '0', zIndex: '600', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '24px', background: 'color-mix(in srgb, var(--lab-color-bg) 70%, transparent)' })"
	>
		<div
			role="alertdialog"
			aria-label="Replace unapplied changes?"
			:class="pika({ display: 'flex', flexDirection: 'column', gap: '12px', maxWidth: '400px', padding: '20px 22px', borderRadius: 'var(--lab-radius)', border: '1px solid var(--lab-color-border)', background: 'var(--lab-color-surface)', boxShadow: '0 12px 32px color-mix(in srgb, black 40%, transparent)' })"
		>
			<p :class="pika({ margin: '0', fontSize: '13px' })">
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
	</div>
</template>
