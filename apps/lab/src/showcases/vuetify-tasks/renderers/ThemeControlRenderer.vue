<script setup lang="ts">
import { useWidget } from '@deviltea/widget-vue'
import { VBtn } from 'vuetify/components'
import { useInspectAnchor } from '../../../composables/use-inspect-anchor'
import { ThemeControlPlugin } from '../plugins/controls'

const { useProperties, useMethods, widgetId, widgetType } = useWidget(ThemeControlPlugin)
const { mode, messages } = useProperties()
const { cycle } = useMethods()
const inspectAnchor = useInspectAnchor(widgetId, widgetType)

function onClick(): void {
	cycle()
}
</script>

<template>
	<VBtn
		v-bind="inspectAnchor"
		variant="text"
		size="small"
		:aria-label="messages?.theme ?? 'Theme'"
		@click="onClick"
	>
		{{ messages?.theme ?? 'Theme' }}: {{ mode ?? 'system' }}
	</VBtn>
</template>
