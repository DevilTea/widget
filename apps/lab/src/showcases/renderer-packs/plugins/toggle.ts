/**
 * `Toggle`: a labelled on/off switch. State `on`; `density` is read from the Appearance the toggle names in its `appearance` config.
 */

import type { WidgetInterfaces } from '@deviltea/widget-core'
import type { ToggleConfig, ToggleRawConfig } from '../config'
import type { Density, I18nText } from '../domain'
import { createWidgetPlugin } from '@deviltea/widget-core'
import { checkToggleConfig, resolveToggleConfig } from '../config'
import { isBoolean, isDensity } from '../domain'
import { toggleConfigSchema } from '../schemas'
import { checkInsideSection, checkProvider, densityReads } from './structure'

export interface ToggleInterfaces extends WidgetInterfaces {
	config: { raw: ToggleRawConfig, resolved: ToggleConfig }
	state: { on: boolean }
	properties: { label: I18nText, density: Density }
}

export const TogglePlugin = createWidgetPlugin('Toggle')
	.description('A labelled on/off switch. State `on`. Properties: `label` and `density` (read from the Appearance named in the `appearance` config, through dep.widget(id)).')
	.interfaces<ToggleInterfaces>()
	.config({
		description: 'The label, the Appearance it reads and whether it is on at the start.',
		schema: toggleConfigSchema,
		validate: (input, ctx): input is ToggleRawConfig => {
			checkToggleConfig(input, diagnostic => ctx.addDiagnostic(diagnostic))
			return !ctx.hasAnyDiagnostic()
		},
		resolve: resolveToggleConfig,
	})
	.structure((ctx) => {
		checkInsideSection(ctx, 'Toggle')
		// A recovered config (it failed its own validation, which is reported) names nothing worth checking.
		if (!ctx.config.recovered)
			checkProvider(ctx, ctx.config.appearance, 'Appearance', 'appearance')
	})
	.state(state => state.on({
		validate: (input): input is boolean => isBoolean(input),
		default: ({ config }) => config.on,
	}))
	.properties(properties => properties
		.label({ compute: ({ config }) => config.label })
		.density({
			registerDeps: ({ dep, blueprint, config }) => densityReads(dep, blueprint, config.appearance),
			compute: ({ deps }) => {
				const density = deps.density?.()
				return density?.ok === true && isDensity(density.value) ? density.value : 'comfortable'
			},
		}))
	.done()
