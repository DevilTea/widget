<script setup lang="ts">
/**
 * Presentation only: the base currency, the rates and the "round transfers to" choice.
 *
 * Reads: Properties `view`, `base` and `rates`. Writes State `roundStep` (a number: the select's value is
 * text, so it goes through `Number`; the State's own validation decides what is accepted). Which payments
 * the choice produces is the Settlement's, through the Currency's read-only Method `roundTransfer`.
 */
import { useWidget } from '@deviltea/widget-vue'
import { computed, useId } from 'vue'
import { useInspectAnchor } from '../../../showcase-host'
import { fill, ROUND_STEPS, roundStepLabel, tripText } from '../domain'
import { CurrencyPlugin } from '../plugins/currency'
import { FIELD_STYLE } from './control-style'

const { useState, useProperties, widgetId, widgetType } = useWidget(CurrencyPlugin)
const { roundStep } = useState()
const { view, base, rates } = useProperties()
const text = computed(() => tripText(view.value?.language ?? 'en'))

const selectId = useId()
const anchor = useInspectAnchor(widgetId, widgetType)
const rateLines = computed(() => Object.entries(rates.value ?? {})
	.map(([code, rate]) => fill(text.value.rate, { currency: code, rate, base: base.value ?? '' })))

function onRoundChange(event: Event): void {
	roundStep.value = Number((event.target as HTMLSelectElement).value)
}
</script>

<template>
	<section
		v-bind="anchor"
		:data-tutorial-target="`trip-${widgetId}`"
		:aria-label="text.settings"
		class="currency"
	>
		<h2 class="currency-heading">
			{{ text.settings }}
		</h2>
		<p class="currency-line">
			<span class="currency-label">{{ text.baseCurrency }}</span>
			<strong data-testid="trip-base-currency">{{ base }}</strong>
		</p>
		<p
			v-if="rateLines.length > 0"
			class="currency-line"
		>
			<span class="currency-label">{{ text.rates }}</span>
			<span
				data-testid="trip-rates"
				class="currency-rates"
			>{{ rateLines.join(' · ') }}</span>
		</p>
		<div class="currency-line">
			<label
				:for="selectId"
				class="currency-label"
			>{{ text.roundTo }}</label>
			<select
				:id="selectId"
				:value="roundStep ?? 1"
				class="currency-select"
				:style="FIELD_STYLE"
				data-testid="trip-round-step"
				@change="onRoundChange"
			>
				<option
					v-for="step in ROUND_STEPS"
					:key="step"
					:value="step"
				>
					{{ roundStepLabel(step, text) }}
				</option>
			</select>
		</div>
	</section>
</template>

<style scoped>
.currency {
	display: flex;
	flex-wrap: wrap;
	align-items: center;
	gap: 8px 20px;
	padding: 10px 14px;
	border: 1px solid var(--trip-border);
	border-radius: var(--trip-radius);
	background: var(--trip-surface);
}

.currency-heading {
	flex: 1 0 100%;
	margin: 0;
	font-size: 16px;
}

.currency-line {
	display: flex;
	flex-wrap: wrap;
	align-items: center;
	gap: 8px;
	margin: 0;
}

.currency-label {
	font-size: 14px;
	color: var(--trip-text-muted);
}

.currency-rates {
	font-family: var(--trip-font-mono);
	font-size: 14px;
}

/* The select's text colour, size, weight and border are set inline (`control-style.ts`). */
.currency-select {
	min-height: 36px;
	padding: 4px 10px;
	border-radius: var(--trip-radius);
	background: var(--trip-surface-alt);
}
</style>
