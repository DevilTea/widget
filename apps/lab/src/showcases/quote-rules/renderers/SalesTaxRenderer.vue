<script setup lang="ts">
/** Presentation only: the sales tax. No control; Property `adjustment` is the tax on the taxable amount. */
import { useWidget } from '@deviltea/widget-vue'
import { useInspectAnchor } from '../../../showcase-host'
import { SalesTaxPlugin } from '../plugins/sales-tax'
import RuleCard from './RuleCard.vue'
import { useQuoteText, useSafeRead } from './use-quote-text'
import { useThrew } from './use-threw'

const { useProperties, config, widgetId, widgetType } = useWidget(SalesTaxPlugin)
const { adjustment } = useProperties()
const read = useSafeRead(adjustment)
const { text } = useQuoteText()
const threw = useThrew(widgetId)
const anchor = useInspectAnchor(widgetId, widgetType)
</script>

<template>
	<RuleCard
		v-bind="anchor"
		:data-tutorial-target="`quote-${widgetId}`"
		:label="text(config.label)"
		:adjustment="read.value"
		:threw="threw || read.threw"
	/>
</template>
