<script setup lang="ts">
/**
 * Presentation only: the rush surcharge. The customer switches State `enabled`; Property `adjustment` is the
 * surcharge.
 */
import { useWidget } from '@deviltea/widget-vue'
import { useId } from 'vue'
import { useInspectAnchor } from '../../../showcase-host'
import { RushSurchargePlugin } from '../plugins/rush-surcharge'
import RuleCard from './RuleCard.vue'
import { useQuoteText, useSafeRead } from './use-quote-text'
import { useThrew } from './use-threw'

const { useState, useProperties, config, widgetId, widgetType } = useWidget(RushSurchargePlugin)
const { enabled } = useState()
const { adjustment } = useProperties()
const read = useSafeRead(adjustment)
const { text } = useQuoteText()
const threw = useThrew(widgetId)
const anchor = useInspectAnchor(widgetId, widgetType)
const checkboxId = useId()
</script>

<template>
	<RuleCard
		v-bind="anchor"
		:data-tutorial-target="`quote-${widgetId}`"
		:label="text(config.label)"
		:adjustment="read.value"
		:threw="threw || read.threw"
	>
		<label
			:for="checkboxId"
			class="rush-toggle"
		>
			<input
				:id="checkboxId"
				type="checkbox"
				class="rush-checkbox"
				:checked="enabled === true"
				data-testid="quote-rush"
				@change="enabled = ($event.target as HTMLInputElement).checked"
			>
			{{ text(config.label) }}
		</label>
	</RuleCard>
</template>

<style scoped>
.rush-toggle {
	display: inline-flex;
	align-items: center;
	gap: 8px;
	min-height: 28px;
	font-size: 14px;
	cursor: pointer;
}

.rush-checkbox {
	width: 18px;
	height: 18px;
	margin: 0;
	accent-color: var(--quote-accent);
}
</style>
