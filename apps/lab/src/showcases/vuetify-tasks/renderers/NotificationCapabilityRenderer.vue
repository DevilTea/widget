<script setup lang="ts">
import { useWidget } from '@deviltea/widget-vue'
import { VSnackbar } from 'vuetify/components'
import { useInspectAnchor } from '../../../composables/use-inspect-anchor'
import { NotificationCapabilityPlugin } from '../plugins/capabilities'

const { useState, useMethods, WidgetSlot, widgetId, widgetType } = useWidget(NotificationCapabilityPlugin)
const { open, message, tone } = useState()
const { dismiss } = useMethods()
const inspectAnchor = useInspectAnchor(widgetId, widgetType)

function onOpenUpdate(nextOpen: boolean): void {
	if (!nextOpen)
		dismiss()
}
</script>

<template>
	<div
		v-bind="inspectAnchor"
		style="display: contents"
	>
		<WidgetSlot name="default" />
		<VSnackbar
			:modelValue="open ?? false"
			:color="tone ?? 'info'"
			:timeout="2400"
			location="bottom"
			@update:modelValue="onOpenUpdate"
		>
			{{ message ?? '' }}
		</VSnackbar>
	</div>
</template>
