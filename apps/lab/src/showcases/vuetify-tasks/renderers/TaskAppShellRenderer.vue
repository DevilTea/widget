<script setup lang="ts">
import { useWidget } from '@deviltea/widget-vue'
import { VApp, VAppBar, VAppBarTitle, VMain, VSpacer } from 'vuetify/components'
import { useInspectAnchor } from '../../../composables/use-inspect-anchor'
import { TaskAppShellPlugin } from '../plugins/structural'

const { useProperties, WidgetSlot, widgetId, widgetType } = useWidget(TaskAppShellPlugin)
const { messages } = useProperties()
const inspectAnchor = useInspectAnchor(widgetId, widgetType)
</script>

<template>
	<VApp
		v-bind="inspectAnchor"
		class="task-app-shell"
		data-testid="vuetify-task-app"
	>
		<VAppBar
			absolute
			flat
			density="comfortable"
		>
			<VAppBarTitle>
				<div style="line-height: 1.2">
					<div>{{ messages?.appTitle ?? '' }}</div>
					<div style="font-size: 0.72rem; opacity: 0.7; font-weight: 400">
						{{ messages?.appSubtitle ?? '' }}
					</div>
				</div>
			</VAppBarTitle>
			<VSpacer />
			<div style="display: flex; gap: 6px; align-items: center; padding-inline-end: 12px">
				<WidgetSlot name="toolbar" />
			</div>
		</VAppBar>
		<VMain>
			<div style="padding: 18px; display: grid; gap: 14px">
				<WidgetSlot name="main" />
			</div>
		</VMain>
		<WidgetSlot name="overlay" />
	</VApp>
</template>

<style scoped>
.task-app-shell {
	position: relative;
	min-height: 560px;
	overflow: hidden;
}

/* VApp defaults to viewport height because it is normally the application root. In Widget Lab this
 * renderer is an embedded application, so its layout root must stay inside the Preview surface. */
.task-app-shell :deep(.v-application__wrap) {
	min-height: 560px;
}
</style>
