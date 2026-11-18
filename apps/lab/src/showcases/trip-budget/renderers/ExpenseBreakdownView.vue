<script setup lang="ts">
/**
 * The breakdown of one expense: the conversion into the base currency and each person's share, with the
 * leftover cents.
 *
 * This component is the only reader of the Property `breakdown`, and it is mounted only while the expense's
 * disclosure is open. `useWidget()` here is a bridge of its own: the Runtime subscription it takes (and so the
 * first evaluation of `breakdown`) starts when this component renders and is released when it unmounts.
 */
import { useWidget } from '@deviltea/widget-vue'
import { computed } from 'vue'
import { fill, formatMoney, formatPlainAmount, tripText } from '../domain'
import { ExpensePlugin } from '../plugins/expense'

const { useProperties } = useWidget(ExpensePlugin)
const { breakdown, view } = useProperties()
const text = computed(() => tripText(view.value?.language ?? 'en'))

function money(cents: number): string {
	return view.value === null ? String(cents / 100) : formatMoney(cents, view.value.base, view.value.language)
}
</script>

<template>
	<div
		class="breakdown"
		data-testid="trip-breakdown"
	>
		<h4 class="breakdown-title">
			{{ text.breakdownTitle }}
		</h4>
		<p
			v-if="breakdown?.conversion"
			data-testid="trip-breakdown-conversion"
			class="breakdown-line"
		>
			{{
				fill(text.breakdownConversion, {
					amount: formatPlainAmount(breakdown.conversion.amount, view?.language ?? 'en'),
					currency: breakdown.conversion.currency,
					rate: breakdown.conversion.rate,
					base: money(breakdown.conversion.baseCents),
				})
			}}
		</p>
		<ul
			v-if="breakdown !== null"
			class="breakdown-list"
		>
			<li
				v-for="line in breakdown.lines"
				:key="line.id"
				data-testid="trip-breakdown-line"
				class="breakdown-line"
			>
				{{
					fill(line.percent === null ? text.breakdownShareEqual : text.breakdownSharePercent, {
						name: line.name,
						amount: money(line.cents),
						percent: line.percent ?? '',
					})
				}}
			</li>
		</ul>
		<p
			v-if="breakdown !== null && breakdown.remainderCents > 0"
			data-testid="trip-breakdown-remainder"
			class="breakdown-note"
		>
			{{ fill(breakdown.remainderCents === 1 ? text.breakdownRemainder : text.breakdownRemainderMany, { cents: breakdown.remainderCents }) }}
		</p>
	</div>
</template>

<style scoped>
.breakdown {
	padding-top: 6px;
	border-top: 1px solid var(--trip-border);
	font-size: 14px;
}

.breakdown-title {
	margin: 0 0 4px;
	font-size: 14px;
}

.breakdown-list {
	display: flex;
	flex-direction: column;
	gap: 2px;
	margin: 0;
	padding: 0;
	list-style: none;
}

.breakdown-line {
	margin: 0;
	font-variant-numeric: tabular-nums;
}

.breakdown-note {
	margin: 4px 0 0;
	color: var(--trip-text-muted);
}
</style>
