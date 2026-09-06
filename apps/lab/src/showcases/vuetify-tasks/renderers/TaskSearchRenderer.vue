<script setup lang="ts">
import { useWidget } from '@deviltea/widget-vue'
import { VTextField } from 'vuetify/components'
import { useInspectAnchor } from '../../../composables/use-inspect-anchor'
import { TaskSearchPlugin } from '../plugins/controls'

const { useState, useProperties, widgetId, widgetType } = useWidget(TaskSearchPlugin)
const { value } = useState()
const { messages } = useProperties()
const inspectAnchor = useInspectAnchor(widgetId, widgetType)

function onUpdate(nextValue: string | null): void {
	value.value = nextValue ?? ''
}
</script>

<template>
	<VTextField
		v-bind="inspectAnchor"
		:modelValue="value ?? ''"
		:label="messages?.searchLabel ?? ''"
		:placeholder="messages?.searchPlaceholder ?? ''"
		clearable
		density="compact"
		hideDetails
		variant="outlined"
		style="min-width: 220px"
		@update:modelValue="onUpdate"
	/>
</template>
