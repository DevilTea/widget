<script setup lang="ts">
import type { TaskFilter } from '../domain'
import { useWidget } from '@deviltea/widget-vue'
import { computed } from 'vue'
import { VSelect } from 'vuetify/components'
import { useInspectAnchor } from '../../../composables/use-inspect-anchor'
import { isTaskFilter } from '../domain'
import { TaskStatusFilterPlugin } from '../plugins/controls'

const { useState, useProperties, widgetId, widgetType } = useWidget(TaskStatusFilterPlugin)
const { value } = useState()
const { messages } = useProperties()
const inspectAnchor = useInspectAnchor(widgetId, widgetType)

const items = computed(() => [
	{ title: messages.value?.filterAll ?? '', value: 'all' as TaskFilter },
	{ title: messages.value?.filterOpen ?? '', value: 'open' as TaskFilter },
	{ title: messages.value?.filterDone ?? '', value: 'done' as TaskFilter },
])

function onUpdate(nextValue: unknown): void {
	if (isTaskFilter(nextValue))
		value.value = nextValue
}
</script>

<template>
	<VSelect
		v-bind="inspectAnchor"
		:modelValue="value ?? 'all'"
		:items="items"
		:label="messages?.filterLabel ?? ''"
		density="compact"
		hideDetails
		variant="outlined"
		style="min-width: 150px"
		@update:modelValue="onUpdate"
	/>
</template>
