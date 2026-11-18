<script setup lang="ts">
/**
 * Presentation only: one expense line. The viewer edits State `amount`, `currency`, `paidBy` and (equal split)
 * `among`; the form never checks anything itself: a negative or missing amount is stored and the plugin reports
 * it in `errors`, and an expense with an error is not counted in the settlement.
 *
 * Reads: Properties `title`, `view`, `roster`, `currencies`, `errors`, `amountBase` and `counted` (the
 * `breakdown` is read only by `ExpenseBreakdownView.vue`, which exists only while the breakdown is open, so it
 * stays unevaluated until then). A conversion that failed projects `amountBase` to `null`, which is shown as
 * "no rate for this currency". "Reset this expense" asks the host (`./host.ts`) to call Core's
 * `resetState()` for this widget: its State goes back to the authored values.
 */
import { useWidget } from '@deviltea/widget-vue'
import { computed, inject, ref, useId } from 'vue'
import { fill, formatMoney, tripText } from '../domain'
import { ExpensePlugin } from '../plugins/expense'
import { useInspectAnchor } from './anchor'
import { BUTTON_STYLE, FIELD_STYLE } from './control-style'
import ExpenseBreakdownView from './ExpenseBreakdownView.vue'
import { TripResetHostKey } from './reset-host'

const { useState, useProperties, config, widgetId, widgetType } = useWidget(ExpensePlugin)
const { amount, currency, paidBy, among } = useState()
const { title, view, roster, currencies, errors, amountBase, counted } = useProperties()
const text = computed(() => tripText(view.value?.language ?? 'en'))
const host = inject(TripResetHostKey, null)

const amountId = useId()
const currencyId = useId()
const paidById = useId()
const breakdownId = useId()
const errorsId = useId()
const anchor = useInspectAnchor(widgetId, widgetType)
const breakdownOpen = ref(false)

/** The supported codes, plus the expense's own code when it is not one of them (so the select can show it). */
const currencyOptions = computed(() => {
	const codes = currencies.value ?? []
	return currency.value !== null && !codes.includes(currency.value) ? [...codes, currency.value] : codes
})

const converted = computed(() => {
	const base = view.value?.base
	if (base === undefined || currency.value === base || amountBase.value === null || amountBase.value === 0)
		return null
	return fill(text.value.asBase, { amount: formatMoney(amountBase.value, base, view.value!.language) })
})

/** `amountBase` projects to null when the conversion failed (a currency with no rate). */
const conversionFailed = computed(() => amountBase.value === null)
const splitLabel = computed(() => config.split.mode === 'equal' ? text.value.splitEqual : text.value.splitPercent)
const percentLines = computed(() => {
	if (config.split.mode !== 'percent')
		return []
	const names = new Map((roster.value ?? []).map(entry => [entry.id, entry.name]))
	return Object.entries(config.split.percents)
		.map(([id, percent]) => `${names.get(id) ?? id} ${percent}%`)
})

function onAmountInput(event: Event): void {
	const raw = (event.target as HTMLInputElement).value
	const parsed = raw === '' ? Number.NaN : Number(raw)
	amount.value = Number.isFinite(parsed) ? parsed : null
}

function onCurrencyChange(event: Event): void {
	currency.value = (event.target as HTMLSelectElement).value
}

function onPaidByChange(event: Event): void {
	const value = (event.target as HTMLSelectElement).value
	paidBy.value = value === '' ? null : value
}

function onToggleParticipant(id: string, checked: boolean): void {
	const current = among.value ?? []
	among.value = checked ? [...current.filter(other => other !== id), id] : current.filter(other => other !== id)
}

/** A focused number input changes its value on the mouse wheel; scrolling the page must not edit the amount. */
function onWheel(event: Event): void {
	(event.target as HTMLInputElement).blur()
}
</script>

