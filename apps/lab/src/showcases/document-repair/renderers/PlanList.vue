<script setup lang="ts">
/**
 * Presentation only: the application's migration plan, an ordered list of steps. Each shows its title and why in the viewer's
 * language, how many `SourcePatch` operations it has (the first ones are `test` guards) and, on request, the patch itself.
 * The plan is the application's policy (`planRepair`), not something Core knows or checks.
 */
import type { RepairStep } from '../domain'
import { useRepairText } from './use-repair-text'

defineProps<{ steps: readonly RepairStep[], testId: string }>()

const { t, tf, text } = useRepairText()
</script>

<template>
	<p
		v-if="steps.length === 0"
		class="plan-empty"
		:data-testid="testId"
	>
		{{ t('planEmpty') }}
	</p>
	<ol
		v-else
		class="plan"
		:data-testid="testId"
	>
		<li
			v-for="(step, index) in steps"
			:key="step.id"
			class="plan-step"
			:class="{ 'plan-step--next': index === 0 }"
			data-testid="repair-plan-step"
			:data-step-id="step.id"
		>
			<p class="plan-step-head">
				<strong class="plan-step-title">{{ text(step.title) }}</strong>
				<code class="plan-step-id">{{ step.id }}</code>
				<span
					v-if="index === 0"
					class="plan-step-next"
				>{{ t('planNext') }}</span>
				<span class="plan-step-ops">{{ tf('planOperations', { count: step.patch.length }) }}</span>
			</p>
			<p class="plan-step-why">
				{{ text(step.why) }}
			</p>
			<details class="plan-step-patch">
				<summary>{{ t('planShowPatch') }}</summary>
				<pre class="plan-step-json">{{ JSON.stringify(step.patch, null, 2) }}</pre>
			</details>
		</li>
	</ol>
</template>

<style scoped>
.plan {
	display: flex;
	flex-direction: column;
	gap: 8px;
	margin: 0;
	padding: 0;
	list-style: none;
	counter-reset: plan;
}

.plan-empty {
	margin: 0;
	color: var(--repair-text-muted);
}

.plan-step {
	padding: 8px 10px;
	border: 1px solid var(--repair-border);
	border-radius: var(--repair-radius);
	background: var(--repair-surface-alt);
}

.plan-step--next {
	border-color: var(--repair-accent);
}

.plan-step-head {
	display: flex;
	flex-wrap: wrap;
	align-items: baseline;
	gap: 4px 10px;
	margin: 0;
}

.plan-step-id,
.plan-step-ops {
	font-family: var(--repair-font-mono);
	font-size: 12px;
	color: var(--repair-text-muted);
}

.plan-step-next {
	padding: 0 8px;
	border-radius: 999px;
	background: var(--repair-accent);
	color: var(--repair-on-accent);
	font-size: 12px;
	font-weight: 600;
}

.plan-step-why {
	margin: 4px 0;
	font-size: 13px;
	color: var(--repair-text-muted);
}

.plan-step-patch summary {
	min-height: 24px;
	cursor: pointer;
	font-size: 13px;
}

.plan-step-patch summary:focus-visible {
	outline: 2px solid var(--repair-accent);
	outline-offset: 2px;
}

.plan-step-json {
	overflow-x: auto;
	margin: 4px 0 0;
	padding: 8px;
	border-radius: var(--repair-radius);
	background: var(--repair-bg);
	font-family: var(--repair-font-mono);
	font-size: 12px;
}
</style>
