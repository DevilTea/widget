/** Product-shaped source presets for the Vuetify task-workspace showcase. */

import type { TaskLocale, TaskThemeMode } from './domain'
import { seedTasks } from './domain'

export interface VuetifyTaskPreset {
	readonly id: string
	readonly label: string
	readonly description: string
	readonly sourceText: string
}

function taskWorkspaceSource(defaultLocale: TaskLocale, defaultMode: TaskThemeMode): string {
	return JSON.stringify({
		id: 'task-i18n',
		type: 'I18nCapability',
		config: { defaultLocale },
		slots: {
			default: [{
				id: 'task-theme',
				type: 'ThemeCapability',
				config: { defaultMode },
				slots: {
					default: [{
						id: 'task-notifications',
						type: 'NotificationCapability',
						slots: {
							default: [{
								id: 'task-app',
								type: 'TaskAppShell',
								config: { i18nId: 'task-i18n' },
								slots: {
									toolbar: [
										{ id: 'task-search', type: 'TaskSearch', config: { i18nId: 'task-i18n' } },
										{ id: 'task-filter', type: 'TaskStatusFilter', config: { i18nId: 'task-i18n' } },
										{ id: 'task-locale-control', type: 'LocaleControl', config: { i18nId: 'task-i18n' } },
										{ id: 'task-theme-control', type: 'ThemeControl', config: { themeId: 'task-theme', i18nId: 'task-i18n' } },
										{ id: 'task-create', type: 'CreateTaskButton', config: { editorId: 'task-editor', i18nId: 'task-i18n' } },
									],
									main: [
										{ id: 'task-store', type: 'TaskStore', config: { seedTasks } },
										{
											id: 'task-list',
											type: 'TaskList',
											config: {
												storeId: 'task-store',
												searchId: 'task-search',
												filterId: 'task-filter',
												editorId: 'task-editor',
												i18nId: 'task-i18n',
												notificationId: 'task-notifications',
											},
										},
									],
									overlay: [{
										id: 'task-editor',
										type: 'TaskEditor',
										config: {
											storeId: 'task-store',
											i18nId: 'task-i18n',
											notificationId: 'task-notifications',
										},
									}],
								},
							}],
						},
					}],
				},
			}],
		},
	}, null, 2)
}

export const vuetifyTaskPresets: readonly VuetifyTaskPreset[] = [
	{
		id: 'vuetify-tasks-default',
		label: 'Default — Task Workspace',
		description: 'English/system-theme task application with explicit capability-widget dependency wiring.',
		sourceText: taskWorkspaceSource('en', 'system'),
	},
	{
		id: 'vuetify-tasks-zh-dark',
		label: 'Traditional Chinese + dark',
		description: 'The same semantic topology initialized in zh-TW and dark mode, useful for inspecting capability state without changing plugin vocabulary.',
		sourceText: taskWorkspaceSource('zh-TW', 'dark'),
	},
]

export const defaultVuetifyTaskPreset: VuetifyTaskPreset = vuetifyTaskPresets[0]!
