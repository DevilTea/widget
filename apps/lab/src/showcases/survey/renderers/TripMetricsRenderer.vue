<script setup lang="ts">
import { useWidget } from '@deviltea/widget-vue'
/**
 * Thin presentation only: every value/issue comes from `useProperties()`/`usePropertyIssues()`. The
 * date-order cross-field check (checkpoint §4.2) lives in `TripMetrics.tripDays`'s own `compute`; this
 * component only renders whatever issues that Property (or a downstream Property reading it) reports.
 *
 * Deliberately does NOT call `usePropertyIssues()` for `tripDays`/`travelerCount`: both have downstream
 * same-widget Property dependents (`budgetPerPersonPerDay`/`estimatedBaselineCost`, via
 * `dep.self.properties.get(...)`), and an active issues-subscription on an *upstream* Property whose
 * own alien-signals computed also writes its sibling issues signal has been observed to suppress
 * value-subscription updates on *downstream* Properties that depend on it — a reactivity interaction
 * this Property primitive does not document as safe. `budgetPerPersonPerDay`/`estimatedBaselineCost`
 * have no such downstream dependents, and their own `property-dependency` failures already carry the
 * same underlying message 1:1 (issue #10 §12 wrapping), so subscribing only to their issues still
 * surfaces the date-order diagnostic without the interaction.
 */
import { computed } from 'vue'
import { TripMetricsPlugin } from '../plugins/trip-metrics'

const { useProperties, usePropertyIssues } = useWidget(TripMetricsPlugin)
const { tripDays, travelerCount, budgetPerPersonPerDay, estimatedBaselineCost } = useProperties()
const { budgetPerPersonPerDay: budgetPerPersonPerDayIssues, estimatedBaselineCost: estimatedBaselineCostIssues } = usePropertyIssues()

const allIssues = computed(() => {
	const seen = new Set<string>()
	const combined = [...budgetPerPersonPerDayIssues.value, ...estimatedBaselineCostIssues.value]
	return combined.filter((issue) => {
		if (seen.has(issue.message))
			return false
		seen.add(issue.message)
		return true
	})
})
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
				v-for="issue in allIssues"
				:key="issue.message"
				:class="pika({ fontSize: '11px', color: 'var(--lab-color-danger)' })"
			>
				{{ issue.message }}
			</li>
		</ul>
	</div>
</template>
