<script setup lang="ts">
/**
 * First-entry welcome card (issue #25 P1 Scope B, copy locked by the gate review's point 1 and adopted
 * verbatim in Proposal v2): no architecture vocabulary, no showcase choice — Survey is the fixed
 * first-run tour, selectable from the persistent header entry point once dismissed. Centered over the
 * workbench; dismissing (either button) never reappears again this session
 * (`tutorial/session-flags.ts`'s `welcome-dismissed` flag) and never blocks ordinary Lab use afterward.
 */
import { useTutorialStore } from '../../composables/use-tutorial'

const tutorial = useTutorialStore()
</script>

<template>
	<div
		:class="pika({ position: 'absolute', inset: '0', zIndex: '500', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '24px', background: 'color-mix(in srgb, var(--lab-color-bg) 70%, transparent)' })"
	>
		<div
			role="dialog"
			aria-label="Welcome to Widget Lab"
			:class="pika({ display: 'flex', flexDirection: 'column', gap: '12px', maxWidth: '420px', padding: '20px 22px', borderRadius: 'var(--lab-radius)', border: '1px solid var(--lab-color-border)', background: 'var(--lab-color-surface)', boxShadow: '0 12px 32px color-mix(in srgb, black 40%, transparent)' })"
		>
			<h2 :class="pika({ margin: '0', fontSize: '16px', lineHeight: '1.35' })">
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
	</div>
</template>
