<script setup lang="ts">
/**
 * Presentation only: a check box per option, bound to State `selected` (the ids picked, kept in the order of the options).
 * What is still needed is Property `missing`.
 */
import { useWidget } from '@deviltea/widget-vue'
import { computed } from 'vue'
import { useInspectAnchor } from '../../../showcase-host'
import { InterestsStepPlugin } from '../plugins/interests-step'
import StepFrame from './StepFrame.vue'
import { useOnboardingText } from './use-onboarding-text'

const { useState, useProperties, widgetId, widgetType } = useWidget(InterestsStepPlugin)
const { selected } = useState()
const { title, options, missing } = useProperties()
const { t, tf, text } = useOnboardingText()
const anchor = useInspectAnchor(widgetId, widgetType)

const needed = computed(() => (missing.value ?? []).map(code => tf('missingInterests', { count: Number(code.split(':')[1] ?? 1) })))

function toggle(id: string, checked: boolean): void {
	const picked = new Set(selected.value ?? [])
	if (checked)
		picked.add(id)
	else
		picked.delete(id)
	selected.value = (options.value ?? []).map(option => option.id)
		.filter(candidate => picked.has(candidate))
}
</script>

<template>
	<div
		v-bind="anchor"
		:data-tutorial-target="`onboarding-${widgetId}`"
	>
		<StepFrame
			:title="title === null ? widgetId : text(title)"
			:needed="needed"
		>
			<fieldset class="interests">
				<legend class="interests-legend">
					{{ t('interestsLegend') }}
				</legend>
				<label
					v-for="option in options ?? []"
					:key="option.id"
					class="interests-option"
				>
					<input
						type="checkbox"
						class="interests-box"
						:checked="(selected ?? []).includes(option.id)"
						:data-testid="`interest-${option.id}`"
						@change="toggle(option.id, ($event.target as HTMLInputElement).checked)"
					>
					<span>{{ text(option.label) }}</span>
				</label>
			</fieldset>
		</StepFrame>
	</div>
</template>

<style scoped>
.interests {
	display: flex;
	flex-wrap: wrap;
	gap: 8px;
	margin: 0;
	padding: 0;
	border: 0;
}

.interests-legend {
	flex-basis: 100%;
	padding: 0;
	margin-bottom: 4px;
	font-size: 14px;
	color: var(--onboarding-text-muted);
}

.interests-option {
	display: inline-flex;
	align-items: center;
	gap: 8px;
	min-height: 36px;
	padding: 4px 12px;
	border: 1px solid var(--onboarding-text-muted);
	border-radius: 999px;
	background: var(--onboarding-surface-alt);
	cursor: pointer;
}

.interests-box {
	width: 18px;
	height: 18px;
	margin: 0;
	accent-color: var(--onboarding-accent);
}

.interests-box:focus-visible {
	outline: 2px solid var(--onboarding-accent);
	outline-offset: 2px;
}
</style>
