<script setup lang="ts">
/**
 * The same quote, twice. Left: what the live Runtime in this page computes. Right: what the Web Worker computed
 * from the document and the answers alone, in a realm with no DOM. Between them, whether the two outcomes are
 * the same JSON text: they run one set of plugin files, so they are, and a mismatch would be a defect.
 *
 * Presentation only: everything comes from the host (`./quote-host.ts`).
 */
import { computed, inject, useId } from 'vue'
import OutcomeView from './OutcomeView.vue'
import { QuoteHostKey } from './quote-host'
import { useQuoteText } from './use-quote-text'

const host = inject(QuoteHostKey, null)
const { t } = useQuoteText()
const headingId = useId()
/** `document` is only reachable here: the template cannot name it. */
const pageHasDocument = typeof document !== 'undefined'

const worker = computed(() => {
	const view = host?.worker.value
	if (view === undefined || view.status === 'unavailable')
		return null
	return view.status === 'ready' ? view.evaluation : view.previous
})
const rejected = computed(() => worker.value?.rejected ?? [])
const unavailableMessage = computed(() => {
	const view = host?.worker.value
	return view?.status === 'unavailable' ? view.message : null
})
const comparisonText = computed(() => {
	switch (host?.comparison.value) {
		case 'match': return t('match')
		case 'mismatch': return t('mismatch')
		case 'unavailable': return t('unavailable')
		default: return t('pending')
	}
})
</script>

<template>
	<section
		v-if="host !== null"
		:aria-labelledby="headingId"
		class="same"
		data-tutorial-target="quote-same-rules"
	>
		<h2
			:id="headingId"
			class="same-heading"
		>
			{{ t('sameRules') }}
		</h2>
		<p class="same-intro">
			{{ t('sameRulesIntro') }}
		</p>
		<p
			class="same-status"
			role="status"
			data-testid="quote-comparison"
			:data-state="host.comparison.value"
		>
			<span aria-hidden="true">{{ host.comparison.value === 'match' ? '✓ ' : host.comparison.value === 'mismatch' ? '✗ ' : '… ' }}</span>{{ comparisonText }}<template v-if="unavailableMessage !== null">
				: <code>{{ unavailableMessage }}</code>
			</template>
		</p>
		<div class="same-columns">
			<OutcomeView
				side="browser"
				:heading="t('inThisPage')"
				:outcome="host.browser.value"
				:hasDocument="pageHasDocument"
			/>
			<OutcomeView
				side="worker"
				:heading="t('inWorker')"
				:outcome="worker?.outcome ?? null"
				:hasDocument="worker?.environment.hasDocument ?? null"
			/>
		</div>
		<ul
			v-if="rejected.length > 0"
			class="same-rejected"
			:aria-label="t('rejected')"
			data-testid="quote-rejected"
		>
			<li
				v-for="entry in rejected"
				:key="`${entry.widgetId}.${entry.member}`"
			>
				<code>{{ entry.widgetId }}{{ entry.member === null ? '' : `.${entry.member}` }}</code>: {{ entry.messages.join(' ') || entry.reason }}
			</li>
		</ul>
	</section>
</template>

<style scoped>
.same {
	display: flex;
	flex-direction: column;
	gap: 8px;
}

.same-heading {
	margin: 0;
	font-size: 18px;
}

.same-intro {
	margin: 0;
	font-size: 14px;
	color: var(--quote-text-muted);
}

.same-status {
	margin: 0;
	font-size: 14px;
	font-weight: 600;
}

.same-status[data-state='match'] {
	color: var(--quote-ok);
}

.same-status[data-state='mismatch'],
.same-status[data-state='unavailable'] {
	color: var(--quote-danger);
}

.same-columns {
	display: grid;
	grid-template-columns: repeat(auto-fit, minmax(260px, 1fr));
	gap: 10px;
}

.same-rejected {
	margin: 0;
	padding-left: 18px;
	font-size: 13px;
}
</style>
