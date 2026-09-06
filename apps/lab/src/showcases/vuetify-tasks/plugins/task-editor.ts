/**
 * Semantic task editor/dialog state machine.
 *
 * Dialog visibility, selected task id, draft title, save/cancel semantics and notifications belong to
 * this Widget. The Vuetify VDialog/VTextField renderer is a controlled projection of these surfaces.
 */

import type { WidgetInterfaces } from '@deviltea/widget-core'
import type { TaskItem, TaskMessages } from '../domain'
import { createWidgetPlugin } from '@deviltea/widget-core'
import { isPlainObject, isTaskArray, isTaskItem, isTaskMessages, taskMessages } from '../domain'

export interface TaskEditorConfig {
	readonly storeId: string
	readonly i18nId: string
	readonly notificationId: string
}

export type TaskEditorMode = 'create' | 'edit'

export interface TaskEditorInterfaces extends WidgetInterfaces {
	config: {
		raw: TaskEditorConfig
		resolved: TaskEditorConfig
	}
	state: {
		open: boolean
		editingTaskId: string | null
		title: string
	}
	properties: {
		mode: TaskEditorMode
		messages: TaskMessages
	}
	methods: {
		openNew: () => void
		openEdit: (id: string) => void
		save: () => TaskItem
		cancel: () => void
	}
}

const DUMMY_TASK: TaskItem = { id: '', title: '', done: false }

function isTaskEditorConfig(input: unknown): input is TaskEditorConfig {
	return isPlainObject(input)
		&& typeof input.storeId === 'string'
		&& typeof input.i18nId === 'string'
		&& typeof input.notificationId === 'string'
}

function isNullableString(value: unknown): value is string | null {
	return value === null || typeof value === 'string'
}

export const TaskEditorPlugin = createWidgetPlugin('TaskEditor')
	.description('Task create/edit dialog state machine')
	.interfaces<TaskEditorInterfaces>()
	.config({
		description: 'Task-editor dependency wiring',
		validate: (input): input is TaskEditorConfig => isTaskEditorConfig(input),
		resolve: raw => ({
			storeId: raw?.storeId ?? '',
			i18nId: raw?.i18nId ?? '',
			notificationId: raw?.notificationId ?? '',
		}),
	})
	.state(state =>
		state
			.open({
				validate: (input): input is boolean => typeof input === 'boolean',
				default: () => false,
			})
			.editingTaskId({
				validate: (input): input is string | null => isNullableString(input),
				default: () => null,
			})
			.title({
				validate: (input): input is string => typeof input === 'string' && input.length <= 160,
				default: () => '',
			}))
	.properties(properties =>
		properties
			.mode({
				registerDeps: ({ dep }) => dep.self.state.get('editingTaskId'),
				compute: ({ deps }): TaskEditorMode => {
					const result = deps()
					return result.ok && result.value !== null ? 'edit' : 'create'
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
			.openNew({
				registerDeps: ({ dep }) => ({
					setEditingTaskId: dep.self.state.set('editingTaskId'),
					setTitle: dep.self.state.set('title'),
					setOpen: dep.self.state.set('open'),
				}),
				validateArgs: (args): args is [] => args.length === 0,
				execute: ({ deps }) => {
					deps.setEditingTaskId(null)
					deps.setTitle('')
					deps.setOpen(true)
				},
			})
			.openEdit({
				registerDeps: ({ dep, config }) => ({
					tasks: dep.widget(config.storeId).state.get('tasks')
						.validate(isTaskArray),
					setEditingTaskId: dep.self.state.set('editingTaskId'),
					setTitle: dep.self.state.set('title'),
					setOpen: dep.self.state.set('open'),
				}),
				validateArgs: (args): args is [string] => args.length === 1 && typeof args[0] === 'string',
				execute: ({ deps, args, addDiagnostic }) => {
					const tasks = deps.tasks()
					if (!tasks.ok)
						return
					const task = tasks.value.find(candidate => candidate.id === args[0])
					if (task === undefined) {
						addDiagnostic({ message: `No task found with id "${args[0]}".` })
						return
					}
					deps.setEditingTaskId(task.id)
					deps.setTitle(task.title)
					deps.setOpen(true)
				},
			})
			.save({
				registerDeps: ({ dep, config }) => ({
					title: dep.self.state.get('title'),
					editingTaskId: dep.self.state.get('editingTaskId'),
					createTask: dep.widget(config.storeId).methods.invoke('createTask')
						.validate(isTaskItem),
					updateTask: dep.widget(config.storeId).methods.invoke('updateTask')
						.validate(isTaskItem),
					messages: dep.widget(config.i18nId).properties.get('messages')
						.validate(isTaskMessages),
					notifySuccess: dep.widget(config.notificationId).methods.invoke('success'),
					notifyError: dep.widget(config.notificationId).methods.invoke('error'),
					setOpen: dep.self.state.set('open'),
					setEditingTaskId: dep.self.state.set('editingTaskId'),
					setTitle: dep.self.state.set('title'),
				}),
				validateArgs: (args): args is [] => args.length === 0,
				execute: ({ deps, addDiagnostic }) => {
					const title = deps.title()
					const editingTaskId = deps.editingTaskId()
					if (!title.ok || !editingTaskId.ok || title.value === null)
						return DUMMY_TASK
					if (title.value.trim().length === 0) {
						const message = 'Task title must not be empty.'
						addDiagnostic({ message })
						deps.notifyError(message)
						return DUMMY_TASK
					}

					const result = editingTaskId.value === null
						? deps.createTask(title.value)
						: deps.updateTask(editingTaskId.value, title.value)
					if (!result.ok)
						return DUMMY_TASK

					const messages = deps.messages()
					if (messages.ok)
						deps.notifySuccess(editingTaskId.value === null ? messages.value.taskCreated : messages.value.taskUpdated)

					deps.setOpen(false)
					deps.setEditingTaskId(null)
					deps.setTitle('')
					return result.value
				},
			})
			.cancel({
				registerDeps: ({ dep }) => ({
					setOpen: dep.self.state.set('open'),
					setEditingTaskId: dep.self.state.set('editingTaskId'),
					setTitle: dep.self.state.set('title'),
				}),
				validateArgs: (args): args is [] => args.length === 0,
				execute: ({ deps }) => {
					deps.setOpen(false)
					deps.setEditingTaskId(null)
					deps.setTitle('')
				},
			}))
	.done()
