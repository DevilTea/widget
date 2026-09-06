/** Input and toolbar widgets for the Vuetify task application. */

import type { WidgetInterfaces } from '@deviltea/widget-core'
import type { TaskFilter, TaskLocale, TaskMessages, TaskThemeMode } from '../domain'
import { createWidgetPlugin } from '@deviltea/widget-core'
import {
	isPlainObject,
	isTaskFilter,
	isTaskLocale,
	isTaskMessages,
	isTaskThemeMode,
	taskMessages,
} from '../domain'

interface I18nConsumerConfig {
	readonly i18nId: string
}

function isI18nConsumerConfig(input: unknown): input is I18nConsumerConfig {
	return isPlainObject(input) && typeof input.i18nId === 'string'
}

// -------------------------------------------------------------------------------------------------
// TaskSearch
// -------------------------------------------------------------------------------------------------

export interface TaskSearchInterfaces extends WidgetInterfaces {
	config: {
		raw: I18nConsumerConfig
		resolved: I18nConsumerConfig
	}
	state: {
		value: string
	}
	properties: {
		messages: TaskMessages
	}
	methods: {
		clear: () => void
	}
}

export const TaskSearchPlugin = createWidgetPlugin('TaskSearch')
	.description('Task search input widget')
	.interfaces<TaskSearchInterfaces>()
	.config({
		description: 'Task-search dependencies',
		validate: (input): input is I18nConsumerConfig => isI18nConsumerConfig(input),
		resolve: raw => ({ i18nId: raw?.i18nId ?? '' }),
	})
	.state(state =>
		state.value({
			validate: (input): input is string => typeof input === 'string' && input.length <= 120,
			default: () => '',
		}))
	.properties(properties =>
		properties.messages({
			registerDeps: ({ dep, config }) => dep.widget(config.i18nId).properties.get('messages')
				.validate(isTaskMessages),
			compute: ({ deps }) => {
				const result = deps()
				return result.ok ? result.value : taskMessages.en
			},
		}))
	.methods(methods =>
		methods.clear({
			registerDeps: ({ dep }) => dep.self.state.set('value'),
			validateArgs: (args): args is [] => args.length === 0,
			execute: ({ deps }) => {
				deps('')
			},
		}))
	.done()

// -------------------------------------------------------------------------------------------------
// TaskStatusFilter
// -------------------------------------------------------------------------------------------------

export interface TaskStatusFilterInterfaces extends WidgetInterfaces {
	config: {
		raw: I18nConsumerConfig
		resolved: I18nConsumerConfig
	}
	state: {
		value: TaskFilter
	}
	properties: {
		messages: TaskMessages
	}
}

export const TaskStatusFilterPlugin = createWidgetPlugin('TaskStatusFilter')
	.description('Task status filter widget')
	.interfaces<TaskStatusFilterInterfaces>()
	.config({
		description: 'Status-filter dependencies',
		validate: (input): input is I18nConsumerConfig => isI18nConsumerConfig(input),
		resolve: raw => ({ i18nId: raw?.i18nId ?? '' }),
	})
	.state(state =>
		state.value({
			validate: (input): input is TaskFilter => isTaskFilter(input),
			default: () => 'all',
		}))
	.properties(properties =>
		properties.messages({
			registerDeps: ({ dep, config }) => dep.widget(config.i18nId).properties.get('messages')
				.validate(isTaskMessages),
			compute: ({ deps }) => {
				const result = deps()
				return result.ok ? result.value : taskMessages.en
			},
		}))
	.done()

// -------------------------------------------------------------------------------------------------
// LocaleControl
// -------------------------------------------------------------------------------------------------

export interface LocaleControlInterfaces extends WidgetInterfaces {
	config: {
		raw: I18nConsumerConfig
		resolved: I18nConsumerConfig
	}
	properties: {
		locale: TaskLocale
		messages: TaskMessages
	}
	methods: {
		toggle: () => void
	}
}

