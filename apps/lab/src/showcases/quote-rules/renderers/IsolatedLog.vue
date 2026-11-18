<script setup lang="ts">
/**
 * The exceptions Core isolated and handed to this page's isolated-error handler (`./quote-host.ts`). Each entry is
 * the exception as thrown (`name: message`) and, because the handler is given nothing else, the widget and member
 * the host found by reading each rule again.
 */
import { computed, inject, useId } from 'vue'
import { BUTTON_STYLE } from './control-style'
import { QuoteHostKey } from './quote-host'
import { useQuoteText } from './use-quote-text'

const host = inject(QuoteHostKey, null)
const { t, tf } = useQuoteText()
const headingId = useId()
const entries = computed(() => host?.exceptions.value ?? [])
</script>

<template>
	<section
		v-if="host !== null"
		:aria-labelledby="headingId"
		class="log"
		data-testid="quote-isolated"
		:data-count="entries.length"
		data-tutorial-target="quote-isolated"
	>
		<div class="log-header">
			<h2
				:id="headingId"
				class="log-heading"
			>
				{{ t('isolatedHeading') }}
			</h2>
			<button
				v-if="entries.length > 0"
				type="button"
				class="log-button"
				:style="BUTTON_STYLE"
				data-testid="quote-isolated-clear"
				@click="host.clearExceptions()"
			>
				{{ t('clear') }}
			</button>
		</div>
		<p class="log-intro">
			{{ t('isolatedIntro') }}
		</p>
		<p
			v-if="entries.length === 0"
			class="log-empty"
		>
			{{ t('isolatedEmpty') }}
		</p>
		<ol
			v-else
			class="log-list"
		>
			<li
				v-for="entry in entries"
				:key="entry.sequence"
				class="log-entry"
				data-testid="quote-isolated-entry"
			>
				<code class="log-error">{{ entry.name }}: {{ entry.message }}</code>
				<span class="log-source">{{ entry.widgetId === null ? t('isolatedUnknown') : tf('isolatedFrom', { widget: entry.widgetId, member: entry.member ?? '' }) }}</span>
			</li>
		</ol>
	</section>
</template>

<style scoped>
.log {
	display: flex;
	flex-direction: column;
	gap: 8px;
}

.log-header {
	display: flex;
	flex-wrap: wrap;
	align-items: center;
	justify-content: space-between;
	gap: 8px;
}

.log-heading {
	margin: 0;
	font-size: 18px;
}

.log-intro {
	margin: 0;
	font-size: 14px;
	color: var(--quote-text-muted);
}

.log-empty {
	margin: 0;
	font-size: 14px;
}

.log-list {
	display: flex;
	flex-direction: column;
	gap: 6px;
	margin: 0;
	padding-left: 22px;
}

.log-entry {
	display: flex;
	flex-direction: column;
	gap: 2px;
	font-size: 13px;
}

.log-error {
	overflow-wrap: anywhere;
	color: var(--quote-danger);
}

.log-source {
	color: var(--quote-text-muted);
}

.log-button {
	min-height: 32px;
	padding: 2px 12px;
	border-radius: var(--quote-radius);
	background: var(--quote-surface-alt);
	cursor: pointer;
}
</style>
