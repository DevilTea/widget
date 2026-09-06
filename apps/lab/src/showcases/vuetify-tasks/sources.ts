/** Curated Implementation-explorer source registry for the Vuetify task workspace. */

import type { CuratedWidgetTypeSources, SourcesRegistry } from '../../implementation/types'

const ROOT = 'apps/lab/src/showcases/vuetify-tasks'

function sourceEntry(
	pluginTitle: string,
	pluginPath: string,
	pluginLoad: () => Promise<string>,
	rendererTitle: string,
	rendererPath: string,
	rendererLoad: () => Promise<string>,
	includeDomain = false,
): CuratedWidgetTypeSources {
	const plugin = { kind: 'plugin' as const, title: pluginTitle, path: `${ROOT}/${pluginPath}`, load: pluginLoad }
	const renderer = { kind: 'renderer' as const, title: rendererTitle, path: `${ROOT}/${rendererPath}`, load: rendererLoad }
	if (!includeDomain)
		return { files: [plugin, renderer] }
	return {
		files: [
			plugin,
			renderer,
			{ kind: 'domain', title: 'domain.ts', path: `${ROOT}/domain.ts`, load: () => import('./domain.ts?raw').then(module => module.default) },
		],
	}
}

const loadCapabilities = () => import('./plugins/capabilities.ts?raw').then(module => module.default)
const loadControls = () => import('./plugins/controls.ts?raw').then(module => module.default)
const loadStructural = () => import('./plugins/structural.ts?raw').then(module => module.default)
const loadTaskStore = () => import('./plugins/task-store.ts?raw').then(module => module.default)
const loadTaskList = () => import('./plugins/task-list.ts?raw').then(module => module.default)
const loadTaskEditor = () => import('./plugins/task-editor.ts?raw').then(module => module.default)

export const vuetifyTaskSources: SourcesRegistry = {
	I18nCapability: sourceEntry(
		'capabilities.ts',
		'plugins/capabilities.ts',
		loadCapabilities,
		'I18nCapabilityRenderer.vue',
		'renderers/I18nCapabilityRenderer.vue',
		() => import('./renderers/I18nCapabilityRenderer.vue?raw').then(module => module.default),
		true,
	),
	ThemeCapability: sourceEntry(
		'capabilities.ts',
		'plugins/capabilities.ts',
		loadCapabilities,
		'ThemeCapabilityRenderer.vue',
		'renderers/ThemeCapabilityRenderer.vue',
		() => import('./renderers/ThemeCapabilityRenderer.vue?raw').then(module => module.default),
		true,
	),
	NotificationCapability: sourceEntry(
		'capabilities.ts',
		'plugins/capabilities.ts',
		loadCapabilities,
		'NotificationCapabilityRenderer.vue',
		'renderers/NotificationCapabilityRenderer.vue',
		() => import('./renderers/NotificationCapabilityRenderer.vue?raw').then(module => module.default),
		true,
	),
	TaskAppShell: sourceEntry(
		'structural.ts',
		'plugins/structural.ts',
		loadStructural,
		'TaskAppShellRenderer.vue',
		'renderers/TaskAppShellRenderer.vue',
		() => import('./renderers/TaskAppShellRenderer.vue?raw').then(module => module.default),
		true,
	),
	TaskStore: sourceEntry(
		'task-store.ts',
		'plugins/task-store.ts',
		loadTaskStore,
		'TaskStoreRenderer.vue',
		'renderers/TaskStoreRenderer.vue',
		() => import('./renderers/TaskStoreRenderer.vue?raw').then(module => module.default),
		true,
	),
	TaskSearch: sourceEntry(
		'controls.ts',
		'plugins/controls.ts',
		loadControls,
		'TaskSearchRenderer.vue',
		'renderers/TaskSearchRenderer.vue',
		() => import('./renderers/TaskSearchRenderer.vue?raw').then(module => module.default),
		true,
	),
	TaskStatusFilter: sourceEntry(
		'controls.ts',
		'plugins/controls.ts',
		loadControls,
		'TaskStatusFilterRenderer.vue',
		'renderers/TaskStatusFilterRenderer.vue',
		() => import('./renderers/TaskStatusFilterRenderer.vue?raw').then(module => module.default),
		true,
	),
	LocaleControl: sourceEntry(
		'controls.ts',
		'plugins/controls.ts',
		loadControls,
		'LocaleControlRenderer.vue',
		'renderers/LocaleControlRenderer.vue',
		() => import('./renderers/LocaleControlRenderer.vue?raw').then(module => module.default),
		true,
	),
	ThemeControl: sourceEntry(
		'controls.ts',
		'plugins/controls.ts',
		loadControls,
		'ThemeControlRenderer.vue',
		'renderers/ThemeControlRenderer.vue',
		() => import('./renderers/ThemeControlRenderer.vue?raw').then(module => module.default),
		true,
	),
	CreateTaskButton: sourceEntry(
		'controls.ts',
		'plugins/controls.ts',
		loadControls,
		'CreateTaskButtonRenderer.vue',
		'renderers/CreateTaskButtonRenderer.vue',
		() => import('./renderers/CreateTaskButtonRenderer.vue?raw').then(module => module.default),
		true,
	),
	TaskList: sourceEntry(
		'task-list.ts',
		'plugins/task-list.ts',
		loadTaskList,
		'TaskListRenderer.vue',
		'renderers/TaskListRenderer.vue',
		() => import('./renderers/TaskListRenderer.vue?raw').then(module => module.default),
		true,
	),
	TaskEditor: sourceEntry(
		'task-editor.ts',
		'plugins/task-editor.ts',
		loadTaskEditor,
		'TaskEditorRenderer.vue',
		'renderers/TaskEditorRenderer.vue',
		() => import('./renderers/TaskEditorRenderer.vue?raw').then(module => module.default),
		true,
	),
}
