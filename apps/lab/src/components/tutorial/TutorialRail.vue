<script setup lang="ts">
/**
 * Tutorial rail (diagnostic #25), a real column at the right edge of `.lab-body` (App.vue; issue #230 PR 3b,
 * audit U13): a fixed-width flex item beside the workbench, below the header, so the workbench and Dockview give up
 * its width instead of being covered by it. It never overlaps the header (the overflow menu), the Dockview groups
 * or the Preview frame (the survey's own Language select). #43 translates its presentation copy at render time so the
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
		data-testid="tutorial-rail"
		class="flex-[0_0_320px] w-[320px] min-h-0 flex flex-col border-l border-l-lab-border bg-lab-surface"
	>
		<header
			class="flex items-center gap-[8px] p-[10px_12px] border-b border-b-lab-border flex-[0_0_auto]"
		>
			<strong class="text-[12px]">{{ i18n.t('Tutorial') }}</strong>
			<span class="text-[11px] text-lab-text-muted">
				{{ i18n.t('Step {current} of {total}', { current: snapshot.stepIndex + 1, total: snapshot.stepCount }) }}
			</span>
			<button
				type="button"
				:aria-label="i18n.t('Close tutorial')"
				class="ml-[auto] p-[0_4px] text-[14px] leading-[1] [border:none] bg-transparent text-lab-text-muted cursor-pointer"
				@click="tutorial.pause()"
			>
				×
			</button>
		</header>

		<div
			v-if="step"
			class="flex-auto min-h-0 overflow-auto p-[12px] flex flex-col gap-[8px]"
		>
			<h3 class="m-0 text-[13px]">
				{{ i18n.t(step.title) }}
			</h3>

			<p
				v-for="(text, index) in snapshot.revealed"
				:key="index"
				class="m-0 text-[12px] leading-[1.5]"
			>
				{{ i18n.t(text) }}
			</p>
			<p
				v-if="snapshot.pendingPrompt"
				class="m-0 text-[12px] leading-[1.5] italic text-lab-text-muted"
			>
				{{ i18n.t(snapshot.pendingPrompt) }}
			</p>

			<ul
				v-if="step.links"
				class="flex flex-col gap-[4px] m-[4px_0_0] p-0 list-none"
			>
				<li
					v-for="link in step.links"
					:key="link.id"
				>
					<button
						type="button"
						:disabled="link.disabled"
						class="w-full text-left p-[5px_8px] text-[11px] rounded-lab border border-lab-border bg-lab-surface-alt text-lab-text cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
						@click="tutorial.runLink(link.id)"
					>
						{{ i18n.t(link.label) }}<span v-if="link.note"> ({{ i18n.t(link.note) }})</span>
					</button>
				</li>
			</ul>
		</div>

		<footer
			class="flex gap-[8px] p-[10px_12px] border-t border-t-lab-border flex-[0_0_auto] [&_button]:p-[6px_10px] [&_button]:text-[12px] [&_button]:rounded-lab [&_button]:border [&_button]:border-lab-border [&_button]:bg-lab-surface-alt [&_button]:text-lab-text [&_button]:cursor-pointer"
		>
			<button
				type="button"
				:disabled="snapshot.isFirstStep"
				class="disabled:opacity-50 disabled:cursor-not-allowed"
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
				class="ml-[auto] font-semibold border-lab-accent bg-lab-accent text-lab-accent-contrast disabled:opacity-50 disabled:cursor-not-allowed"
				@click="tutorial.next()"
			>
				{{ nextLabel }}
			</button>
		</footer>
	</aside>
</template>
