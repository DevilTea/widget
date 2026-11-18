<script setup lang="ts">
/**
 * Presentation only: delivery. The customer chooses State `method`; Property `adjustment` is the courier fee
 * (waived from the configured subtotal on).
 */
import { useWidget } from '@deviltea/widget-vue'
import { useId } from 'vue'
import { useInspectAnchor } from '../../../showcase-host'
import { DeliveryPlugin } from '../plugins/delivery'
import { FIELD_STYLE } from './control-style'
import RuleCard from './RuleCard.vue'
import { useQuoteText, useSafeRead } from './use-quote-text'
import { useRuleFailure } from './use-threw'

const { useState, useProperties, config, widgetId, widgetType } = useWidget(DeliveryPlugin)
const { method } = useState()
const { adjustment } = useProperties()
const read = useSafeRead(adjustment)
const { t, text } = useQuoteText()
const failure = useRuleFailure(widgetId, read)
const anchor = useInspectAnchor(widgetId, widgetType)
const selectId = useId()

function onChange(event: Event): void {
	method.value = (event.target as HTMLSelectElement).value as 'pickup' | 'courier'
}
</script>

<template>
	<RuleCard
		v-bind="anchor"
		:data-tutorial-target="`quote-${widgetId}`"
		:label="text(config.label)"
		:adjustment="read.value"
		:failure="failure"
	>
		<div class="delivery-field">
			<label
				:for="selectId"
				class="delivery-label"
			>{{ t('deliveryMethod') }}</label>
			<select
				:id="selectId"
				:value="method ?? 'pickup'"
				class="delivery-input"
				:style="FIELD_STYLE"
				data-testid="quote-delivery"
				@change="onChange"
			>
				<option value="pickup">
					{{ t('pickup') }}
				</option>
				<option value="courier">
					{{ t('courier') }}
				</option>
			</select>
		</div>
	</RuleCard>
</template>

<style scoped>
.delivery-field {
	display: flex;
	flex-direction: column;
	gap: 2px;
}

.delivery-label {
	font-size: 13px;
	color: var(--quote-text-muted);
}

.delivery-input {
	box-sizing: border-box;
	align-self: flex-start;
	min-width: 180px;
	min-height: 36px;
	padding: 4px 10px;
	border-radius: var(--quote-radius);
	background: var(--quote-surface-alt);
}
</style>
