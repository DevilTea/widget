<script setup lang="ts">
/**
 * Hand-written pack. Presentation only: a native check box with the `switch` role, bound to State `on`.
 */
import { useWidget } from '@deviltea/widget-vue'
import { useInspectAnchor } from '../../../../showcase-host'
import { TogglePlugin } from '../../plugins/toggle'
import { usePacksText } from '../use-packs-text'

const { useState, useProperties, widgetId, widgetType } = useWidget(TogglePlugin)
const { on } = useState()
const { label, density } = useProperties()
const { text } = usePacksText()
const anchor = useInspectAnchor(widgetId, widgetType)
</script>

<template>
	<div
		v-bind="anchor"
		:data-tutorial-target="`packs-${widgetId}`"
		class="toggle"
		:data-packs-density="density ?? 'comfortable'"
	>
		<label class="toggle-label">
			<input
				type="checkbox"
				role="switch"
				class="toggle-box"
				:checked="on === true"
				:data-testid="`hand-switch-${widgetId}`"
				@change="on = ($event.target as HTMLInputElement).checked"
			>
			<span>{{ label === null ? widgetId : text(label) }}</span>
		</label>
	</div>
</template>

<style scoped>
.toggle-label {
	display: inline-flex;
	align-items: center;
	gap: 10px;
	min-height: var(--packs-control-height);
	cursor: pointer;
}

.toggle-box {
	width: 18px;
	height: 18px;
	margin: 0;
	accent-color: var(--packs-accent);
}

.toggle-box:focus-visible {
	outline: 2px solid var(--packs-accent);
	outline-offset: 2px;
}
</style>
