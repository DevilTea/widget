<script setup lang="ts">
/**
 * Nuxt UI pack. Presentation only: the page's alert (the newest `danger` notification) and status (the newest of any other tone)
 * as `UAlert`s with a close button, from Properties `alert` and `status`. Which notification is the alert is the plugin's rule.
 * Side by side, only the live pack carries `role="alert"` and `role="status"`, so a page has one of each.
 */

import { useWidget } from '@deviltea/widget-vue'
import UAlert from '@nuxt/ui/components/Alert.vue'
import { useInspectAnchor } from '../../../../showcase-host'
import { TONE_MESSAGE_KEYS } from '../../messages'
import { NotifierPlugin } from '../../plugins/notifier'
import { usePacksHost, usePacksText } from '../use-packs-text'

const { useProperties, useMethods, widgetId, widgetType } = useWidget(NotifierPlugin)
const { alert, status, count } = useProperties()
const { dismiss } = useMethods()
const { t, tf, text } = usePacksText()
const { live } = usePacksHost('nui')
const anchor = useInspectAnchor(widgetId, widgetType)
</script>

<template>
	<section
		v-bind="anchor"
		:data-tutorial-target="`packs-${widgetId}`"
		class="flex flex-col gap-2 rounded-md border border-default bg-muted px-4 py-3"
		data-testid="nui-notifier"
	>
		<h4 class="text-base font-semibold text-highlighted">
			{{ t('notifierHeading') }}
		</h4>
		<UAlert
			v-if="alert !== null && alert !== undefined"
			:role="live() ? 'alert' : undefined"
			color="error"
			variant="soft"
			icon="i-lucide-triangle-alert"
			:title="t(TONE_MESSAGE_KEYS[alert.tone])"
			:description="text(alert.message)"
			:close="{ 'aria-label': tf('dismissNamed', { text: text(alert.message) }), 'data-testid': 'nui-alert-dismiss' }"
			:ui="{ close: 'p-1' }"
			data-testid="nui-alert"
			@update:open="dismiss(alert.id)"
		/>
		<div
			:role="live() ? 'status' : undefined"
			data-testid="nui-status"
			:class="status === null || status === undefined ? 'sr-only' : undefined"
		>
			<UAlert
				v-if="status !== null && status !== undefined"
				:color="status.tone === 'success' ? 'success' : 'info'"
				variant="soft"
				:icon="status.tone === 'success' ? 'i-lucide-circle-check' : 'i-lucide-info'"
				:title="t(TONE_MESSAGE_KEYS[status.tone])"
				:description="text(status.message)"
				:close="{ 'aria-label': tf('dismissNamed', { text: text(status.message) }), 'data-testid': 'nui-status-dismiss' }"
				:ui="{ close: 'p-1' }"
				@update:open="dismiss(status.id)"
			/>
		</div>
		<p
			v-if="(count ?? 0) === 0"
			class="text-sm text-muted"
		>
			{{ t('notifierEmpty') }}
		</p>
	</section>
</template>
