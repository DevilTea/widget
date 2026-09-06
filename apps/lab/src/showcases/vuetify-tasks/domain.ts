/**
 * Domain vocabulary for the Vuetify task-workspace showcase.
 *
 * Business state stays framework-agnostic. Vuetify appears only in `renderers/`; these values are the
 * semantic payload consumed by Widget Core plugins and their dependency edges.
 */

export type TaskLocale = 'en' | 'zh-TW'
export type TaskThemeMode = 'system' | 'light' | 'dark'
export type TaskFilter = 'all' | 'open' | 'done'
export type NotificationTone = 'success' | 'error' | 'info'

export interface TaskItem {
	readonly id: string
	readonly title: string
	readonly done: boolean
}

export interface TaskMessages {
	readonly appTitle: string
	readonly appSubtitle: string
	readonly searchLabel: string
	readonly searchPlaceholder: string
	readonly filterLabel: string
	readonly filterAll: string
	readonly filterOpen: string
	readonly filterDone: string
	readonly createTask: string
	readonly editTask: string
	readonly newTask: string
	readonly taskTitle: string
	readonly save: string
	readonly cancel: string
	readonly delete: string
	readonly edit: string
	readonly empty: string
	readonly language: string
	readonly theme: string
	readonly tasksTitle: string
	readonly tasksShown: string
	readonly taskCreated: string
	readonly taskUpdated: string
	readonly taskDeleted: string
	readonly taskCompleted: string
	readonly taskReopened: string
}

export const taskMessages: Readonly<Record<TaskLocale, TaskMessages>> = {
	'en': {
		appTitle: 'Widget Task Workspace',
		appSubtitle: 'Vuetify rendered, Widget driven',
		searchLabel: 'Search',
		searchPlaceholder: 'Search tasks',
		filterLabel: 'Status',
		filterAll: 'All',
		filterOpen: 'Open',
		filterDone: 'Done',
		createTask: 'New task',
		editTask: 'Edit task',
		newTask: 'Create task',
		taskTitle: 'Task title',
		save: 'Save',
		cancel: 'Cancel',
		delete: 'Delete',
		edit: 'Edit',
		empty: 'No tasks match the current filters.',
		language: 'Language',
		theme: 'Theme',
		tasksTitle: 'Tasks',
		tasksShown: 'tasks shown',
		taskCreated: 'Task created',
		taskUpdated: 'Task updated',
		taskDeleted: 'Task deleted',
		taskCompleted: 'Task completed',
		taskReopened: 'Task reopened',
	},
	'zh-TW': {
		appTitle: 'Widget 任務工作區',
		appSubtitle: 'Vuetify 負責呈現，Widget 負責語意',
		searchLabel: '搜尋',
		searchPlaceholder: '搜尋任務',
		filterLabel: '狀態',
		filterAll: '全部',
		filterOpen: '未完成',
		filterDone: '已完成',
		createTask: '新增任務',
		editTask: '編輯任務',
		newTask: '建立任務',
		taskTitle: '任務名稱',
		save: '儲存',
		cancel: '取消',
		delete: '刪除',
		edit: '編輯',
		empty: '目前沒有符合篩選條件的任務。',
		language: '語言',
		theme: '主題',
		tasksTitle: '任務',
		tasksShown: '筆任務',
		taskCreated: '任務已建立',
		taskUpdated: '任務已更新',
		taskDeleted: '任務已刪除',
		taskCompleted: '任務已完成',
		taskReopened: '任務已重新開啟',
	},
}

export const seedTasks: readonly TaskItem[] = [
	{ id: 'task-1', title: 'Map Widget state to Vuetify controls', done: true },
	{ id: 'task-2', title: 'Inspect cross-widget dependencies', done: false },
	{ id: 'task-3', title: 'Exercise the editor dialog', done: false },
	{ id: 'task-4', title: 'Switch locale and theme mode', done: false },
]

export function isPlainObject(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export function isTaskLocale(value: unknown): value is TaskLocale {
	return value === 'en' || value === 'zh-TW'
}

export function isTaskThemeMode(value: unknown): value is TaskThemeMode {
	return value === 'system' || value === 'light' || value === 'dark'
}

export function isTaskFilter(value: unknown): value is TaskFilter {
	return value === 'all' || value === 'open' || value === 'done'
}

export function isNotificationTone(value: unknown): value is NotificationTone {
	return value === 'success' || value === 'error' || value === 'info'
}

export function isTaskItem(value: unknown): value is TaskItem {
	return isPlainObject(value)
		&& typeof value.id === 'string'
		&& typeof value.title === 'string'
		&& typeof value.done === 'boolean'
}

export function isTaskArray(value: unknown): value is readonly TaskItem[] {
	return Array.isArray(value) && value.every(isTaskItem)
}

export function isTaskMessages(value: unknown): value is TaskMessages {
	if (!isPlainObject(value))
		return false
	return Object.keys(taskMessages.en)
		.every(key => typeof value[key] === 'string')
}
