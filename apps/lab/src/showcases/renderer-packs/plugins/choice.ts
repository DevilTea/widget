/**
 * `Choice`: a labelled choice between the configured options. State `value` holds the value of the chosen option; a value
 * that is not one of the options is refused by the State's own validation. `density` is read from the Appearance the choice names.
 */

import type { WidgetInterfaces } from '@deviltea/widget-core'
import type { ChoiceConfig, ChoiceRawConfig } from '../config'
import type { ChoiceOption, Density, I18nText } from '../domain'
import { createWidgetPlugin, undocumented } from '@deviltea/widget-core'
import { checkChoiceConfig, resolveChoiceConfig } from '../config'
import { isDensity, isString } from '../domain'
import { checkInsideSection, checkProvider, densityReads } from './structure'

/**
 * A labelled choice between options. State `value` (the value of the chosen option; anything else is refused). Properties:
 * `label`, `options` and `density` (read from the Appearance named in the `appearance` config, through dep.widget(id)).
 */
export interface ChoiceInterfaces extends WidgetInterfaces {
	/** The label, the Appearance it reads, the options (at least two) and the value chosen at the start. */
	config: { raw: ChoiceRawConfig, resolved: ChoiceConfig }
	state: {
		/** The value of the chosen option; a value that is not one of the options is refused. */
		value: string
	}
	properties: {
		/** The label per language. */
		label: I18nText
		/** The configured options: a value and a label per language each. */
		options: readonly ChoiceOption[]
		/** `comfortable` or `compact`: the `density` State of the Appearance named in the `appearance` config, read through `dep.widget(id)`; `comfortable` when it cannot be read. */
		density: Density
	}
}

export const ChoicePlugin = createWidgetPlugin('Choice')
	.description(undocumented)
	.interfaces<ChoiceInterfaces>()
	.config({
		description: undocumented,
		validate: (input, ctx): input is ChoiceRawConfig => {
			checkChoiceConfig(input, diagnostic => ctx.addDiagnostic(diagnostic))
			return !ctx.hasAnyDiagnostic()
		},
		resolve: resolveChoiceConfig,
	})
	.structure((ctx) => {
		checkInsideSection(ctx, 'Choice')
		// A recovered config (it failed its own validation, which is reported) names nothing worth checking.
		if (!ctx.config.recovered)
			checkProvider(ctx, ctx.config.appearance, 'Appearance', 'appearance')
	})
	.state(state => state.value({
		description: undocumented,
		validate: (input, ctx): input is string => isString(input) && ctx.config.options.some(option => option.value === input),
		default: ({ config }) => config.value,
	}))
	.properties(properties => properties
		.label({ description: undocumented, compute: ({ config }) => config.label })
		.options({ description: undocumented, compute: ({ config }) => config.options })
		.density({
			description: undocumented,
			registerDeps: ({ dep, blueprint, config }) => densityReads(dep, blueprint, config.appearance),
			compute: ({ deps }) => {
				const density = deps.density?.()
				return density?.ok === true && isDensity(density.value) ? density.value : 'comfortable'
			},
		}))
	.done()
