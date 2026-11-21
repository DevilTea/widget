/**
 * The eight workspace settings plugins as one tuple for `createWidgetSystem` (see `../system.ts`). `SettingsPage` is first:
 * the Implementation catalog marks the first type as the current one.
 */

import { AppearancePlugin } from './appearance'
import { ChoicePlugin } from './choice'
import { DangerActionPlugin } from './danger-action'
import { NotifierPlugin } from './notifier'
import { SectionPlugin } from './section'
import { SettingsPagePlugin } from './settings-page'
import { TextFieldPlugin } from './text-field'
import { TogglePlugin } from './toggle'

export * from './appearance'
export * from './choice'
export * from './danger-action'
export * from './notifier'
export * from './section'
export * from './settings-page'
export * from './text-field'
export * from './toggle'

export const packsPlugins = [
	SettingsPagePlugin,
	AppearancePlugin,
	NotifierPlugin,
	SectionPlugin,
	TextFieldPlugin,
	TogglePlugin,
	ChoicePlugin,
	DangerActionPlugin,
] as const

export type PacksPlugins = typeof packsPlugins
