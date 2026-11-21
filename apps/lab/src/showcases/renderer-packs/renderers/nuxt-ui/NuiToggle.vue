<script setup lang="ts">
/**
 * Nuxt UI pack. Presentation only: a `USwitch` bound to State `on`.
 */

import { useWidget } from '@deviltea/widget-vue'
import USwitch from '@nuxt/ui/components/Switch.vue'
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
	>
		<USwitch
			v-model="on"
			:label="label === null ? widgetId : text(label)"
			:size="density === 'compact' ? 'sm' : 'md'"
			:ui="{ label: 'min-h-6' }"
			:data-testid="`nui-switch-${widgetId}`"
		/>
	</div>
</template>
