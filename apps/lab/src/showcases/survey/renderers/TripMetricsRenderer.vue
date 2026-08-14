<script setup lang="ts">
/**
 * Thin presentation only: every value/issue comes from `useProperties()`/`usePropertyIssues()`. The
 * date-order cross-field check (checkpoint §4.2) lives in `TripMetrics.tripDays`'s own `compute`; this
 * component renders whatever issues `tripDays` and every Property reading it (`travelerCount` is
 * independent; `budgetPerPersonPerDay`/`estimatedBaselineCost` both read `tripDays`) report — no
 * per-Property opt-out is needed here (issue #20 fixed the core reactivity gap that used to make an
 * upstream Property's issues-subscription suppress a downstream sibling's own value-subscription
 * updates; `@deviltea/widget-core`/`@deviltea/widget-vue` are pinned to the fixed versions).
 */
import { useWidget } from '@deviltea/widget-vue'
import { computed } from 'vue'
import { TripMetricsPlugin } from '../plugins/trip-metrics'

const { useProperties, usePropertyIssues } = useWidget(TripMetricsPlugin)
const { tripDays, travelerCount, budgetPerPersonPerDay, estimatedBaselineCost } = useProperties()
const { tripDays: tripDaysIssues, travelerCount: travelerCountIssues, budgetPerPersonPerDay: budgetPerPersonPerDayIssues, estimatedBaselineCost: estimatedBaselineCostIssues } = usePropertyIssues()

const allIssues = computed(() => [
	...tripDaysIssues.value,
	...travelerCountIssues.value,
	...budgetPerPersonPerDayIssues.value,
	...estimatedBaselineCostIssues.value,
])
</script>

<template>
	<div>
		<p :class="pika({ margin: '0 0 8px', fontSize: '11px', fontStyle: 'italic', color: 'var(--lab-color-text-muted)' })">
			Illustrative/demo estimate only — synthetic Lab fixtures, not real travel pricing.
		</p>
		<dl :class="pika({ display: 'grid', gridTemplateColumns: 'max-content 1fr', gap: '4px 12px', margin: '0', fontSize: '12px' })">
			<dt>Trip days</dt>
			<dd :class="pika({ margin: '0' })">
				{{ tripDays }}
			</dd>
			<dt>Travelers</dt>
			<dd :class="pika({ margin: '0' })">
				{{ travelerCount }}
			</dd>
			<dt>Budget / person / day</dt>
			<dd :class="pika({ margin: '0' })">
				{{ (budgetPerPersonPerDay ?? 0).toFixed(2) }}
			</dd>
			<dt>Estimated baseline cost</dt>
			<dd :class="pika({ margin: '0' })">
				{{ (estimatedBaselineCost ?? 0).toFixed(2) }}
			</dd>
		</dl>
		<ul
			v-if="allIssues.length > 0"
			:class="pika({ margin: '8px 0 0', paddingLeft: '16px' })"
		>
			<li
				v-for="(issue, index) in allIssues"
				:key="index"
				:class="pika({ fontSize: '11px', color: 'var(--lab-color-danger)' })"
			>
				{{ issue.message }}
			</li>
		</ul>
	</div>
</template>
