<script setup lang="ts">
/**
 * Hand-written pack. Presentation only: a native select bound to State `value`. A value that is not one of the options is
 * refused by the State's own validation, so the select can only show what the widget holds.
 */
import { useWidget } from '@deviltea/widget-vue'
import { useId } from 'vue'
import { useInspectAnchor } from '../../../../showcase-host'
import { ChoicePlugin } from '../../plugins/choice'
import { usePacksText } from '../use-packs-text'

const { useState, useProperties, widgetId, widgetType } = useWidget(ChoicePlugin)
const { value } = useState()
const { label, options, density } = useProperties()
const { text } = usePacksText()
const anchor = useInspectAnchor(widgetId, widgetType)
const selectId = useId()
</script>

<template>
	<div
		v-bind="anchor"
		:data-tutorial-target="`packs-${widgetId}`"
		class="choice"
		:data-packs-density="density ?? 'comfortable'"
	>
		<label
			:for="selectId"
			class="choice-label"
		>{{ label === null ? widgetId : text(label) }}</label>
		<select
			:id="selectId"
			class="choice-select"
			:value="value ?? ''"
			:data-testid="`hand-select-${widgetId}`"
			@change="value = ($event.target as HTMLSelectElement).value"
		>
			<option
				v-for="option in options ?? []"
				:key="option.value"
				:value="option.value"
				:selected="option.value === value"
			>
				{{ text(option.label) }}
			</option>
		</select>
	</div>
</template>

<style scoped>
.choice {
	display: flex;
	flex-direction: column;
	gap: 4px;
	max-width: 420px;
}

.choice-label {
	font-size: 14px;
	font-weight: 600;
}

.choice-select {
	box-sizing: border-box;
	min-height: var(--packs-control-height);
	padding: 4px 10px;
	border: 1px solid var(--packs-control-border);
	border-radius: var(--packs-radius);
	background: var(--packs-surface-alt);
	color: var(--packs-text);
	font: inherit;
	font-size: 15px;
}

.choice-select:focus-visible {
	outline: 2px solid var(--packs-accent);
	outline-offset: 2px;
}
</style>
