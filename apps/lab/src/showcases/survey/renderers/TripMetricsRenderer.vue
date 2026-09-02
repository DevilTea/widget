<script setup lang="ts">
/**
 * Thin presentation only: every value/diagnostic comes from `useProperties()`/`usePropertyDiagnostics()`.
 * #43 localizes only this renderer's fixed presentation labels. Property values, diagnostic/provenance text,
 * widget/member identities, and config/source-owned content remain exactly what the semantic layer emits.
 */
import { useWidget } from '@deviltea/widget-vue'
import { computed } from 'vue'
import { useInspectAnchor } from '../../../composables/use-inspect-anchor'
import { useLabI18n } from '../../../composables/use-lab-i18n'
import { TripMetricsPlugin } from '../plugins/trip-metrics'
import { toProvenanceLines } from './trip-metrics-diagnostic-provenance'

const { useProperties, usePropertyDiagnostics, widgetId, widgetType } = useWidget(TripMetricsPlugin)
const { tripDays, travelerCount, budgetPerPersonPerDay, estimatedBaselineCost } = useProperties()
const { tripDays: tripDaysDiagnostics, travelerCount: travelerCountDiagnostics, budgetPerPersonPerDay: budgetPerPersonPerDayDiagnostics, estimatedBaselineCost: estimatedBaselineCostDiagnostics } = usePropertyDiagnostics()
const i18n = useLabI18n()

/** Whole-number metrics: rendered verbatim; failure gets renderer-owned localized chrome. */
function formatMetric(value: number | null): string {
	return value === null ? i18n.t('Unavailable') : String(value)
}

/** Currency-shaped metrics: two decimals on ok; failure uses the same presentation label. */
function formatCurrencyMetric(value: number | null): string {
	return value === null ? i18n.t('Unavailable') : value.toFixed(2)
}

const tripDaysLines = computed(() => toProvenanceLines(tripDaysDiagnostics.value))
const travelerCountLines = computed(() => toProvenanceLines(travelerCountDiagnostics.value))
const budgetPerPersonPerDayLines = computed(() => toProvenanceLines(budgetPerPersonPerDayDiagnostics.value))
const estimatedBaselineCostLines = computed(() => toProvenanceLines(estimatedBaselineCostDiagnostics.value))
const inspectAnchor = useInspectAnchor(widgetId, widgetType)
</script>

<template>
	<div
		data-tutorial-target="survey-trip-metrics"
		v-bind="inspectAnchor"
	>
		<p :class="pika({ margin: '0 0 8px', fontSize: '11px', fontStyle: 'italic', color: 'var(--lab-color-text-muted)' })">
			{{ i18n.t('Illustrative/demo estimate only — synthetic Lab fixtures, not real travel pricing.') }}
		</p>
		<dl :class="pika({ display: 'grid', gridTemplateColumns: 'max-content 1fr', gap: '4px 12px', margin: '0', fontSize: '12px' })">
			<dt>{{ i18n.t('Trip days') }}</dt>
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

			<dt>{{ i18n.t('Travelers') }}</dt>
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

			<dt>{{ i18n.t('Budget / person / day') }}</dt>
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

			<dt>{{ i18n.t('Estimated baseline cost') }}</dt>
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
