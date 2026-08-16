<script setup lang="ts">
import { useWidget } from '@deviltea/widget-vue'
import { useInspectAnchor } from '../../../composables/use-inspect-anchor'
import { ToolbarPlugin } from '../plugins/structural'

const { WidgetSlot, widgetId, widgetType } = useWidget(ToolbarPlugin)
const inspectAnchor = useInspectAnchor(widgetId, widgetType)
</script>

<template>
	<div
		v-bind="inspectAnchor"
		:class="pika({ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', gap: '12px', flexWrap: 'wrap' })"
	>
		<div :class="pika({ display: 'flex', alignItems: 'flex-end', gap: '10px', flexWrap: 'wrap' })">
			<WidgetSlot name="start" />
		</div>
		<div :class="pika({ display: 'flex', alignItems: 'flex-end', gap: '8px' })">
			<WidgetSlot name="end" />
		</div>
	</div>
</template>
