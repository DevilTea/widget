<script setup lang="ts">
/**
 * Presentation only: a person's name, what they paid, their share of the costs and their balance, and a
 * disclosure that opens their ledger.
 *
 * Reads: Properties `name`, `view`, `paid`, `owed` and `balance`. The ledger is a separate component
 * (`PersonLedgerView.vue`) that only exists while the disclosure is open: it is the only place the lazy
 * Property `ledger` is read, so the Runtime evaluates `ledger` only after a viewer opens it.
 */
import { useWidget } from '@deviltea/widget-vue'
import { computed, ref, useId } from 'vue'
import { useInspectAnchor } from '../../../showcase-host'
import { fill, formatMoney, tripText } from '../domain'
import { PersonPlugin } from '../plugins/person'
import { BUTTON_STYLE } from './control-style'
import PersonLedgerView from './PersonLedgerView.vue'

const { useProperties, widgetId, widgetType } = useWidget(PersonPlugin)
const { name, view, paid, owed, balance } = useProperties()
const text = computed(() => tripText(view.value?.language ?? 'en'))

const ledgerOpen = ref(false)
const ledgerId = useId()
const anchor = useInspectAnchor(widgetId, widgetType)

function money(cents: number | null): string {
	return cents === null || view.value === null ? '—' : formatMoney(cents, view.value.base, view.value.language)
}

const sign = computed<'owed' | 'owes' | 'even' | 'unknown'>(() => {
	if (balance.value === null)
		return 'unknown'
	return balance.value > 0 ? 'owed' : balance.value < 0 ? 'owes' : 'even'
})

const status = computed(() => {
	if (balance.value === null)
		return ''
	if (sign.value === 'owed')
		return `+ ${fill(text.value.isOwed, { amount: money(balance.value) })}`
	if (sign.value === 'owes')
		return `− ${fill(text.value.owes, { amount: money(-balance.value) })}`
	return text.value.isEven
})
</script>

<template>
	<article
		v-bind="anchor"
		:data-tutorial-target="`trip-${widgetId}`"
		:data-balance-sign="sign"
		class="person"
	>
		<h3 class="person-name">
			{{ name ?? widgetId }}
		</h3>
		<p
			data-testid="trip-person-status"
			class="person-status"
			:class="`person-status-${sign}`"
		>
			{{ status }}
		</p>
		<dl class="person-figures">
			<dt>{{ text.paid }}</dt>
			<dd data-testid="trip-person-paid">
				{{ money(paid) }}
			</dd>
			<dt>{{ text.share }}</dt>
			<dd data-testid="trip-person-owed">
				{{ money(owed) }}
			</dd>
		</dl>
		<button
			type="button"
			class="person-toggle"
			:style="BUTTON_STYLE"
			:aria-expanded="ledgerOpen"
			:aria-controls="ledgerId"
			data-testid="trip-ledger-toggle"
			@click="ledgerOpen = !ledgerOpen"
		>
			{{ ledgerOpen ? text.hideLedger : text.showLedger }}
		</button>
		<PersonLedgerView
			v-if="ledgerOpen"
			:id="ledgerId"
		/>
	</article>
</template>

<style scoped>
.person {
	display: flex;
	flex-direction: column;
	gap: 6px;
	padding: 12px 14px;
	border: 1px solid var(--trip-border);
	border-radius: var(--trip-radius);
	background: var(--trip-surface);
}

.person-name {
	margin: 0;
	font-size: 17px;
}

.person-status {
	margin: 0;
	font-size: 15px;
	font-weight: 600;
}

.person-status-owed {
	color: var(--trip-ok);
}

.person-status-owes {
	color: var(--trip-danger);
}

.person-figures {
	display: grid;
	grid-template-columns: 1fr auto;
	gap: 2px 12px;
	margin: 0;
	font-size: 14px;
}

.person-figures dt {
	color: var(--trip-text-muted);
}

.person-figures dd {
	margin: 0;
	text-align: right;
	font-variant-numeric: tabular-nums;
}

/* The button's text colour, size, weight and border are set inline (`control-style.ts`). */
.person-toggle {
	align-self: flex-start;
	min-height: 32px;
	padding: 2px 10px;
	border-radius: var(--trip-radius);
	background: var(--trip-surface-alt);
	cursor: pointer;
}
</style>
