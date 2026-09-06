/** Plugin tuple for the Vuetify task-workspace showcase. */

import { I18nCapabilityPlugin, NotificationCapabilityPlugin, ThemeCapabilityPlugin } from './capabilities'
import {
	CreateTaskButtonPlugin,
	LocaleControlPlugin,
	TaskSearchPlugin,
	TaskStatusFilterPlugin,
	ThemeControlPlugin,
} from './controls'
import { TaskAppShellPlugin } from './structural'
import { TaskEditorPlugin } from './task-editor'
import { TaskListPlugin } from './task-list'
import { TaskStorePlugin } from './task-store'

export * from './capabilities'
export * from './controls'
export * from './structural'
export * from './task-editor'
export * from './task-list'
export * from './task-store'

export const vuetifyTaskPlugins = [
	I18nCapabilityPlugin,
	ThemeCapabilityPlugin,
	NotificationCapabilityPlugin,
	TaskAppShellPlugin,
	TaskStorePlugin,
	TaskSearchPlugin,
	TaskStatusFilterPlugin,
	LocaleControlPlugin,
	ThemeControlPlugin,
	CreateTaskButtonPlugin,
	TaskListPlugin,
	TaskEditorPlugin,
] as const

export type VuetifyTaskPlugins = typeof vuetifyTaskPlugins
