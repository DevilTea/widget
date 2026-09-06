<script setup lang="ts">
import { useWidget } from '@deviltea/widget-vue'
import { VBtn } from 'vuetify/components'
import { useInspectAnchor } from '../../../composables/use-inspect-anchor'
import { LocaleControlPlugin } from '../plugins/controls'

const { useProperties, useMethods, widgetId, widgetType } = useWidget(LocaleControlPlugin)
const { locale, messages } = useProperties()
const { toggle } = useMethods()
const inspectAnchor = useInspectAnchor(widgetId, widgetType)

function onClick(): void {
	toggle()
}
</script>

<template>
	<VBtn
		v-bind="inspectAnchor"
		variant="text"
		size="small"
		:aria-label="messages?.language ?? 'Language'"
		@click="onClick"
	>
		{{ locale === 'en' ? '中文' : 'EN' }}
	</VBtn>
</template>
