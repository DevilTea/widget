<script setup lang="ts">
/**
 * Thin presentation only: `format` selects number-vs-currency display — the actual computed number
 * always comes from `DealQuery` through the configured `PropertySourceConfig` dependency, never local
 * math. See `../plugins/read-models.ts`'s file header for why `label`/`format` are exposed as
 * properties here (a deliberate, narrow deviation from the checkpoint's literal capability list).
 */
import { useWidget } from '@deviltea/widget-vue'
import { computed } from 'vue'
import { useInspectAnchor } from '../../../composables/use-inspect-anchor'
import { MetricCardPlugin } from '../plugins/read-models'

const { useProperties, widgetId, widgetType } = useWidget(MetricCardPlugin)
const { value, label, format } = useProperties()

const displayValue = computed(() => {
	const numericValue = value.value ?? 0
	return format.value === 'currency'
		? `$${numericValue.toLocaleString('en-US', { maximumFractionDigits: 0 })}`
		: numericValue.toLocaleString('en-US', { maximumFractionDigits: 0 })
})
const inspectAnchor = useInspectAnchor(widgetId, widgetType)
</script>

<template>
	<div
		v-bind="inspectAnchor"
		:class="pika({ display: 'flex', flexDirection: 'column', gap: '2px', minWidth: '140px' })"
	>
		<span :class="pika({ fontSize: '11px', color: 'var(--lab-color-text-muted)' })">{{ label }}</span>
		<strong :class="pika({ fontSize: '20px' })">{{ displayValue }}</strong>
	</div>
</template>
