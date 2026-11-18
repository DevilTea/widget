<script setup lang="ts">
/**
 * Presentation only: the quote's title, "Start over", the items, the pricing rules, the totals, and the two panels the
 * host drives (the same rules in a Web Worker, the isolated exceptions).
 *
 * The page paints itself from its own `--quote-*` custom properties, chosen by the host's light/dark theme
 * (`useShowcaseHost()` of the showcase host contract); no chrome token is used.
 *
 * Reads: Property `quote` (through `useSafeRead`: a rule that throws does not break the page, which then keeps
 * the last amounts that worked and says so). "Start over" asks the host (`./quote-host.ts`) to call Core's
 * `runtime.resetState()`.
 */
import { useWidget } from '@deviltea/widget-vue'
import { computed, inject, provide, useId } from 'vue'
import { useInspectAnchor, useShowcaseHost } from '../../../showcase-host'
import { QuotePlugin } from '../plugins/quote'
import { BUTTON_STYLE } from './control-style'
import { QuoteCurrencyKey } from './currency'
import IsolatedLog from './IsolatedLog.vue'
import { QuoteHostKey } from './quote-host'
import SameRulesPanel from './SameRulesPanel.vue'
import { useQuoteText, useSafeRead } from './use-quote-text'

const { useProperties, WidgetSlot, config, widgetId, widgetType } = useWidget(QuotePlugin)
const { quote } = useProperties()
const read = useSafeRead(quote)
const { t, text, money, signed } = useQuoteText()
const host = inject(QuoteHostKey, null)
const { theme } = useShowcaseHost()
provide(QuoteCurrencyKey, config.currency)

const itemsHeadingId = useId()
const rulesHeadingId = useId()
const totalsHeadingId = useId()
const anchor = useInspectAnchor(widgetId, widgetType)

/** The live Runtime's quote failed with an exception while the page still shows the amounts of the last good one. */
const stale = computed(() => {
	const outcome = host?.browser.value
	return read.value.threw || (outcome !== undefined && !outcome.ok && outcome.failure.kind === 'exception')
})
</script>

<template>
	<main
		v-bind="anchor"
		:data-tutorial-target="`quote-${widgetId}`"
		:data-quote-theme="theme"
		class="quote"
	>
		<header class="quote-header">
			<h1 class="quote-title">
				{{ text(config.title) }}
			</h1>
			<button
				type="button"
				class="quote-button"
				:style="BUTTON_STYLE"
				:title="t('startOverHint')"
				data-testid="quote-start-over"
				data-tutorial-target="quote-start-over"
				@click="host?.resetAll()"
			>
				{{ t('startOver') }}
			</button>
		</header>

		<p
			v-if="stale"
			class="quote-stale"
			role="alert"
			data-testid="quote-stale"
		>
			<span aria-hidden="true">&#9888; </span>{{ t('staleBanner') }}
		</p>

		<section
			:aria-labelledby="itemsHeadingId"
			class="quote-section"
		>
			<h2
				:id="itemsHeadingId"
				class="quote-heading"
			>
				{{ t('items') }}
			</h2>
			<div class="quote-stack">
				<WidgetSlot name="items" />
			</div>
		</section>

		<section
			:aria-labelledby="rulesHeadingId"
			class="quote-section"
		>
			<h2
				:id="rulesHeadingId"
				class="quote-heading"
			>
				{{ t('rules') }}
			</h2>
			<div class="quote-stack">
				<WidgetSlot name="rules" />
			</div>
		</section>

		<section
			:aria-labelledby="totalsHeadingId"
			class="quote-section quote-totals"
			:data-stale="stale"
			data-tutorial-target="quote-totals"
		>
			<h2
				:id="totalsHeadingId"
				class="quote-heading"
			>
				{{ t('quoteHeading') }}
			</h2>
			<dl
				v-if="read.value !== null"
				class="quote-lines"
			>
				<div class="quote-line">
					<dt>{{ t('subtotal') }}</dt>
					<dd data-testid="quote-subtotal">
						{{ money(read.value.subtotalCents, read.value.currency) }}
					</dd>
				</div>
				<div
					v-for="adjustment in read.value.adjustments"
					:key="adjustment.id"
					class="quote-line"
				>
					<dt>{{ text(adjustment.label) }}</dt>
					<dd>{{ signed(adjustment.cents, read.value.currency) }}</dd>
				</div>
				<div class="quote-line quote-total">
					<dt>{{ t('total') }}</dt>
					<dd
						data-testid="quote-total"
						:data-cents="read.value.totalCents"
					>
						{{ money(read.value.totalCents, read.value.currency) }}
					</dd>
				</div>
			</dl>
			<p
				v-else
				class="quote-none"
				data-testid="quote-none"
			>
				{{ t('noQuote') }}
			</p>
		</section>

		<SameRulesPanel />
		<IsolatedLog />
	</main>
