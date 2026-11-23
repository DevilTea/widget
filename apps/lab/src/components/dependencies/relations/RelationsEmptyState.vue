<script setup lang="ts">
import { useLabI18n } from '../../../composables/use-lab-i18n'

defineProps<{
	message: string
}>()

const i18n = useLabI18n()
</script>

<template>
	<!--
		The card is centred with my-auto, not justify-center: in a pane lower than the card (the half-height Tools pane of a short window)
		justify-center pushed it up out of its box and over the panel toolbar, where it took the clicks meant for the Graph tab. With
		my-auto it starts at the top and the state scrolls.
	-->
	<div
		class="relations-empty-state flex flex-col items-center h-full min-h-0 overflow-y-auto p-[32px_24px] text-center text-lab-text-muted font-lab-sans"
	>
		<div
			class="relations-empty-card my-auto flex-none max-w-[420px] p-[24px_28px] rounded-lab border border-lab-border border-dashed bg-lab-surface flex flex-col items-center gap-[12px] [box-shadow:0_2px_10px_color-mix(in_srgb,var(--lab-color-text)_4%,transparent)]"
		>
			<div
				class="relations-empty-icon flex items-center justify-center w-[40px] h-[40px] rounded-[50%] bg-lab-surface-alt text-lab-text text-[18px] font-bold"
				aria-hidden="true"
			>
				☍
			</div>
			<h4
				class="m-0 text-[13px] font-semibold text-lab-text"
			>
				{{ i18n.t('No focus selected') }}
			</h4>
			<p
				class="m-0 text-[11px] leading-[1.5] text-lab-text-muted"
			>
				{{ i18n.t(message) }}
			</p>
			<div
				class="mt-[6px] pt-[12px] border-t border-t-lab-border text-[11px] text-left w-full text-lab-text-muted flex flex-col gap-[4px]"
			>
				<span class="font-semibold uppercase text-[11px]">
					{{ i18n.t('How to select focus:') }}
				</span>
				<div>• <strong>Preview</strong>: {{ i18n.t('Turn on Inspect and click a widget') }}</div>
				<div>• <strong>Blueprint</strong>: {{ i18n.t('Click a node or member in the tree') }}</div>
				<div>• <strong>Runtime</strong>: {{ i18n.t('Select a state, property, or method row') }}</div>
				<div>• <strong>Graph</strong>: {{ i18n.t('Click a widget cluster or member node') }}</div>
			</div>
		</div>
	</div>
</template>
