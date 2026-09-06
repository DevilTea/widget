<script setup lang="ts">
import { useWidget } from '@deviltea/widget-vue'
import { watch } from 'vue'
import { useTheme } from 'vuetify'
import { useInspectAnchor } from '../../../composables/use-inspect-anchor'
import { ThemeCapabilityPlugin } from '../plugins/capabilities'

const { useState, WidgetSlot, widgetId, widgetType } = useWidget(ThemeCapabilityPlugin)
const { mode } = useState()
const vuetifyTheme = useTheme()
const inspectAnchor = useInspectAnchor(widgetId, widgetType)

// Widget State is authoritative. Vuetify receives a one-way renderer projection only.
watch(mode, (nextMode) => {
	void vuetifyTheme.change(nextMode ?? 'system')
}, { immediate: true })
</script>

<template>
	<div
		v-bind="inspectAnchor"
		style="display: contents"
	>
		<WidgetSlot name="default" />
	</div>
</template>
