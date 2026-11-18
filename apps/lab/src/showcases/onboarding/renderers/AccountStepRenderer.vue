<script setup lang="ts">
/**
 * Presentation only: two text boxes bound to State `name` and `email`, and what Property `missing` says is still needed.
 * Writing State is always accepted; whether the step is complete is the plugin's Property.
 */
import { useWidget } from '@deviltea/widget-vue'
import { computed, useId } from 'vue'
import { useInspectAnchor } from '../../../showcase-host'
import { AccountStepPlugin } from '../plugins/account-step'
import { FIELD_STYLE } from './control-style'
import StepFrame from './StepFrame.vue'
import { useOnboardingText } from './use-onboarding-text'

const { useState, useProperties, widgetId, widgetType } = useWidget(AccountStepPlugin)
const { name, email } = useState()
const { title, missing } = useProperties()
const { t, text } = useOnboardingText()
const anchor = useInspectAnchor(widgetId, widgetType)
const nameId = useId()
const emailId = useId()

const needed = computed(() => (missing.value ?? []).map(code => code === 'name' ? t('missingName') : t('missingEmail')))
</script>

<template>
	<div
		v-bind="anchor"
		:data-tutorial-target="`onboarding-${widgetId}`"
		class="account"
	>
		<StepFrame
			:title="title === null ? widgetId : text(title)"
			:needed="needed"
		>
			<div class="account-field">
				<label
					:for="nameId"
					class="account-label"
				>{{ t('accountName') }}</label>
				<input
					:id="nameId"
					type="text"
					autocomplete="name"
					class="account-input"
					:style="FIELD_STYLE"
					:value="name ?? ''"
					data-testid="account-name"
					@input="name = ($event.target as HTMLInputElement).value"
				>
			</div>
			<div class="account-field">
				<label
					:for="emailId"
					class="account-label"
				>{{ t('accountEmail') }}</label>
				<input
					:id="emailId"
					type="email"
					autocomplete="email"
					class="account-input"
					:style="FIELD_STYLE"
					:value="email ?? ''"
					data-testid="account-email"
					@input="email = ($event.target as HTMLInputElement).value"
				>
			</div>
		</StepFrame>
	</div>
</template>

<style scoped>
.account-field {
	display: flex;
	flex-direction: column;
	gap: 4px;
	max-width: 360px;
}

.account-label {
	font-size: 14px;
	color: var(--onboarding-text-muted);
}

.account-input {
	min-height: 36px;
	padding: 4px 10px;
	border-radius: var(--onboarding-radius);
	background: var(--onboarding-surface-alt);
	box-sizing: border-box;
}

.account-input:focus-visible {
	outline: 2px solid var(--onboarding-accent);
	outline-offset: 2px;
}
</style>