<template>
	<article
		v-bind="anchor"
		:data-tutorial-target="`trip-${widgetId}`"
		:data-counted="counted === true"
		class="expense"
	>
		<header class="expense-header">
			<h3 class="expense-title">
				{{ title ?? widgetId }}
			</h3>
			<span class="expense-split">{{ splitLabel }}</span>
		</header>

		<div class="expense-fields">
			<div class="expense-field">
				<label
					:for="amountId"
					class="expense-label"
				>{{ text.amount }}</label>
				<input
					:id="amountId"
					type="number"
					inputmode="decimal"
					step="any"
					:value="amount ?? ''"
					class="expense-input"
					:style="FIELD_STYLE"
					:aria-invalid="errors !== null && errors.length > 0 ? 'true' : undefined"
					:aria-describedby="errors !== null && errors.length > 0 ? errorsId : undefined"
					data-testid="trip-amount"
					@input="onAmountInput"
					@wheel="onWheel"
				>
			</div>
			<div class="expense-field">
				<label
					:for="currencyId"
					class="expense-label"
				>{{ text.currency }}</label>
				<select
					:id="currencyId"
					:value="currency ?? ''"
					class="expense-input"
					:style="FIELD_STYLE"
					data-testid="trip-currency"
					@change="onCurrencyChange"
				>
					<option
						v-for="code in currencyOptions"
						:key="code"
						:value="code"
					>
						{{ code }}
					</option>
				</select>
			</div>
			<div class="expense-field">
				<label
					:for="paidById"
					class="expense-label"
				>{{ text.paidBy }}</label>
				<select
					:id="paidById"
					:value="paidBy ?? ''"
					class="expense-input"
					:style="FIELD_STYLE"
					data-testid="trip-paid-by"
					@change="onPaidByChange"
				>
					<option value="">
						—
					</option>
					<option
						v-for="entry in roster ?? []"
						:key="entry.id"
						:value="entry.id"
					>
						{{ entry.name }}
					</option>
				</select>
			</div>
		</div>

		<p
			v-if="converted !== null"
			data-testid="trip-converted"
			class="expense-converted"
		>
			{{ converted }}
		</p>

		<fieldset
			v-if="config.split.mode === 'equal'"
			class="expense-participants"
		>
			<legend class="expense-label">
				{{ text.sharedBy }}
			</legend>
			<label
				v-for="entry in roster ?? []"
				:key="entry.id"
				class="expense-participant"
			>
				<input
					type="checkbox"
					class="expense-checkbox"
					:checked="(among ?? []).includes(entry.id)"
					:data-testid="`trip-share-${entry.id}`"
					@change="onToggleParticipant(entry.id, ($event.target as HTMLInputElement).checked)"
				>
				{{ entry.name }}
			</label>
		</fieldset>
		<p
			v-else
			data-testid="trip-percents"
			class="expense-percents"
		>
			<span class="expense-label">{{ text.sharedBy }}</span>
			{{ percentLines.join(' · ') }}
		</p>

		<div
			:id="errorsId"
			aria-live="polite"
			class="expense-errors"
		>
			<p
				v-for="error in errors ?? []"
				:key="error.code"
				data-testid="trip-expense-error"
				:data-error-code="error.code"
				class="expense-error"
			>
				<span aria-hidden="true">&#9888; </span>{{ error.message }} {{ text.notCounted }}
			</p>
			<p
				v-if="conversionFailed"
				role="alert"
				data-testid="trip-conversion-failed"
				class="expense-error"
			>
				<span aria-hidden="true">&#9888; </span>{{ text.conversionFailed }}
			</p>
		</div>

		<div class="expense-actions">
			<button
				type="button"
				class="expense-button"
				:style="BUTTON_STYLE"
				data-testid="trip-reset-expense"
				@click="host?.resetWidget(widgetId)"
			>
				{{ text.resetExpense }}
			</button>
			<button
				type="button"
				class="expense-button"
				:style="BUTTON_STYLE"
				:aria-expanded="breakdownOpen"
				:aria-controls="breakdownId"
				data-testid="trip-breakdown-toggle"
				@click="breakdownOpen = !breakdownOpen"
			>
				{{ breakdownOpen ? text.hideBreakdown : text.showBreakdown }}
			</button>
		</div>

		<ExpenseBreakdownView
			v-if="breakdownOpen"
			:id="breakdownId"
		/>
	</article>
</template>

<style scoped>
.expense {
	display: flex;
	flex-direction: column;
	gap: 8px;
	padding: 12px 14px;
	border: 1px solid var(--trip-border);
	border-radius: var(--trip-radius);
	background: var(--trip-surface);
}

.expense[data-counted='false'] {
	border-color: var(--trip-danger);
}

.expense-header {
	display: flex;
	flex-wrap: wrap;
	align-items: baseline;
	justify-content: space-between;
	gap: 8px;
}

.expense-title {
	margin: 0;
	font-size: 17px;
}

.expense-split {
	font-size: 13px;
	color: var(--trip-text-muted);
}

.expense-fields {
	display: flex;
	flex-wrap: wrap;
	gap: 8px 12px;
}

.expense-field {
	display: flex;
	flex-direction: column;
	gap: 2px;
}

.expense-label {
	font-size: 13px;
	color: var(--trip-text-muted);
}

/* Text colour, size, weight and border of the controls are set inline (`control-style.ts`). */
.expense-input {
	box-sizing: border-box;
	min-width: 96px;
	min-height: 36px;
	padding: 4px 10px;
	border-radius: var(--trip-radius);
	background: var(--trip-surface-alt);
}

.expense-converted {
	margin: 0;
	font-size: 14px;
	color: var(--trip-text-muted);
	font-variant-numeric: tabular-nums;
}

.expense-participants {
	display: flex;
	flex-wrap: wrap;
	gap: 4px 14px;
	margin: 0;
	padding: 0;
	border: none;
}

.expense-participants legend {
	padding: 0;
	margin-bottom: 2px;
	float: left;
	margin-right: 10px;
}

.expense-participant {
	display: inline-flex;
	align-items: center;
	gap: 6px;
	min-height: 28px;
	font-size: 14px;
	cursor: pointer;
}

.expense-checkbox {
	width: 18px;
	height: 18px;
	margin: 0;
	accent-color: var(--trip-accent);
}

.expense-percents {
	margin: 0;
	font-size: 14px;
}

.expense-errors:empty {
	display: none;
}

.expense-error {
	margin: 0;
	padding: 2px 0 2px 10px;
	border-left: 4px solid var(--trip-danger);
	font-size: 14px;
	font-weight: 600;
	color: var(--trip-danger);
}

.expense-actions {
	display: flex;
	flex-wrap: wrap;
	gap: 8px;
}

.expense-button {
	min-height: 32px;
	padding: 2px 12px;
	border-radius: var(--trip-radius);
	background: var(--trip-surface-alt);
	cursor: pointer;
}
</style>
