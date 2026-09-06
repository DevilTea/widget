/** Task-domain mutation owner for the Vuetify showcase. */

import type { WidgetInterfaces } from '@deviltea/widget-core'
import type { TaskItem } from '../domain'
import { createWidgetPlugin } from '@deviltea/widget-core'
import { isPlainObject, isTaskArray } from '../domain'

export interface TaskStoreConfig {
	readonly seedTasks: readonly TaskItem[]
}

export interface TaskStoreInterfaces extends WidgetInterfaces {
	config: {
		raw: TaskStoreConfig
		resolved: TaskStoreConfig
	}
	state: {
		tasks: readonly TaskItem[]
	}
	methods: {
		createTask: (title: string) => TaskItem
		updateTask: (id: string, title: string) => TaskItem
		toggleTask: (id: string) => TaskItem
		deleteTask: (id: string) => void
		reset: () => void
	}
}

const DUMMY_TASK: TaskItem = { id: '', title: '', done: false }

function nextTaskId(tasks: readonly TaskItem[]): string {
	let index = 1
	while (tasks.some(task => task.id === `task-${index}`))
		index += 1
	return `task-${index}`
}

export const TaskStorePlugin = createWidgetPlugin('TaskStore')
	.description('Task-domain state and mutation widget')
	.interfaces<TaskStoreInterfaces>()
	.config({
		description: 'Task-store seed data',
		validate: (input): input is TaskStoreConfig => isPlainObject(input) && isTaskArray(input.seedTasks),
		resolve: raw => ({ seedTasks: (raw?.seedTasks ?? []).map(task => ({ ...task })) }),
	})
	.state(state =>
		state.tasks({
			validate: (input): input is readonly TaskItem[] => isTaskArray(input),
			default: ({ config }) => config.seedTasks.map(task => ({ ...task })),
		}))
	.methods(methods =>
		methods
			.createTask({
				registerDeps: ({ dep }) => ({
					tasks: dep.self.state.get('tasks'),
					setTasks: dep.self.state.set('tasks'),
				}),
				validateArgs: (args): args is [string] => args.length === 1 && typeof args[0] === 'string',
				execute: ({ deps, args, addDiagnostic }) => {
					const tasksResult = deps.tasks()
					if (!tasksResult.ok || tasksResult.value === null)
						return DUMMY_TASK
					const title = args[0].trim()
					if (title.length === 0) {
						addDiagnostic({ message: 'Task title must not be empty.' })
						return DUMMY_TASK
					}
					const created: TaskItem = { id: nextTaskId(tasksResult.value), title, done: false }
					deps.setTasks([...tasksResult.value, created])
					return created
				},
			})
			.updateTask({
				registerDeps: ({ dep }) => ({
					tasks: dep.self.state.get('tasks'),
					setTasks: dep.self.state.set('tasks'),
				}),
				validateArgs: (args): args is [string, string] =>
					args.length === 2 && typeof args[0] === 'string' && typeof args[1] === 'string',
				execute: ({ deps, args, addDiagnostic }) => {
					const tasksResult = deps.tasks()
					if (!tasksResult.ok || tasksResult.value === null)
						return DUMMY_TASK
					const index = tasksResult.value.findIndex(task => task.id === args[0])
					if (index === -1) {
						addDiagnostic({ message: `No task found with id "${args[0]}".` })
						return DUMMY_TASK
					}
					const title = args[1].trim()
					if (title.length === 0) {
						addDiagnostic({ message: 'Task title must not be empty.' })
						return DUMMY_TASK
					}
					const updated: TaskItem = { ...tasksResult.value[index]!, title }
					deps.setTasks([
						...tasksResult.value.slice(0, index),
						updated,
						...tasksResult.value.slice(index + 1),
					])
					return updated
				},
			})
			.toggleTask({
				registerDeps: ({ dep }) => ({
					tasks: dep.self.state.get('tasks'),
					setTasks: dep.self.state.set('tasks'),
				}),
				validateArgs: (args): args is [string] => args.length === 1 && typeof args[0] === 'string',
				execute: ({ deps, args, addDiagnostic }) => {
					const tasksResult = deps.tasks()
					if (!tasksResult.ok || tasksResult.value === null)
						return DUMMY_TASK
					const index = tasksResult.value.findIndex(task => task.id === args[0])
					if (index === -1) {
						addDiagnostic({ message: `No task found with id "${args[0]}".` })
						return DUMMY_TASK
					}
					const updated: TaskItem = { ...tasksResult.value[index]!, done: !tasksResult.value[index]!.done }
					deps.setTasks([
						...tasksResult.value.slice(0, index),
						updated,
						...tasksResult.value.slice(index + 1),
					])
					return updated
				},
			})
			.deleteTask({
				registerDeps: ({ dep }) => ({
					tasks: dep.self.state.get('tasks'),
					setTasks: dep.self.state.set('tasks'),
				}),
				validateArgs: (args): args is [string] => args.length === 1 && typeof args[0] === 'string',
				execute: ({ deps, args, addDiagnostic }) => {
					const tasksResult = deps.tasks()
					if (!tasksResult.ok || tasksResult.value === null)
						return
					if (!tasksResult.value.some(task => task.id === args[0])) {
						addDiagnostic({ message: `No task found with id "${args[0]}".` })
						return
					}
					deps.setTasks(tasksResult.value.filter(task => task.id !== args[0]))
				},
			})
			.reset({
				registerDeps: ({ dep }) => dep.self.state.set('tasks'),
				validateArgs: (args): args is [] => args.length === 0,
				execute: ({ deps, config }) => {
					deps(config.seedTasks.map(task => ({ ...task })))
				},
			}))
	.done()
