/** Exhaustive Vue/Vuetify renderer registry for the task-workspace showcase. */

import { createWidgetVueRenderer } from '@deviltea/widget-vue'
import { vuetifyTaskSystem } from '../system'
import CreateTaskButtonRenderer from './CreateTaskButtonRenderer.vue'
import I18nCapabilityRenderer from './I18nCapabilityRenderer.vue'
import LocaleControlRenderer from './LocaleControlRenderer.vue'
import NotificationCapabilityRenderer from './NotificationCapabilityRenderer.vue'
import TaskAppShellRenderer from './TaskAppShellRenderer.vue'
import TaskEditorRenderer from './TaskEditorRenderer.vue'
import TaskListRenderer from './TaskListRenderer.vue'
import TaskSearchRenderer from './TaskSearchRenderer.vue'
import TaskStatusFilterRenderer from './TaskStatusFilterRenderer.vue'
import TaskStoreRenderer from './TaskStoreRenderer.vue'
import ThemeCapabilityRenderer from './ThemeCapabilityRenderer.vue'
import ThemeControlRenderer from './ThemeControlRenderer.vue'
import 'vuetify/styles'

export const VuetifyTaskRenderer = createWidgetVueRenderer(vuetifyTaskSystem, renderers =>
	renderers
		.I18nCapability(I18nCapabilityRenderer)
		.ThemeCapability(ThemeCapabilityRenderer)
		.NotificationCapability(NotificationCapabilityRenderer)
		.TaskAppShell(TaskAppShellRenderer)
		.TaskStore(TaskStoreRenderer)
		.TaskSearch(TaskSearchRenderer)
		.TaskStatusFilter(TaskStatusFilterRenderer)
		.LocaleControl(LocaleControlRenderer)
		.ThemeControl(ThemeControlRenderer)
		.CreateTaskButton(CreateTaskButtonRenderer)
		.TaskList(TaskListRenderer)
		.TaskEditor(TaskEditorRenderer))
