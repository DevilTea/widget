<script setup lang="ts">
/**
 * Presentation only: a check box per safety rule, bound to State `acknowledged` (the ids acknowledged, in the order of
 * the rules). What is still needed is Property `missing`, one `rule:<id>` per rule.
 */
import { useWidget } from '@deviltea/widget-vue'
import { computed } from 'vue'
import { useInspectAnchor } from '../../../showcase-host'
import { SafetyStepPlugin } from '../plugins/safety-step'
import StepFrame from './StepFrame.vue'
import { useOnboardingText } from './use-onboarding-text'

const { useState, useProperties, widgetId, widgetType } = useWidget(SafetyStepPlugin)
const { acknowledged } = useState()
const { title, rules, missing } = useProperties()
const { t, tf, text } = useOnboardingText()
const anchor = useInspectAnchor(widgetId, widgetType)

const needed = computed(() => (missing.value ?? []).map((code) => {
	const rule = (rules.value ?? []).find(candidate => `rule:${candidate.id}` === code)
	return tf('missingRule', { rule: rule === undefined ? code : text(rule.text) })
}))

function toggle(id: string, checked: boolean): void {
	const done = new Set(acknowledged.value ?? [])
	if (checked)
		done.add(id)
	else
		done.delete(id)
	acknowledged.value = (rules.value ?? []).map(rule => rule.id)
		.filter(candidate => done.has(candidate))
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
			<fieldset class="safety">
				<legend class="safety-legend">
					{{ t('safetyLegend') }}
				</legend>
				<label
					v-for="rule in rules ?? []"
					:key="rule.id"
					class="safety-rule"
				>
					<input
						type="checkbox"
						class="safety-box"
						:checked="(acknowledged ?? []).includes(rule.id)"
						:data-testid="`rule-${rule.id}`"
						@change="toggle(rule.id, ($event.target as HTMLInputElement).checked)"
					>
					<span>{{ text(rule.text) }}</span>
				</label>
			</fieldset>
		</StepFrame>
	</div>
</template>

<style scoped>
.safety {
	display: flex;
	flex-direction: column;
	gap: 8px;
	margin: 0;
	padding: 0;
	border: 0;
}

.safety-legend {
	padding: 0;
	margin-bottom: 4px;
	font-size: 14px;
	color: var(--onboarding-text-muted);
}

.safety-rule {
	display: flex;
	align-items: flex-start;
	gap: 10px;
	min-height: 36px;
	padding: 6px 10px;
	border: 1px solid var(--onboarding-border);
	border-radius: var(--onboarding-radius);
	background: var(--onboarding-surface-alt);
	cursor: pointer;
}

.safety-box {
	flex: none;
	width: 18px;
	height: 18px;
	margin: 2px 0 0;
	accent-color: var(--onboarding-accent);
}

.safety-box:focus-visible {
	outline: 2px solid var(--onboarding-accent);
	outline-offset: 2px;
}
</style>
