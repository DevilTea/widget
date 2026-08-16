<script setup lang="ts">
/**
 * The tutorial rail (issue #25 P1 Scope E): a fixed-width column OUTSIDE Dockview, rendered only while
 * the tour is `'active'` (see `App.vue`). Chosen viewport mechanism (gate review point 10 / Proposal v2
 * "Tutorial rail viewport contract"): the rail is an always-`position: fixed` overlay docked to the
 * workbench's right edge, never a flex-layout participant — `Workbench.vue`'s own width (and therefore
 * Dockview's measured container size) is completely unaffected by whether the rail is open, at ANY
 * viewport width, including the existing 900px minimum-supported-width boundary (issue #27). This is
 * simpler than a width-dependent compress/overlay switch and satisfies the contract unconditionally
 * rather than only below a second breakpoint; `e2e/tutorial.spec.ts`'s geometry contract test pins this
 * at exactly the 900px boundary, the tightest case the existing narrow-viewport gate already recognizes
 * as supported.
 *
 * Spotlight (CSS class toggling, no position-cloned overlay) is driven from `App.vue`, which is the one
 * place with an unobstructed view of the whole document to `querySelector` a step's
 * `data-tutorial-target` element.
 */
import { computed } from 'vue'
import { useTutorialStore } from '../../composables/use-tutorial'

const tutorial = useTutorialStore()
const snapshot = computed(() => tutorial.snapshot.value)
const step = computed(() => snapshot.value.step)
const nextLabel = computed(() => (snapshot.value.isLastStep ? (step.value?.finishLabel ?? 'Finish') : 'Next'))
</script>

<template>
	<aside
		aria-label="Tutorial"
		:class="pika({
			position: 'fixed',
			top: '0',
			bottom: '0',
			right: '0',
			width: '320px',
			zIndex: '400',
			display: 'flex',
			flexDirection: 'column',
			borderLeft: '1px solid var(--lab-color-border)',
			background: 'var(--lab-color-surface)',
			boxShadow: '-8px 0 24px color-mix(in srgb, black 30%, transparent)',
		})"
	>
		<header
			:class="pika({ display: 'flex', alignItems: 'center', gap: '8px', padding: '10px 12px', borderBottom: '1px solid var(--lab-color-border)', flex: '0 0 auto' })"
		>
			<strong :class="pika({ fontSize: '12px' })">Tutorial</strong>
			<span :class="pika({ fontSize: '11px', color: 'var(--lab-color-text-muted)' })">
				Step {{ snapshot.stepIndex + 1 }} of {{ snapshot.stepCount }}
			</span>
			<button
				type="button"
				aria-label="Close tutorial"
				:class="pika({ marginLeft: 'auto', padding: '0 4px', fontSize: '14px', lineHeight: '1', border: 'none', background: 'transparent', color: 'var(--lab-color-text-muted)', cursor: 'pointer' })"
				@click="tutorial.pause()"
			>
				×
			</button>
		</header>

		<div
			v-if="step"
			:class="pika({ flex: '1 1 auto', minHeight: '0', overflow: 'auto', padding: '12px', display: 'flex', flexDirection: 'column', gap: '8px' })"
		>
			<h3 :class="pika({ margin: '0', fontSize: '13px' })">
				{{ step.title }}
			</h3>

			<p
				v-for="(text, index) in snapshot.revealed"
				:key="index"
				:class="pika({ margin: '0', fontSize: '12px', lineHeight: '1.5' })"
			>
				{{ text }}
			</p>
			<p
				v-if="snapshot.pendingPrompt"
				:class="pika({ margin: '0', fontSize: '12px', lineHeight: '1.5', fontStyle: 'italic', color: 'var(--lab-color-text-muted)' })"
			>
				{{ snapshot.pendingPrompt }}
			</p>

			<ul
				v-if="step.links"
				:class="pika({ display: 'flex', flexDirection: 'column', gap: '4px', margin: '4px 0 0', padding: '0', listStyle: 'none' })"
			>
				<li
					v-for="link in step.links"
					:key="link.id"
				>
					<button
						type="button"
						:disabled="link.disabled"
						:class="pika({ 'width': '100%', 'textAlign': 'left', 'padding': '5px 8px', 'fontSize': '11px', 'borderRadius': 'var(--lab-radius)', 'border': '1px solid var(--lab-color-border)', 'background': 'var(--lab-color-surface-alt)', 'color': 'var(--lab-color-text)', 'cursor': 'pointer', '$:disabled': { opacity: '0.5', cursor: 'not-allowed' } })"
						@click="tutorial.runLink(link.id)"
					>
						{{ link.label }}<span v-if="link.note"> ({{ link.note }})</span>
					</button>
				</li>
			</ul>
		</div>

		<footer
			:class="pika({ 'display': 'flex', 'gap': '8px', 'padding': '10px 12px', 'borderTop': '1px solid var(--lab-color-border)', 'flex': '0 0 auto', '$ button': { padding: '6px 10px', fontSize: '12px', borderRadius: 'var(--lab-radius)', border: '1px solid var(--lab-color-border)', background: 'var(--lab-color-surface-alt)', color: 'var(--lab-color-text)', cursor: 'pointer' } })"
		>
			<button
				type="button"
				:disabled="snapshot.isFirstStep"
				:class="pika({ '$:disabled': { opacity: '0.5', cursor: 'not-allowed' } })"
				@click="tutorial.back()"
			>
				Back
			</button>
			<button
				type="button"
				@click="tutorial.skip()"
			>
				Skip tour
			</button>
			<button
				type="button"
				:disabled="!snapshot.canAdvance"
				:class="pika({ 'marginLeft': 'auto', 'fontWeight': '600', 'borderColor': 'var(--lab-color-accent)', 'background': 'var(--lab-color-accent)', 'color': 'var(--lab-color-accent-contrast)', '$:disabled': { opacity: '0.5', cursor: 'not-allowed' } })"
				@click="tutorial.next()"
			>
				{{ nextLabel }}
			</button>
		</footer>
	</aside>
</template>
