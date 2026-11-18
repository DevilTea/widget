<script setup lang="ts">
/**
 * Presentation only: the volume discount. It has no control: the discount follows the total quantity of the
 * items. Reads Property `adjustment` (through `useSafeRead`: this is the rule whose code can throw, see
 * `plugins/volume-discount.ts`).
 */
import { useWidget } from '@deviltea/widget-vue'
import { useInspectAnchor } from '../../../showcase-host'
import { VolumeDiscountPlugin } from '../plugins/volume-discount'
import RuleCard from './RuleCard.vue'
import { useQuoteText, useSafeRead } from './use-quote-text'
import { useThrew } from './use-threw'

const { useProperties, config, widgetId, widgetType } = useWidget(VolumeDiscountPlugin)
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
