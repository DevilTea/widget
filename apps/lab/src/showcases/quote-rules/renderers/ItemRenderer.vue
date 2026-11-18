<script setup lang="ts">
/**
 * Presentation only: one printed item. The customer edits State `quantity` and `paper`; the form checks nothing
 * itself: a quantity the schema library refuses is not stored (`state.set()` fails and the field shows the
 * stored value again), and a paper the item does not list is stored and makes `line` fail.
 *
 * Reads: Property `line` (through `useSafeRead`, so a rule that throws cannot break this component). Writes State
 * `quantity` and `paper`.
 */
import { useWidget } from '@deviltea/widget-vue'
import { computed, inject, useId } from 'vue'
import { useInspectAnchor } from '../../../showcase-host'
import { ItemPlugin } from '../plugins/item'
import { FIELD_STYLE } from './control-style'
import { QuoteCurrencyKey } from './currency'
import { useQuoteText, useSafeRead } from './use-quote-text'

const { useState, useStateDiagnostics, useProperties, config, widgetId, widgetType } = useWidget(ItemPlugin)
const { quantity, paper } = useState()
const { quantity: quantityDiagnostics } = useStateDiagnostics()
const { line } = useProperties()
const read = useSafeRead(line)
const { t, tf, text, money } = useQuoteText()
const currency = inject(QuoteCurrencyKey, 'EUR')

const quantityId = useId()
const quantityErrorId = useId()
/** What the schema library said about the last quantity that was refused (verbatim); empty once a valid one is stored. */
const quantityErrors = computed(() => (quantityDiagnostics.value ?? []).map(diagnostic => diagnostic.message))
const paperId = useId()
const anchor = useInspectAnchor(widgetId, widgetType)

/** The papers on offer, plus the one State holds when it is not among them (so the select can show it). */
const paperOptions = computed(() => {
	const codes = Object.keys(config.papers)
	return paper.value !== null && !codes.includes(paper.value) ? [...codes, paper.value] : codes
})

function paperName(code: string): string {
	return Object.hasOwn(config.papers, code) ? text(config.papers[code]!.label) : code
}

function onQuantityInput(event: Event): void {
	const raw = (event.target as HTMLInputElement).value
	quantity.value = raw === '' ? Number.NaN : Number(raw)
}

function onPaperChange(event: Event): void {
	paper.value = (event.target as HTMLSelectElement).value
}

/** A focused number input changes its value on the mouse wheel; scrolling the page must not edit the quantity. */
function onWheel(event: Event): void {
	(event.target as HTMLInputElement).blur()
}
</script>

<template>
	<article
		v-bind="anchor"
		:data-tutorial-target="`quote-${widgetId}`"
		:data-priced="read.value !== null"
		class="item"
	>
		<header class="item-header">
			<h3 class="item-title">
				{{ text(config.title) }}
			</h3>
			<span
				v-if="read.value !== null"
				class="item-unit"
			>{{ tf('perPiece', { price: money(read.value.unitCents, currency) }) }}</span>
		</header>

		<div class="item-fields">
			<div class="item-field">
				<label
					:for="quantityId"
					class="item-label"
				>{{ t('quantity') }}</label>
				<input
					:id="quantityId"
					type="number"
					inputmode="numeric"
					step="1"
					:value="quantity ?? ''"
					class="item-input"
					:style="FIELD_STYLE"
					:aria-invalid="quantityErrors.length > 0 ? 'true' : undefined"
					:aria-describedby="quantityErrors.length > 0 ? quantityErrorId : undefined"
					data-testid="quote-quantity"
					@input="onQuantityInput"
					@wheel="onWheel"
				>
			</div>
			<div class="item-field">
				<label
					:for="paperId"
					class="item-label"
				>{{ t('paper') }}</label>
				<select
					:id="paperId"
					:value="paper ?? ''"
					class="item-input"
					:style="FIELD_STYLE"
					data-testid="quote-paper"
					@change="onPaperChange"
				>
					<option
						v-for="code in paperOptions"
						:key="code"
						:value="code"
					>
						{{ paperName(code) }}
					</option>
				</select>
			</div>
			<p
				class="item-line"
				data-testid="quote-line-total"
				:data-cents="read.value?.cents"
			>
				<span v-if="read.value !== null">{{ money(read.value.cents, currency) }}</span>
				<span
					v-else
					class="item-no-price"
				>{{ t('noPrice') }}</span>
			</p>
		</div>
		<div
			:id="quantityErrorId"
			aria-live="polite"
			class="item-errors"
		>
			<p
				v-for="message in quantityErrors"
				:key="message"
				class="item-error"
				data-testid="quote-quantity-error"
			>
				<span aria-hidden="true">&#9888; </span>{{ t('quantity') }}: {{ message }}
			</p>
		</div>
	</article>
</template>

<style scoped>
.item {
	display: flex;
	flex-direction: column;
	gap: 8px;
	padding: 12px 14px;
	border: 1px solid var(--quote-border);
	border-radius: var(--quote-radius);
	background: var(--quote-surface);
}

.item[data-priced='false'] {
	border-color: var(--quote-danger);
}

.item-header {
	display: flex;
	flex-wrap: wrap;
	align-items: baseline;
	justify-content: space-between;
	gap: 8px;
}

.item-title {
	margin: 0;
	font-size: 17px;
}

.item-unit {
	font-size: 13px;
	color: var(--quote-text-muted);
	font-variant-numeric: tabular-nums;
}

.item-fields {
	display: flex;
	flex-wrap: wrap;
	align-items: flex-end;
	gap: 8px 12px;
}

.item-field {
	display: flex;
	flex-direction: column;
	gap: 2px;
}

.item-label {
	font-size: 13px;
	color: var(--quote-text-muted);
}

/* Text colour, size, weight and border of the controls are set inline (`control-style.ts`). */
.item-input {
	box-sizing: border-box;
	min-width: 96px;
	min-height: 36px;
	padding: 4px 10px;
	border-radius: var(--quote-radius);
	background: var(--quote-surface-alt);
}

.item-line {
	margin: 0 0 0 auto;
	font-size: 18px;
	font-weight: 600;
	font-variant-numeric: tabular-nums;
}

.item-errors:empty {
	display: none;
}

.item-error {
	margin: 0;
	padding: 2px 0 2px 10px;
	border-left: 4px solid var(--quote-danger);
	font-size: 14px;
	font-weight: 600;
	color: var(--quote-danger);
}

.item-no-price {
	color: var(--quote-danger);
}
</style>
