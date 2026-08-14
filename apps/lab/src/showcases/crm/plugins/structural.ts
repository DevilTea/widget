/**
 * `AppShell`, `Toolbar`, `Card` (checkpoint §2 "Reusable-style primitives"): pure structural/
 * presentation primitives with no product state — `config`/`slots` (or `slots` alone for `Toolbar`)
 * only, never `properties`/`state`/`methods`.
 *
 * `@deviltea/widget-vue`'s public `useWidget()` contract exposes only `state`/`properties`/`methods`/
 * `slots` (never resolved `config` — see issue #13 checkpoints C/D); a widget declared `config + slots`
 * only therefore has no reactive path to echo its own config text as DOM output. Per checkpoint §6
 * ("Exact display labels ... CSS/layout ... are implementation details"), these three renderers treat
 * their configured `title`/`subtitle`/`description` as compile-time Blueprint documentation (visible in
 * the Lab's Blueprint Inspector) rather than literal DOM text, and instead render fixed showcase chrome
 * driven by their slots — this is a presentation-only choice, not a semantic one, and does not add any
 * capability beyond what the checkpoint locked.
 */

import type { WidgetInterfaces } from '@deviltea/widget-core'
import { createWidgetPlugin } from '@deviltea/widget-core'
import { isPlainObject } from '../domain'

// -------------------------------------------------------------------------------------------------
// AppShell
// -------------------------------------------------------------------------------------------------

export interface AppShellRawConfig {
	readonly title: string
	readonly subtitle?: string
}

export interface AppShellResolvedConfig {
	readonly title: string
	readonly subtitle: string | null
}

export interface AppShellInterfaces extends WidgetInterfaces {
	config: {
		raw: AppShellRawConfig
		resolved: AppShellResolvedConfig
	}
	slots: 'header' | 'main' | 'overlay'
}

export const AppShellPlugin = createWidgetPlugin('AppShell')
	.interfaces<AppShellInterfaces>()
	.config({
		validate: (input): input is AppShellRawConfig =>
			isPlainObject(input)
			&& typeof input.title === 'string'
			&& (input.subtitle === undefined || typeof input.subtitle === 'string'),
		resolve: raw => ({
			title: raw?.title ?? '',
			subtitle: raw?.subtitle ?? null,
		}),
	})
	.slots({ header: {}, main: {}, overlay: {} })
	.done()

// -------------------------------------------------------------------------------------------------
// Toolbar
// -------------------------------------------------------------------------------------------------

export interface ToolbarInterfaces extends WidgetInterfaces {
	slots: 'start' | 'end'
}

export const ToolbarPlugin = createWidgetPlugin('Toolbar')
	.interfaces<ToolbarInterfaces>()
	.slots({ start: {}, end: {} })
	.done()

// -------------------------------------------------------------------------------------------------
// Card
// -------------------------------------------------------------------------------------------------

export interface CardRawConfig {
	readonly title?: string
	readonly description?: string
}

export interface CardResolvedConfig {
	readonly title: string | null
	readonly description: string | null
}

export interface CardInterfaces extends WidgetInterfaces {
	config: {
		raw: CardRawConfig
		resolved: CardResolvedConfig
	}
	slots: 'body'
}

export const CardPlugin = createWidgetPlugin('Card')
	.interfaces<CardInterfaces>()
	.config({
		validate: (input): input is CardRawConfig =>
			isPlainObject(input)
			&& (input.title === undefined || typeof input.title === 'string')
			&& (input.description === undefined || typeof input.description === 'string'),
		resolve: raw => ({
			title: raw?.title ?? null,
			description: raw?.description ?? null,
		}),
	})
	.slots({ body: {} })
	.done()