</template>

<style scoped>
/* Dark is the default, like the frame; light is chosen by `data-quote-theme`. Every descendant inherits these. */
.quote {
	--quote-bg: #14161a;
	--quote-surface: #1b1e24;
	--quote-surface-alt: #22262e;
	--quote-border: #2c313a;
	--quote-text: #e6e8eb;
	--quote-text-muted: #9aa2af;
	--quote-accent: #5b9dff;
	--quote-danger: #f2545b;
	--quote-ok: #3fbf7f;
	--quote-radius: 6px;
	--quote-font-mono: "SFMono-Regular", ui-monospace, Menlo, Consolas, monospace;
	background: var(--quote-bg);
	min-height: 100%;
}

.quote[data-quote-theme='light'] {
	--quote-bg: #f6f7f9;
	--quote-surface: #ffffff;
	--quote-surface-alt: #eef1f5;
	--quote-border: #d4d9e2;
	--quote-text: #1b1f24;
	--quote-text-muted: #596273;
	--quote-accent: #1769e0;
	--quote-danger: #c9373f;
	--quote-ok: #18794e;
}

.quote {
	display: flex;
	flex-direction: column;
	gap: 16px;
	box-sizing: border-box;
	padding: 20px max(20px, calc((100% - 760px) / 2));
	color: var(--quote-text);
	font-size: 15px;
	color-scheme: dark;
}

.quote[data-quote-theme='light'] {
	color-scheme: light;
}

.quote-header {
	display: flex;
	flex-wrap: wrap;
	align-items: center;
	justify-content: space-between;
	gap: 12px;
}

.quote-title {
	margin: 0;
	font-size: 26px;
	line-height: 1.25;
}

/* Text colour, size, weight and border of the controls are set inline (`control-style.ts`). */
.quote-button {
	min-height: 36px;
	padding: 4px 12px;
	border-radius: var(--quote-radius);
	background: var(--quote-surface-alt);
	cursor: pointer;
}

.quote-stale {
	margin: 0;
	padding: 6px 0 6px 12px;
	border-left: 4px solid var(--quote-danger);
	font-size: 14px;
	font-weight: 600;
	color: var(--quote-danger);
}

.quote-section {
	display: flex;
	flex-direction: column;
	gap: 8px;
}

.quote-heading {
	margin: 0;
	font-size: 18px;
}

.quote-stack {
	display: flex;
	flex-direction: column;
	gap: 10px;
}

.quote-totals {
	padding: 12px 14px;
	border: 1px solid var(--quote-border);
	border-radius: var(--quote-radius);
	background: var(--quote-surface);
}

.quote-totals[data-stale='true'] {
	border-color: var(--quote-danger);
}

.quote-lines {
	display: flex;
	flex-direction: column;
	gap: 4px;
	margin: 0;
}

.quote-line {
	display: flex;
	justify-content: space-between;
	gap: 12px;
	font-variant-numeric: tabular-nums;
}

.quote-line dt {
	color: var(--quote-text-muted);
}

.quote-line dd {
	margin: 0;
}

.quote-total {
	padding-top: 6px;
	border-top: 1px solid var(--quote-border);
	font-size: 20px;
	font-weight: 700;
}

.quote-total dt {
	color: var(--quote-text);
}

.quote-none {
	margin: 0;
}
</style>