export const LocaleControlPlugin = createWidgetPlugin('LocaleControl')
	.description('Locale capability control')
	.interfaces<LocaleControlInterfaces>()
	.config({
		description: 'Locale-control dependency',
		validate: (input): input is I18nConsumerConfig => isI18nConsumerConfig(input),
		resolve: raw => ({ i18nId: raw?.i18nId ?? '' }),
	})
	.properties(properties =>
		properties
			.locale({
				registerDeps: ({ dep, config }) => dep.widget(config.i18nId).state.get('locale')
					.validate(isTaskLocale),
				compute: ({ deps }) => {
					const result = deps()
					return result.ok ? result.value : 'en'
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
		methods.toggle({
			registerDeps: ({ dep, config }) => dep.widget(config.i18nId).methods.invoke('toggleLocale'),
			validateArgs: (args): args is [] => args.length === 0,
			execute: ({ deps }) => {
				deps()
			},
		}))
	.done()

// -------------------------------------------------------------------------------------------------
// ThemeControl
// -------------------------------------------------------------------------------------------------

export interface ThemeControlConfig {
	readonly themeId: string
	readonly i18nId: string
}

export interface ThemeControlInterfaces extends WidgetInterfaces {
	config: {
		raw: ThemeControlConfig
		resolved: ThemeControlConfig
	}
	properties: {
		mode: TaskThemeMode
		messages: TaskMessages
	}
	methods: {
		cycle: () => void
	}
}

export const ThemeControlPlugin = createWidgetPlugin('ThemeControl')
	.description('Theme capability control')
	.interfaces<ThemeControlInterfaces>()
	.config({
		description: 'Theme-control dependencies',
		validate: (input): input is ThemeControlConfig =>
			isPlainObject(input) && typeof input.themeId === 'string' && typeof input.i18nId === 'string',
		resolve: raw => ({ themeId: raw?.themeId ?? '', i18nId: raw?.i18nId ?? '' }),
	})
	.properties(properties =>
		properties
			.mode({
				registerDeps: ({ dep, config }) => dep.widget(config.themeId).state.get('mode')
					.validate(isTaskThemeMode),
				compute: ({ deps }) => {
					const result = deps()
					return result.ok ? result.value : 'system'
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
		methods.cycle({
			registerDeps: ({ dep, config }) => dep.widget(config.themeId).methods.invoke('cycleMode'),
			validateArgs: (args): args is [] => args.length === 0,
			execute: ({ deps }) => {
				deps()
			},
		}))
	.done()

// -------------------------------------------------------------------------------------------------
// CreateTaskButton
// -------------------------------------------------------------------------------------------------

export interface CreateTaskButtonConfig {
	readonly editorId: string
	readonly i18nId: string
}

export interface CreateTaskButtonInterfaces extends WidgetInterfaces {
	config: {
		raw: CreateTaskButtonConfig
		resolved: CreateTaskButtonConfig
	}
	properties: {
		messages: TaskMessages
	}
	methods: {
		press: () => void
	}
}

export const CreateTaskButtonPlugin = createWidgetPlugin('CreateTaskButton')
	.description('Open-new-task action widget')
	.interfaces<CreateTaskButtonInterfaces>()
	.config({
		description: 'Create-task action dependencies',
		validate: (input): input is CreateTaskButtonConfig =>
			isPlainObject(input) && typeof input.editorId === 'string' && typeof input.i18nId === 'string',
		resolve: raw => ({ editorId: raw?.editorId ?? '', i18nId: raw?.i18nId ?? '' }),
	})
	.properties(properties =>
		properties.messages({
			registerDeps: ({ dep, config }) => dep.widget(config.i18nId).properties.get('messages')
				.validate(isTaskMessages),
			compute: ({ deps }) => {
				const result = deps()
				return result.ok ? result.value : taskMessages.en
			},
		}))
	.methods(methods =>
		methods.press({
			registerDeps: ({ dep, config }) => dep.widget(config.editorId).methods.invoke('openNew'),
			validateArgs: (args): args is [] => args.length === 0,
			execute: ({ deps }) => {
				deps()
			},
		}))
	.done()
