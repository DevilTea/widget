/**
 * Read model + task-row actions for the Vuetify task showcase.
 *
 * Search/filter semantics and all cross-widget actions live here. The Vue renderer only presents
 * `visibleTasks` and calls these Methods. Every external dependency targets a stable Widget id so the
 * exact topology remains visible to Blueprint/Runtime/Dependencies inspection.
 */

import type { WidgetInterfaces } from '@deviltea/widget-core'
import type { TaskItem, TaskMessages } from '../domain'
import { createWidgetPlugin } from '@deviltea/widget-core'
import {
	isPlainObject,
	isTaskArray,
	isTaskFilter,
	isTaskItem,
	isTaskMessages,
	taskMessages,
} from '../domain'

export interface TaskListConfig {
	readonly storeId: string
	readonly searchId: string
	readonly filterId: string
	readonly editorId: string
	readonly i18nId: string
	readonly notificationId: string
}

export interface TaskListInterfaces extends WidgetInterfaces {
	config: {
		raw: TaskListConfig
		resolved: TaskListConfig
	}
	properties: {
		visibleTasks: readonly TaskItem[]
		count: number
		messages: TaskMessages
	}
	methods: {
		toggle: (id: string) => TaskItem
		edit: (id: string) => void
		delete: (id: string) => void
	}
}

const DUMMY_TASK: TaskItem = { id: '', title: '', done: false }

function isTaskListConfig(input: unknown): input is TaskListConfig {
	return isPlainObject(input)
		&& typeof input.storeId === 'string'
		&& typeof input.searchId === 'string'
		&& typeof input.filterId === 'string'
		&& typeof input.editorId === 'string'
		&& typeof input.i18nId === 'string'
		&& typeof input.notificationId === 'string'
}

function isString(value: unknown): value is string {
	return typeof value === 'string'
}

export const TaskListPlugin = createWidgetPlugin('TaskList')
	.description('Filtered task list and task-row actions')
	.interfaces<TaskListInterfaces>()
	.config({
		description: 'Task-list dependency wiring',
		validate: (input): input is TaskListConfig => isTaskListConfig(input),
		resolve: raw => ({
			storeId: raw?.storeId ?? '',
			searchId: raw?.searchId ?? '',
			filterId: raw?.filterId ?? '',
			editorId: raw?.editorId ?? '',
			i18nId: raw?.i18nId ?? '',
			notificationId: raw?.notificationId ?? '',
		}),
	})
	.properties(properties =>
		properties
			.visibleTasks({
				registerDeps: ({ dep, config }) => ({
					tasks: dep.widget(config.storeId).state.get('tasks')
						.validate(isTaskArray),
					search: dep.widget(config.searchId).state.get('value')
						.validate(isString),
					filter: dep.widget(config.filterId).state.get('value')
						.validate(isTaskFilter),
				}),
				compute: ({ deps }) => {
					const tasks = deps.tasks()
					const search = deps.search()
					const filter = deps.filter()
					if (!tasks.ok || !search.ok || !filter.ok)
						return []

					const query = search.value.trim()
						.toLocaleLowerCase()
					return tasks.value.filter((task) => {
						if (filter.value === 'open' && task.done)
							return false
						if (filter.value === 'done' && !task.done)
							return false
						return query === '' || task.title.toLocaleLowerCase()
							.includes(query)
					})
				},
			})
			.count({
				registerDeps: ({ dep }) => dep.self.properties.get('visibleTasks'),
				compute: ({ deps }) => {
					const result = deps()
					return result.ok && result.value !== null ? result.value.length : 0
				},
			})
			.messages({
				registerDeps: ({ dep, config }) => dep.widget(config.i18nId).properties.get('messages')
					.validate(isTaskMessages),
				compute: ({ deps }) => {
					const result = deps()
					return result.ok ? result.value : taskMessages.en
				},
			}))
	.methods(methods =>
		methods
			.toggle({
				registerDeps: ({ dep, config }) => ({
					toggleTask: dep.widget(config.storeId).methods.invoke('toggleTask')
						.validate(isTaskItem),
					messages: dep.widget(config.i18nId).properties.get('messages')
						.validate(isTaskMessages),
					notify: dep.widget(config.notificationId).methods.invoke('success'),
				}),
				validateArgs: (args): args is [string] => args.length === 1 && typeof args[0] === 'string',
				execute: ({ deps, args }) => {
					const result = deps.toggleTask(args[0])
					if (!result.ok)
						return DUMMY_TASK
					const messages = deps.messages()
					if (messages.ok)
						deps.notify(result.value.done ? messages.value.taskCompleted : messages.value.taskReopened)
					return result.value
				},
			})
			.edit({
				registerDeps: ({ dep, config }) => dep.widget(config.editorId).methods.invoke('openEdit'),
				validateArgs: (args): args is [string] => args.length === 1 && typeof args[0] === 'string',
				execute: ({ deps, args }) => {
					deps(args[0])
				},
			})
			.delete({
				registerDeps: ({ dep, config }) => ({
					deleteTask: dep.widget(config.storeId).methods.invoke('deleteTask'),
					messages: dep.widget(config.i18nId).properties.get('messages')
						.validate(isTaskMessages),
					notify: dep.widget(config.notificationId).methods.invoke('success'),
				}),
				validateArgs: (args): args is [string] => args.length === 1 && typeof args[0] === 'string',
				execute: ({ deps, args }) => {
					const deleted = deps.deleteTask(args[0])
					if (!deleted.ok)
						return
					const messages = deps.messages()
					if (messages.ok)
						deps.notify(messages.value.taskDeleted)
				},
			}))
	.done()
