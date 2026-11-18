<script setup lang="ts">
/**
 * Presentation only: what the trip cost and who pays whom.
 *
 * Reads: Properties `view`, `total` and `transfers`. Every figure is computed by the plugins (the people's
 * balances, the settlement and the rounding by the Currency's read-only Method); a chain that failed (a
 * currency with no rate) projects to `null`, which is shown as a notice instead of numbers.
 */
import { useWidget } from '@deviltea/widget-vue'
import { computed } from 'vue'
import { useInspectAnchor } from '../../../showcase-host'
import { fill, formatMoney, tripText } from '../domain'
import { SettlementPlugin } from '../plugins/settlement'

const { useProperties, widgetId, widgetType } = useWidget(SettlementPlugin)
const { view, total, transfers } = useProperties()
const text = computed(() => tripText(view.value?.language ?? 'en'))
const anchor = useInspectAnchor(widgetId, widgetType)

function money(cents: number): string {
	return view.value === null ? String(cents / 100) : formatMoney(cents, view.value.base, view.value.language)
}

const failed = computed(() => transfers.value === null || total.value === null)
const gap = computed(() => transfers.value !== null && transfers.value.roundingGapCents !== 0
	? fill(text.value.roundingGap, { amount: money(Math.abs(transfers.value.roundingGapCents)) })
	: null)
</script>

<template>
	<section
		v-bind="anchor"
		:data-tutorial-target="`trip-${widgetId}`"
		:data-failed="failed"
		class="settlement"
	>
		<h2 class="settlement-heading">
			{{ text.settlement }}
		</h2>
		<p
			v-if="failed"
			role="alert"
			data-testid="trip-settlement-failed"
			class="settlement-failed"
		>
			<span aria-hidden="true">&#9888; </span>{{ text.conversionFailed }}
		</p>
		<template v-else>
			<p class="settlement-total">
				<span class="settlement-label">{{ text.totalSpent }}</span>
				<strong data-testid="trip-total">{{ money(total ?? 0) }}</strong>
			</p>
			<h3 class="settlement-subheading">
				{{ text.whoPaysWhom }}
			</h3>
			<p
				v-if="transfers !== null && transfers.transfers.length === 0"
				data-testid="trip-all-settled"
				class="settlement-settled"
			>
				{{ text.allSettled }}
			</p>
			<ul
				v-else
				class="settlement-transfers"
				data-testid="trip-transfers"
			>
				<li
					v-for="transfer in transfers?.transfers ?? []"
					:key="`${transfer.from}>${transfer.to}`"
					data-testid="trip-transfer"
					class="settlement-transfer"
				>
					<span>{{ fill(text.transfer, { from: transfer.fromName, to: transfer.toName }) }}</span>
					<strong class="settlement-amount">{{ money(transfer.cents) }}</strong>
				</li>
			</ul>
			<p
				v-if="gap !== null"
				data-testid="trip-rounding-gap"
				class="settlement-note"
			>
				{{ gap }}
			</p>
		</template>
	</section>
</template>

<style scoped>
.settlement {
	display: flex;
	flex-direction: column;
	gap: 6px;
	padding: 12px 16px;
	border: 2px solid var(--trip-accent);
	border-radius: var(--trip-radius);
	background: var(--trip-surface);
}

.settlement[data-failed='true'] {
	border-color: var(--trip-danger);
}

.settlement-heading {
	margin: 0;
	font-size: 20px;
}

.settlement-subheading {
	margin: 4px 0 0;
	font-size: 15px;
}

.settlement-total {
	display: flex;
	flex-wrap: wrap;
	align-items: baseline;
	gap: 10px;
	margin: 0;
}

.settlement-label {
	font-size: 14px;
	color: var(--trip-text-muted);
}

.settlement-transfers {
	display: flex;
	flex-direction: column;
	gap: 4px;
	margin: 0;
	padding: 0;
	list-style: none;
}

.settlement-transfer {
	display: flex;
	flex-wrap: wrap;
	justify-content: space-between;
	gap: 4px 16px;
	padding: 4px 0;
	border-bottom: 1px solid var(--trip-border);
	font-size: 16px;
}

.settlement-amount {
	font-variant-numeric: tabular-nums;
}

.settlement-settled {
	margin: 0;
	font-weight: 600;
	color: var(--trip-ok);
}

.settlement-note {
	margin: 0;
	font-size: 14px;
	color: var(--trip-text-muted);
}

.settlement-failed {
	margin: 0;
	padding: 2px 0 2px 10px;
	border-left: 4px solid var(--trip-danger);
	font-size: 15px;
	font-weight: 600;
	color: var(--trip-danger);
}
</style>
