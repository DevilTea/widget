/**
 * Functional/capability-style widgets for the Vuetify showcase.
 *
 * They are ordinary Widget plugins: slot ownership, State, Properties and Methods all use Core's normal
 * semantic model. Descendants that need their capabilities target the stable provider widget ids with
 * `dep.widget(id)`. Core currently has no nearest-ancestor/provider lookup; DevilTea/widget#3 tracks that
 * additive design question, so this showcase deliberately does not emulate it through Vue provide/inject.
 */

import type { WidgetInterfaces } from '@deviltea/widget-core'
import type { NotificationTone, TaskLocale, TaskMessages, TaskThemeMode } from '../domain'
import { createWidgetPlugin } from '@deviltea/widget-core'
import {
	isNotificationTone,
	isPlainObject,
	isTaskLocale,
	isTaskThemeMode,
	taskMessages,
} from '../domain'

// -------------------------------------------------------------------------------------------------
// I18nCapability
// -------------------------------------------------------------------------------------------------

export interface I18nCapabilityConfig {
	readonly defaultLocale: TaskLocale
}

export interface I18nCapabilityInterfaces extends WidgetInterfaces {
	config: {
		raw: I18nCapabilityConfig
		resolved: I18nCapabilityConfig
	}
	slots: 'default'
	state: {
		locale: TaskLocale
	}
	properties: {
		messages: TaskMessages
	}
	methods: {
		setLocale: (locale: TaskLocale) => void
		toggleLocale: () => void
	}
}

export const I18nCapabilityPlugin = createWidgetPlugin('I18nCapability')
	.description('Functional i18n capability widget')
	.interfaces<I18nCapabilityInterfaces>()
	.config({
		description: 'I18n capability configuration',
		validate: (input): input is I18nCapabilityConfig => isPlainObject(input) && isTaskLocale(input.defaultLocale),
		resolve: raw => ({ defaultLocale: raw?.defaultLocale ?? 'en' }),
	})
	.slots({ default: { description: 'Capability subtree' } })
	.state(state =>
		state.locale({
			validate: (input): input is TaskLocale => isTaskLocale(input),
			default: ({ config }) => config.defaultLocale,
		}))
	.properties(properties =>
		properties.messages({
			registerDeps: ({ dep }) => dep.self.state.get('locale'),
			compute: ({ deps }) => {
				const result = deps()
				return result.ok && result.value !== null ? taskMessages[result.value] : taskMessages.en
			},
		}))
	.methods(methods =>
		methods
			.setLocale({
				registerDeps: ({ dep }) => dep.self.state.set('locale'),
				validateArgs: (args): args is [TaskLocale] => args.length === 1 && isTaskLocale(args[0]),
				execute: ({ deps, args }) => {
					deps(args[0])
				},
			})
			.toggleLocale({
				registerDeps: ({ dep }) => ({
					locale: dep.self.state.get('locale'),
					setLocale: dep.self.state.set('locale'),
				}),
				validateArgs: (args): args is [] => args.length === 0,
				execute: ({ deps }) => {
					const locale = deps.locale()
					if (locale.ok && locale.value !== null)
						deps.setLocale(locale.value === 'en' ? 'zh-TW' : 'en')
				},
			}))
	.done()

// -------------------------------------------------------------------------------------------------
// ThemeCapability
// -------------------------------------------------------------------------------------------------

export interface ThemeCapabilityConfig {
	readonly defaultMode: TaskThemeMode
}

export interface ThemeCapabilityInterfaces extends WidgetInterfaces {
	config: {
		raw: ThemeCapabilityConfig
		resolved: ThemeCapabilityConfig
	}
	slots: 'default'
	state: {
		mode: TaskThemeMode
	}
	methods: {
		setMode: (mode: TaskThemeMode) => void
		cycleMode: () => void
	}
}

