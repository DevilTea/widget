<script setup lang="ts">
import { useWidget } from '@deviltea/widget-vue'
import { useInspectAnchor } from '../../../composables/use-inspect-anchor'
import { I18nCapabilityPlugin } from '../plugins/capabilities'

const { WidgetSlot, widgetId, widgetType } = useWidget(I18nCapabilityPlugin)
const inspectAnchor = useInspectAnchor(widgetId, widgetType)
</script>

<template>
	<div
		v-bind="inspectAnchor"
		style="display: contents"
	>
		<WidgetSlot name="default" />
	</div>
</template>
