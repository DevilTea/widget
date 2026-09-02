<script setup lang="ts">
/**
 * Fixed tutorial rail (diagnostic #25). #43 translates its presentation copy at render time so the
 * framework-agnostic tutorial scripts remain stable semantic/pedagogical definitions rather than
 * depending on Vue/i18n state.
 */
import { computed } from 'vue'
import { useLabI18n } from '../../composables/use-lab-i18n'
import { useTutorialStore } from '../../composables/use-tutorial'

const tutorial = useTutorialStore()
const i18n = useLabI18n()
const snapshot = computed(() => tutorial.snapshot.value)
const step = computed(() => snapshot.value.step)
const nextLabel = computed(() => i18n.t(snapshot.value.isLastStep ? (step.value?.finishLabel ?? 'Finish') : 'Next'))
</script>

<template>
	<aside
		:aria-label="i18n.t('Tutorial')"
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
			<strong :class="pika({ fontSize: '12px' })">{{ i18n.t('Tutorial') }}</strong>
			<span :class="pika({ fontSize: '11px', color: 'var(--lab-color-text-muted)' })">
				{{ i18n.t('Step {current} of {total}', { current: snapshot.stepIndex + 1, total: snapshot.stepCount }) }}
			</span>
			<button
				type="button"
				:aria-label="i18n.t('Close tutorial')"
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
				{{ i18n.t(step.title) }}
			</h3>

			<p
				v-for="(text, index) in snapshot.revealed"
				:key="index"
				:class="pika({ margin: '0', fontSize: '12px', lineHeight: '1.5' })"
			>
				{{ i18n.t(text) }}
			</p>
			<p
				v-if="snapshot.pendingPrompt"
				:class="pika({ margin: '0', fontSize: '12px', lineHeight: '1.5', fontStyle: 'italic', color: 'var(--lab-color-text-muted)' })"
			>
				{{ i18n.t(snapshot.pendingPrompt) }}
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
						{{ i18n.t(link.label) }}<span v-if="link.note"> ({{ i18n.t(link.note) }})</span>
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
				{{ i18n.t('Back') }}
			</button>
			<button
				type="button"
				@click="tutorial.skip()"
			>
				{{ i18n.t('Skip tour') }}
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
