/**
 * `Appearance`: a capability (provider-style) widget. It owns how dense the page is and which colour mode it wants, as State:
 * writing State is always accepted for a known value. Fields read `density` through `dep.widget(<id>)`, the id being a field of
 * their own config: Core has no nearest-ancestor lookup, so nothing here "provides" anything to a subtree. `auto` means "follow
 * the host theme"; the host theme is not known to Core, so the renderer pack resolves it (`resolveScheme`).
 */

import type { WidgetInterfaces } from '@deviltea/widget-core'
import type { AppearanceConfig, AppearanceRawConfig } from '../config'
import type { Density, Mode } from '../domain'
import { createWidgetPlugin, undocumented } from '@deviltea/widget-core'
import { checkAppearanceConfig, resolveAppearanceConfig } from '../config'
import { isDensity, isMode } from '../domain'
import { checkAtMostOneAppearance } from './structure'

/**
 * A capability widget: how dense the settings page is (State `density`: `comfortable` or `compact`) and which colour mode it
 * wants (State `mode`: `auto`, `light` or `dark`; `auto` follows the host theme). Fields read `density` by naming this widget
 * in their `appearance` config; there is no nearest-ancestor lookup.
 */
export interface AppearanceInterfaces extends WidgetInterfaces {
	/** The density and the colour mode at the start. */
	config: { raw: AppearanceRawConfig, resolved: AppearanceConfig }
	state: {
		/** How dense the page is: `comfortable` or `compact`. */
		density: Density
		/** The colour mode: `auto` (follow the host theme), `light` or `dark`. */
		mode: Mode
	}
}

export const AppearancePlugin = createWidgetPlugin('Appearance')
	.description(undocumented)
	.interfaces<AppearanceInterfaces>()
	.config({
		description: undocumented,
		validate: (input, ctx): input is AppearanceRawConfig => {
			checkAppearanceConfig(input, diagnostic => ctx.addDiagnostic(diagnostic))
			return !ctx.hasAnyDiagnostic()
		},
		resolve: resolveAppearanceConfig,
	})
	.structure(ctx => checkAtMostOneAppearance(ctx))
	.state(state => state
		.density({
			description: undocumented,
			validate: (input): input is Density => isDensity(input),
			default: ({ config }) => config.density,
		})
		.mode({
			description: undocumented,
			validate: (input): input is Mode => isMode(input),
			default: ({ config }) => config.mode,
		}))
	.done()
