<script setup lang="ts">
import { useWidget } from '@deviltea/widget-vue'
import { VBtn } from 'vuetify/components'
import { useInspectAnchor } from '../../../composables/use-inspect-anchor'
import { CreateTaskButtonPlugin } from '../plugins/controls'

const { useProperties, useMethods, widgetId, widgetType } = useWidget(CreateTaskButtonPlugin)
const { messages } = useProperties()
const { press } = useMethods()
const inspectAnchor = useInspectAnchor(widgetId, widgetType)

function onClick(): void {
	press()
}
</script>

<template>
	<VBtn
		v-bind="inspectAnchor"
		color="primary"
		size="small"
		variant="flat"
		@click="onClick"
	>
		{{ messages?.createTask ?? 'New task' }}
	</VBtn>
</template>
