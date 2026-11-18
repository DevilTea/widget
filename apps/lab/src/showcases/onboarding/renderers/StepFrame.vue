<script setup lang="ts">
/**
 * The frame every step shares: a card with the step's heading (the heading takes focus when the host heard
 * `stepChanged`, hence `tabindex="-1"`), the step's own controls, and what the step's Property `missing` says is
 * still needed, in the viewer's language. Presentation only.
 */
import { useId } from 'vue'
import { useOnboardingText } from './use-onboarding-text'

defineProps<{
	title: string
	/** What is still missing, already in the viewer's language; empty when the step is complete. */
	needed: readonly string[]
}>()

const { t, tf } = useOnboardingText()
const headingId = useId()
</script>

<template>
	<section
		:aria-labelledby="headingId"
		class="step"
		data-testid="onboarding-step"
	>
		<h2
			:id="headingId"
			tabindex="-1"
			class="step-title"
			data-testid="onboarding-step-title"
		>
			{{ title }}
		</h2>
		<slot />
		<p
			class="step-needed"
			:data-complete="needed.length === 0"
			data-testid="onboarding-step-needed"
		>
			{{ needed.length === 0 ? t('allSet') : tf('stillNeeded', { items: needed.join(', ') }) }}
		</p>
	</section>
</template>

<style scoped>
.step {
	display: flex;
	flex-direction: column;
	gap: 12px;
	padding: 16px;
	border: 1px solid var(--onboarding-border);
	border-radius: var(--onboarding-radius);
	background: var(--onboarding-surface);
}

.step-title {
	margin: 0;
	font-size: 20px;
}

.step-title:focus-visible {
	outline: 2px solid var(--onboarding-accent);
	outline-offset: 2px;
}

.step-needed {
	margin: 0;
	font-size: 13px;
	color: var(--onboarding-text-muted);
}
</style>
