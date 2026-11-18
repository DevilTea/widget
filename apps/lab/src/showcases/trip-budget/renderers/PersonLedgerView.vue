<script setup lang="ts">
/**
 * The ledger of one person: what they paid and their share, per expense.
 *
 * This component is the only reader of the Property `ledger`, and it is mounted only while the person's
 * disclosure is open. `useWidget()` here is a bridge of its own: the Runtime subscription it takes (and so the
 * first evaluation of `ledger`) starts when this component renders and is released when it unmounts.
 */
import { useWidget } from '@deviltea/widget-vue'
import { fill, formatMoney } from '../domain'
import { PersonPlugin } from '../plugins/person'

const { useProperties } = useWidget(PersonPlugin)
const { ledger, view } = useProperties()

function money(cents: number): string {
	return view.value === null ? String(cents / 100) : formatMoney(cents, view.value.base, view.value.language)
}
</script>

<template>
	<div
		class="ledger"
		data-testid="trip-ledger"
	>
		<h4 class="ledger-title">
			{{ view?.text.ledgerTitle ?? 'Ledger' }}
		</h4>
		<p
			v-if="ledger === null || ledger.entries.length === 0"
			class="ledger-empty"
		>
			{{ view?.text.ledgerEmpty ?? 'No expenses yet.' }}
		</p>
		<ul
			v-else
			class="ledger-list"
		>
			<li
				v-for="entry in ledger.entries"
				:key="entry.expense"
				class="ledger-entry"
			>
				<span class="ledger-expense">{{ entry.title }}</span>
				<span class="ledger-figures">
					<template v-if="entry.paidCents > 0">{{ fill(view?.text.ledgerPaid ?? 'paid {amount}', { amount: money(entry.paidCents) }) }}</template>
					<template v-if="entry.paidCents > 0 && entry.shareCents > 0"> · </template>
					<template v-if="entry.shareCents > 0">{{ fill(view?.text.ledgerShare ?? 'share {amount}', { amount: money(entry.shareCents) }) }}</template>
				</span>
			</li>
		</ul>
	</div>
</template>

<style scoped>
.ledger {
	padding-top: 6px;
	border-top: 1px solid var(--trip-border);
	font-size: 14px;
}

.ledger-title {
	margin: 0 0 4px;
	font-size: 14px;
}

.ledger-empty {
	margin: 0;
	color: var(--trip-text-muted);
}

.ledger-list {
	display: flex;
	flex-direction: column;
	gap: 4px;
	margin: 0;
	padding: 0;
	list-style: none;
}

.ledger-entry {
	display: flex;
	flex-direction: column;
}

.ledger-figures {
	color: var(--trip-text-muted);
	font-variant-numeric: tabular-nums;
}
</style>
