<script setup lang="ts">
/**
 * Hand-written pack. Presentation only: the page's alert (the newest `danger` notification) and status (the newest of any other
 * tone), each with a Dismiss button, from Properties `alert` and `status`. Which notification is the alert is the plugin's
 * rule. Side by side, only the live pack carries `role="alert"` and `role="status"`, so a page has one of each.
 */
import { useWidget } from '@deviltea/widget-vue'
import { useInspectAnchor } from '../../../../showcase-host'
import { TONE_MESSAGE_KEYS } from '../../messages'
import { NotifierPlugin } from '../../plugins/notifier'
import { usePacksHost, usePacksText } from '../use-packs-text'

const { useProperties, useMethods, widgetId, widgetType } = useWidget(NotifierPlugin)
const { alert, status, count } = useProperties()
const { dismiss } = useMethods()
const { t, tf, text } = usePacksText()
const { live } = usePacksHost('hand')
const anchor = useInspectAnchor(widgetId, widgetType)
</script>

<template>
	<section
		v-bind="anchor"
		:data-tutorial-target="`packs-${widgetId}`"
		class="notifier"
		data-testid="hand-notifier"
	>
		<h4 class="notifier-title">
			{{ t('notifierHeading') }}
		</h4>
		<p
			v-if="alert !== null && alert !== undefined"
			:role="live() ? 'alert' : undefined"
			class="notifier-item notifier-item--danger"
			data-testid="hand-alert"
		>
			<strong>{{ t(TONE_MESSAGE_KEYS[alert.tone]) }}</strong>
			<span class="notifier-text">{{ text(alert.message) }}</span>
			<button
				type="button"
				class="notifier-dismiss"
				:aria-label="tf('dismissNamed', { text: text(alert.message) })"
				data-testid="hand-alert-dismiss"
				@click="dismiss(alert.id)"
			>
				{{ t('dismiss') }}
			</button>
		</p>
		<p
			:role="live() ? 'status' : undefined"
			class="notifier-item notifier-item--status"
			:class="{ 'notifier-item--empty': status === null || status === undefined }"
			data-testid="hand-status"
		>
			<template v-if="status !== null && status !== undefined">
				<strong>{{ t(TONE_MESSAGE_KEYS[status.tone]) }}</strong>
				<span class="notifier-text">{{ text(status.message) }}</span>
				<button
					type="button"
					class="notifier-dismiss"
					:aria-label="tf('dismissNamed', { text: text(status.message) })"
					data-testid="hand-status-dismiss"
					@click="dismiss(status.id)"
				>
					{{ t('dismiss') }}
				</button>
			</template>
		</p>
		<p
			v-if="(count ?? 0) === 0"
			class="notifier-empty"
		>
			{{ t('notifierEmpty') }}
		</p>
	</section>
</template>

<style scoped>
.notifier {
	display: flex;
	flex-direction: column;
	gap: 8px;
	padding: 12px 16px;
	border: 1px solid var(--packs-border);
	border-radius: var(--packs-radius);
	background: var(--packs-surface);
}

.notifier-title {
	margin: 0;
	font-size: 16px;
}

.notifier-item {
	display: flex;
	flex-wrap: wrap;
	align-items: center;
	gap: 4px 10px;
	margin: 0;
	padding: 8px 12px;
	border: 1px solid var(--packs-border);
	border-radius: var(--packs-radius);
	background: var(--packs-surface-alt);
}

/* An empty status region stays in the accessibility tree (a live region that is `display: none` announces nothing when it fills). */
.notifier-item--empty {
	position: absolute;
	width: 1px;
	height: 1px;
	margin: -1px;
	padding: 0;
	border: 0;
	overflow: hidden;
	clip-path: inset(50%);
}

.notifier-item--danger {
	border-color: var(--packs-danger);
}

.notifier-item--danger strong {
	color: var(--packs-danger);
}

.notifier-item--status strong {
	color: var(--packs-ok);
}

.notifier-text {
	flex: 1 1 auto;
}

.notifier-empty {
	margin: 0;
	font-size: 14px;
	color: var(--packs-text-muted);
}

.notifier-dismiss {
	min-width: 24px;
	min-height: 24px;
	padding: 2px 10px;
	border: 1px solid var(--packs-control-border);
	border-radius: var(--packs-radius);
	background: transparent;
	color: var(--packs-text);
	font: inherit;
	font-size: 13px;
	cursor: pointer;
}

.notifier-dismiss:focus-visible {
	outline: 2px solid var(--packs-accent);
	outline-offset: 2px;
}
</style>
