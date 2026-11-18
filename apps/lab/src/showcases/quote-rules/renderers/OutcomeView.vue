<script setup lang="ts">
/**
 * One side of the side-by-side comparison: where the quote was computed, a short reading of the outcome JSON, and
 * the JSON itself on demand. Everything shown is read from the `outcome` it is given, which is the JSON the side
 * produced, so the two columns are two readings of two JSON texts.
 */
import type { QuoteOutcome } from '../evaluate'
import { computed, ref, useId } from 'vue'
import { BUTTON_STYLE } from './control-style'
import { useQuoteText } from './use-quote-text'

const props = defineProps<{
	readonly heading: string
	readonly outcome: QuoteOutcome | null
	/** `true` when the realm that computed it had a `document`; `null` when that is not known yet. */
	readonly hasDocument: boolean | null
	readonly side: 'browser' | 'worker'
}>()

const { t, tf, text, money, signed } = useQuoteText()
const jsonId = useId()
const jsonOpen = ref(false)

const json = computed(() => props.outcome === null ? '' : JSON.stringify(props.outcome, null, 2))

const failure = computed(() => {
	const outcome = props.outcome
	if (outcome === null || outcome.ok)
		return null
	const detail = outcome.failure
	switch (detail.kind) {
		case 'exception':
			return {
				title: detail.widgetId === null ? tf('failureExceptionUnknown', { name: detail.name }) : tf('failureException', { widget: `${detail.widgetId}.${detail.member}`, name: detail.name }),
				detail: detail.message,
			}
		case 'diagnostics':
			return { title: t('failureDiagnostics'), detail: detail.diagnostics.map(entry => `${entry.widgetId}.${entry.member}: ${entry.message}`)
				.join(' ') }
		case 'invalid-document':
			return { title: t('failureInvalidDocument'), detail: detail.diagnostics.map(entry => entry.message)
				.join(' ') }
		case 'invalid-request':
			return { title: t('failureInvalidRequest'), detail: detail.message }
		default:
			return null
	}
})
</script>

<template>
	<section
		class="outcome"
		:data-side="side"
		:data-ok="outcome === null ? 'pending' : outcome.ok ? 'true' : 'false'"
	>
		<h3 class="outcome-heading">
			{{ heading }}
		</h3>
		<p
			class="outcome-env"
			:data-testid="`quote-${side}-env`"
			:data-has-document="hasDocument === null ? undefined : String(hasDocument)"
		>
			{{ hasDocument === null ? '…' : hasDocument ? t('hasDom') : t('noDom') }}
		</p>

		<dl
			v-if="outcome !== null && outcome.ok"
			class="outcome-lines"
		>
			<div class="outcome-line">
				<dt>{{ t('subtotal') }}</dt>
				<dd>{{ money(outcome.quote.subtotalCents, outcome.quote.currency) }}</dd>
			</div>
			<div
				v-for="adjustment in outcome.quote.adjustments"
				:key="adjustment.id"
				class="outcome-line"
			>
				<dt>{{ text(adjustment.label) }}</dt>
				<dd>{{ signed(adjustment.cents, outcome.quote.currency) }}</dd>
			</div>
			<div class="outcome-line outcome-total">
				<dt>{{ t('total') }}</dt>
				<dd :data-testid="`quote-${side}-total`">
					{{ money(outcome.quote.totalCents, outcome.quote.currency) }}
				</dd>
			</div>
		</dl>
		<div
			v-else-if="failure !== null"
			class="outcome-failure"
			:data-testid="`quote-${side}-failure`"
			role="status"
		>
			<p class="outcome-failure-title">
				<span aria-hidden="true">&#9888; </span>{{ failure.title }}
			</p>
			<p class="outcome-failure-detail">
				<code>{{ failure.detail }}</code>
			</p>
		</div>
		<p
			v-else
			class="outcome-waiting"
		>
			…
		</p>

		<button
			type="button"
			class="outcome-button"
			:style="BUTTON_STYLE"
			:aria-expanded="jsonOpen"
			:aria-controls="jsonId"
			:data-testid="`quote-${side}-json-toggle`"
			:disabled="outcome === null"
			@click="jsonOpen = !jsonOpen"
		>
			{{ jsonOpen ? t('hideJson') : t('showJson') }}
		</button>
		<pre
			v-if="jsonOpen"
			:id="jsonId"
			class="outcome-json"
			tabindex="0"
			:data-testid="`quote-${side}-json`"
		>{{ json }}</pre>
	</section>
</template>

<style scoped>
.outcome {
	display: flex;
	flex-direction: column;
	gap: 8px;
	min-width: 0;
	padding: 12px 14px;
	border: 1px solid var(--quote-border);
	border-radius: var(--quote-radius);
	background: var(--quote-surface);
}

.outcome-heading {
	margin: 0;
	font-size: 16px;
}

.outcome-env {
	margin: 0;
	font-size: 13px;
	color: var(--quote-text-muted);
}

.outcome-lines {
	display: flex;
	flex-direction: column;
	gap: 2px;
	margin: 0;
}

.outcome-line {
	display: flex;
	justify-content: space-between;
	gap: 12px;
	font-size: 14px;
	font-variant-numeric: tabular-nums;
}

.outcome-line dt {
	color: var(--quote-text-muted);
}

.outcome-line dd {
	margin: 0;
}

.outcome-total {
	padding-top: 4px;
	border-top: 1px solid var(--quote-border);
	font-weight: 700;
}

.outcome-total dt {
	color: var(--quote-text);
}

.outcome-failure {
	padding: 2px 0 2px 10px;
	border-left: 4px solid var(--quote-danger);
}

.outcome-failure-title {
	margin: 0;
	font-size: 14px;
	font-weight: 600;
	color: var(--quote-danger);
}

.outcome-failure-detail {
	margin: 4px 0 0;
	font-size: 13px;
	overflow-wrap: anywhere;
}

.outcome-waiting {
	margin: 0;
	color: var(--quote-text-muted);
}

.outcome-button {
	align-self: flex-start;
	min-height: 32px;
	padding: 2px 12px;
	border-radius: var(--quote-radius);
	background: var(--quote-surface-alt);
	cursor: pointer;
}

.outcome-json {
	box-sizing: border-box;
	max-height: 280px;
	margin: 0;
	padding: 8px 10px;
	overflow: auto;
	border: 1px solid var(--quote-border);
	border-radius: var(--quote-radius);
	background: var(--quote-surface-alt);
	font-family: var(--quote-font-mono);
	font-size: 12px;
	line-height: 1.45;
}
</style>
