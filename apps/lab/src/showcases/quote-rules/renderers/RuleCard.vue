<script setup lang="ts">
/**
 * Presentation shared by the four rule renderers: the rule's label, what it did to the quote (a signed amount
 * and a note) and, in the default slot, the control the customer has for it. It reads nothing itself.
 */
import type { Adjustment } from '../domain'
import type { RuleFailure } from './use-threw'
import { computed, inject } from 'vue'
import { QuoteCurrencyKey } from './currency'
import { useQuoteText } from './use-quote-text'

const props = defineProps<{
	readonly label: string
	readonly adjustment: Adjustment | null
	/**
	 * `own`: this rule's code threw (`adjustment` is then the last one that worked). `input`: something this rule reads threw, so
	 * the rule has no amount of its own. `null`: neither.
	 */
	readonly failure: RuleFailure | null
}>()

const { t, tf, signed } = useQuoteText()
const currency = inject(QuoteCurrencyKey, 'EUR')

const note = computed(() => {
	const adjustment = props.adjustment
	if (adjustment === null)
		return t('noPrice')
	if (adjustment.reason === 'free-over-threshold')
		return t('freeOverThreshold')
	if (!adjustment.applied)
		return t('notApplied')
	return adjustment.percent === null ? '' : tf('appliedPercent', { percent: String(adjustment.percent) })
})
</script>

<template>
	<article
		class="rule"
		:data-state="failure === 'own' ? 'threw' : failure === 'input' ? 'input-threw' : adjustment === null ? 'failed' : adjustment.applied ? 'applied' : 'idle'"
	>
		<header class="rule-header">
			<h3 class="rule-title">
				{{ label }}
			</h3>
			<span
				class="rule-amount"
				data-testid="quote-rule-amount"
				:data-cents="adjustment?.cents"
			>{{ adjustment === null ? '—' : signed(adjustment.cents, currency) }}</span>
		</header>
		<p
			v-if="note !== ''"
			class="rule-note"
			data-testid="quote-rule-note"
		>
			{{ note }}
		</p>
		<p
			v-if="failure === 'own'"
			class="rule-threw"
			data-testid="quote-rule-threw"
		>
			<span aria-hidden="true">&#9888; </span>{{ t('threwBadge') }}
		</p>
		<p
			v-if="failure === 'input'"
			class="rule-threw"
			data-testid="quote-rule-input-threw"
		>
			<span aria-hidden="true">&#9888; </span>{{ t('inputThrewBadge') }}
		</p>
		<div class="rule-control">
			<slot />
		</div>
	</article>
</template>

<style scoped>
.rule {
	display: flex;
	flex-direction: column;
	gap: 6px;
	padding: 12px 14px;
	border: 1px solid var(--quote-border);
	border-radius: var(--quote-radius);
	background: var(--quote-surface);
}

.rule[data-state='threw'],
.rule[data-state='input-threw'],
.rule[data-state='failed'] {
	border-color: var(--quote-danger);
}

.rule-header {
	display: flex;
	flex-wrap: wrap;
	align-items: baseline;
	justify-content: space-between;
	gap: 8px;
}

.rule-title {
	margin: 0;
	font-size: 16px;
}

.rule-amount {
	font-size: 17px;
	font-weight: 600;
	font-variant-numeric: tabular-nums;
}

.rule-note {
	margin: 0;
	font-size: 13px;
	color: var(--quote-text-muted);
}

.rule-threw {
	margin: 0;
	padding: 2px 0 2px 10px;
	border-left: 4px solid var(--quote-danger);
	font-size: 14px;
	font-weight: 600;
	color: var(--quote-danger);
}

.rule-control:empty {
	display: none;
}
</style>
