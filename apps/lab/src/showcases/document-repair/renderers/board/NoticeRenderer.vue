<script setup lang="ts">
/**
 * Presentation only: one notice of the repaired board (headline, text, the last day it is shown, its tone). The tone is
 * written as a word as well as a colour. No inspect anchor, see `BoardRenderer.vue`.
 */
import { useWidget } from '@deviltea/widget-vue'
import { NoticePlugin } from '../../board/plugins'
import { useRepairText } from '../use-repair-text'

const { useProperties, widgetId } = useWidget(NoticePlugin)
const { title, body, until, tone } = useProperties()
const { t, tf, date } = useRepairText()
</script>

<template>
	<article
		class="notice"
		:class="`notice--${tone ?? 'info'}`"
		:data-testid="`repair-notice-${widgetId}`"
	>
		<p class="notice-title">
			<span class="notice-tone">{{ tone === 'warning' ? t('toneWarning') : t('toneInfo') }}</span>
			{{ title }}
		</p>
		<p class="notice-body">
			{{ body }}
		</p>
		<p class="notice-until">
			{{ tf('boardUntil', { date: until === null ? '' : date(until) }) }}
		</p>
	</article>
</template>

<style scoped>
.notice {
	padding: 10px 12px;
	border: 1px solid var(--repair-border);
	border-left: 4px solid var(--repair-accent);
	border-radius: var(--repair-radius);
	background: var(--repair-surface);
}

.notice--warning {
	border-left-color: var(--repair-warning);
}

.notice-title {
	margin: 0 0 4px;
	font-size: 15px;
	font-weight: 600;
}

.notice-tone {
	margin-right: 6px;
	font-size: 12px;
	font-weight: 600;
	text-transform: uppercase;
	color: var(--repair-text-muted);
}

.notice-body,
.notice-until {
	margin: 0;
}

.notice-until {
	margin-top: 4px;
	font-size: 13px;
	color: var(--repair-text-muted);
}
</style>