export const ThemeCapabilityPlugin = createWidgetPlugin('ThemeCapability')
	.description('Functional theme-mode capability widget')
	.interfaces<ThemeCapabilityInterfaces>()
	.config({
		description: 'Theme capability configuration',
		validate: (input): input is ThemeCapabilityConfig => isPlainObject(input) && isTaskThemeMode(input.defaultMode),
		resolve: raw => ({ defaultMode: raw?.defaultMode ?? 'system' }),
	})
	.slots({ default: { description: 'Capability subtree' } })
	.state(state =>
		state.mode({
			validate: (input): input is TaskThemeMode => isTaskThemeMode(input),
			default: ({ config }) => config.defaultMode,
		}))
	.methods(methods =>
		methods
			.setMode({
				registerDeps: ({ dep }) => dep.self.state.set('mode'),
				validateArgs: (args): args is [TaskThemeMode] => args.length === 1 && isTaskThemeMode(args[0]),
				execute: ({ deps, args }) => {
					deps(args[0])
				},
			})
			.cycleMode({
				registerDeps: ({ dep }) => ({
					mode: dep.self.state.get('mode'),
					setMode: dep.self.state.set('mode'),
				}),
				validateArgs: (args): args is [] => args.length === 0,
				execute: ({ deps }) => {
					const mode = deps.mode()
					if (!mode.ok || mode.value === null)
						return
					const next: TaskThemeMode = mode.value === 'system' ? 'light' : mode.value === 'light' ? 'dark' : 'system'
					deps.setMode(next)
				},
			}))
	.done()

// -------------------------------------------------------------------------------------------------
// NotificationCapability
// -------------------------------------------------------------------------------------------------

export interface NotificationCapabilityInterfaces extends WidgetInterfaces {
	slots: 'default'
	state: {
		open: boolean
		message: string
		tone: NotificationTone
	}
	methods: {
		show: (message: string, tone?: NotificationTone) => void
		success: (message: string) => void
		error: (message: string) => void
		dismiss: () => void
	}
}

export const NotificationCapabilityPlugin = createWidgetPlugin('NotificationCapability')
	.description('Functional notification capability widget')
	.interfaces<NotificationCapabilityInterfaces>()
	.slots({ default: { description: 'Capability subtree' } })
	.state(state =>
		state
			.open({
				validate: (input): input is boolean => typeof input === 'boolean',
				default: () => false,
			})
			.message({
				validate: (input): input is string => typeof input === 'string',
				default: () => '',
			})
			.tone({
				validate: (input): input is NotificationTone => isNotificationTone(input),
				default: () => 'info',
			}))
	.methods(methods =>
		methods
			.show({
				registerDeps: ({ dep }) => ({
					setMessage: dep.self.state.set('message'),
					setTone: dep.self.state.set('tone'),
					setOpen: dep.self.state.set('open'),
				}),
				validateArgs: (args): args is [string, NotificationTone?] =>
					(args.length === 1 || args.length === 2)
					&& typeof args[0] === 'string'
					&& (args[1] === undefined || isNotificationTone(args[1])),
				execute: ({ deps, args }) => {
					deps.setMessage(args[0])
					deps.setTone(args[1] ?? 'info')
					deps.setOpen(true)
				},
			})
			.success({
				registerDeps: ({ dep }) => dep.self.methods.invoke('show'),
				validateArgs: (args): args is [string] => args.length === 1 && typeof args[0] === 'string',
				execute: ({ deps, args }) => {
					deps(args[0], 'success')
				},
			})
			.error({
				registerDeps: ({ dep }) => dep.self.methods.invoke('show'),
				validateArgs: (args): args is [string] => args.length === 1 && typeof args[0] === 'string',
				execute: ({ deps, args }) => {
					deps(args[0], 'error')
				},
			})
			.dismiss({
				registerDeps: ({ dep }) => dep.self.state.set('open'),
				validateArgs: (args): args is [] => args.length === 0,
				execute: ({ deps }) => {
					deps(false)
				},
			}))
	.done()
