<script setup lang="ts">
/**
 * Thin presentation only: every value/issue comes from `useProperties()`/`usePropertyIssues()`. The
 * date-order cross-field check (checkpoint §4.2) lives in `TripMetrics.tripDays`'s own `compute`; this
 * component renders whatever issues `tripDays` and every Property reading it (`travelerCount` is
 * independent; `budgetPerPersonPerDay`/`estimatedBaselineCost` both read `tripDays`) report — no
 * per-Property opt-out is needed here (issue #20 fixed the core reactivity gap that used to make an
 * upstream Property's issues-subscription suppress a downstream sibling's own value-subscription
 * updates; `@deviltea/widget-core`/`@deviltea/widget-vue` are pinned to the fixed versions).
 *
 * Issue #26 Finding 2 (fabricated `0.00`): `useProperties()` projects a failed Property to `null` (no
 * last-successful fallback — `@deviltea/widget-vue`'s `createPropertyRef`), and none of these four
 * Properties is ever legitimately `null`/absent on success (`tripDays`/`budgetPerPersonPerDay`/
 * `estimatedBaselineCost` all fail via `addIssue`/dependency propagation rather than returning a
 * sentinel; `travelerCount` never fails at all) — so `null` here is an unambiguous failure signal, never
 * a valid reading to `?? 0` away. `formatMetric()`/`formatCurrencyMetric()` render `'Unavailable'`
 * instead, uniformly across all four metrics.
 *
 * Issue #26 Finding 3 (duplicate-looking cascade): each metric renders only its *own* `usePropertyIssues()`
 * list (no flattened `allIssues` list), and `trip-metrics-issue-provenance.ts`'s pure helpers turn a
 * `property-dependency` issue into an attributed "Unavailable because <upstream> failed." line instead of
 * repeating the wrapped root-cause message — see that module's header for the full rationale. This is
 * presentation grouping only: the underlying issue data/ownership is exactly what core already reports.
 */
import { useWidget } from '@deviltea/widget-vue'
import { computed } from 'vue'
import { TripMetricsPlugin } from '../plugins/trip-metrics'
import { toProvenanceLines } from './trip-metrics-issue-provenance'

const { useProperties, usePropertyIssues } = useWidget(TripMetricsPlugin)
const { tripDays, travelerCount, budgetPerPersonPerDay, estimatedBaselineCost } = useProperties()
const { tripDays: tripDaysIssues, travelerCount: travelerCountIssues, budgetPerPersonPerDay: budgetPerPersonPerDayIssues, estimatedBaselineCost: estimatedBaselineCostIssues } = usePropertyIssues()

/** Whole-number metrics (`tripDays`/`travelerCount`): rendered verbatim, never `'0'` for a failure. */
function formatMetric(value: number | null): string {
	return value === null ? 'Unavailable' : String(value)
}

/** Currency-shaped metrics (`budgetPerPersonPerDay`/`estimatedBaselineCost`): two decimals on success. */
function formatCurrencyMetric(value: number | null): string {
	return value === null ? 'Unavailable' : value.toFixed(2)
}

const tripDaysLines = computed(() => toProvenanceLines(tripDaysIssues.value))
const travelerCountLines = computed(() => toProvenanceLines(travelerCountIssues.value))
const budgetPerPersonPerDayLines = computed(() => toProvenanceLines(budgetPerPersonPerDayIssues.value))
const estimatedBaselineCostLines = computed(() => toProvenanceLines(estimatedBaselineCostIssues.value))
</script>

<template>
	<div data-tutorial-target="survey-trip-metrics">
		<p :class="pika({ margin: '0 0 8px', fontSize: '11px', fontStyle: 'italic', color: 'var(--lab-color-text-muted)' })">
			Illustrative/demo estimate only — synthetic Lab fixtures, not real travel pricing.
		</p>
		<dl :class="pika({ display: 'grid', gridTemplateColumns: 'max-content 1fr', gap: '4px 12px', margin: '0', fontSize: '12px' })">
			<dt>Trip days</dt>
			<dd :class="pika({ margin: '0' })">
				{{ formatMetric(tripDays) }}
			</dd>
			<dd
				v-if="tripDaysLines.length > 0"
				:class="pika({ margin: '0', gridColumn: '1 / -1' })"
			>
				<ul :class="pika({ margin: '0', paddingLeft: '16px' })">
					<li
						v-for="line in tripDaysLines"
						:key="line.key"
						:class="pika({ fontSize: '11px', color: 'var(--lab-color-danger)' })"
					>
						{{ line.text }}
					</li>
				</ul>
			</dd>

			<dt>Travelers</dt>
			<dd :class="pika({ margin: '0' })">
				{{ formatMetric(travelerCount) }}
			</dd>
			<dd
				v-if="travelerCountLines.length > 0"
				:class="pika({ margin: '0', gridColumn: '1 / -1' })"
			>
				<ul :class="pika({ margin: '0', paddingLeft: '16px' })">
					<li
						v-for="line in travelerCountLines"
						:key="line.key"
						:class="pika({ fontSize: '11px', color: 'var(--lab-color-danger)' })"
					>
						{{ line.text }}
					</li>
				</ul>
			</dd>

			<dt>Budget / person / day</dt>
			<dd :class="pika({ margin: '0' })">
				{{ formatCurrencyMetric(budgetPerPersonPerDay) }}
			</dd>
			<dd
				v-if="budgetPerPersonPerDayLines.length > 0"
				:class="pika({ margin: '0', gridColumn: '1 / -1' })"
			>
				<ul :class="pika({ margin: '0', paddingLeft: '16px' })">
					<li
						v-for="line in budgetPerPersonPerDayLines"
						:key="line.key"
						:class="pika({ fontSize: '11px', color: 'var(--lab-color-danger)' })"
					>
						{{ line.text }}
					</li>
				</ul>
			</dd>

			<dt>Estimated baseline cost</dt>
			<dd :class="pika({ margin: '0' })">
				{{ formatCurrencyMetric(estimatedBaselineCost) }}
			</dd>
			<dd
				v-if="estimatedBaselineCostLines.length > 0"
				:class="pika({ margin: '0', gridColumn: '1 / -1' })"
			>
				<ul :class="pika({ margin: '0', paddingLeft: '16px' })">
					<li
						v-for="line in estimatedBaselineCostLines"
						:key="line.key"
						:class="pika({ fontSize: '11px', color: 'var(--lab-color-danger)' })"
					>
						{{ line.text }}
					</li>
				</ul>
			</dd>
		</dl>
	</div>
</template>
