/**
 * `SettingsPage`: the root of the workspace settings page. Slot `providers` holds the capability widgets (Appearance, Notifier),
 * slot `sections` the Sections of fields. Its Property `appearance` is what the page itself draws in (the colour mode and the
 * density), read from the first Appearance of its `providers` slot through a declared dependency: the root finds it in its own
 * slot, which is not a lookup by ancestry (Core has none).
 *
 * The page has no State and no Methods: the form values live in the fields, the notifications in the Notifier.
 */

import type { WidgetInterfaces } from '@deviltea/widget-core'
import type { SettingsPageConfig, SettingsPageRawConfig } from '../config'
import type { Density, I18nText, Mode } from '../domain'
import { createWidgetPlugin, undocumented } from '@deviltea/widget-core'
import { checkSettingsPageConfig, resolveSettingsPageConfig } from '../config'
import { isDensity, isMode } from '../domain'
import { isProviderType, rootAppearanceId } from './structure'

export interface PageAppearance {
	readonly mode: Mode
	readonly density: Density
}

/**
 * The root of the workspace settings page. Slot `providers`: the capability widgets (Appearance, Notifier). Slot `sections`:
 * Sections of fields. Property `title` is its config; `appearance` is the colour `mode` and `density` of the first Appearance
 * in `providers` (`auto` / `comfortable` when there is none).
 */
export interface SettingsPageInterfaces extends WidgetInterfaces {
	/** The title of the page per language. */
	config: { raw: SettingsPageRawConfig, resolved: SettingsPageConfig }
	slots: {
		/** The capability widgets: Appearance and Notifier. */
		providers: 'Appearance' | 'Notifier'
		/** The Sections of the page, in order. */
		sections: 'Section'
	}
	properties: {
		/** The title of the page per language. */
		title: I18nText
		/** The colour `mode` and `density` of the first Appearance in `providers`; `auto` / `comfortable` when there is none. */
		appearance: PageAppearance
	}
}

export const SettingsPagePlugin = createWidgetPlugin('SettingsPage')
	.description(undocumented)
	.interfaces<SettingsPageInterfaces>()
	.config({
		description: undocumented,
		validate: (input, ctx): input is SettingsPageRawConfig => {
			checkSettingsPageConfig(input, diagnostic => ctx.addDiagnostic(diagnostic))
			return !ctx.hasAnyDiagnostic()
		},
		resolve: resolveSettingsPageConfig,
	})
	.slots({
		providers: {
			description: undocumented,
			validateStructure: ({ children, addDiagnostic }) => {
				children.forEach((child, index) => {
					if (child.resolved && !isProviderType(child.type))
						addDiagnostic({ message: `"${child.type}" is not a provider type.`, index, reason: 'not-a-provider' })
				})
			},
		},
		sections: {
			description: undocumented,
			validateStructure: ({ children, addDiagnostic }) => {
				children.forEach((child, index) => {
					if (child.resolved && child.type !== 'Section')
						addDiagnostic({ message: `"${child.type}" is not a section.`, index, reason: 'not-a-section' })
				})
			},
		},
	})
	.structure(({ widget, blueprint, addDiagnostic }) => {
		if (blueprint.getParent(widget) !== null)
			addDiagnostic({ message: 'A SettingsPage must be the root widget.', reason: 'settings-page-not-root' })
	})
	.properties(properties => properties
		.title({ description: undocumented, compute: ({ config }) => config.title })
		.appearance({
			description: undocumented,
			registerDeps: ({ dep, blueprint }) => {
				const id = rootAppearanceId(blueprint)
				return {
					...(id === null
						? {}
						: {
								mode: dep.widget(id).state.get('mode')
									.validate(isMode),
								density: dep.widget(id).state.get('density')
									.validate(isDensity),
							}),
				}
			},
			compute: ({ deps }): PageAppearance => {
				const mode = deps.mode?.()
				const density = deps.density?.()
				return {
					mode: mode?.ok === true && isMode(mode.value) ? mode.value : 'auto',
					density: density?.ok === true && isDensity(density.value) ? density.value : 'comfortable',
				}
			},
		}))
	.done()
