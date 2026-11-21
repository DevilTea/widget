/**
 * `Choice`: a labelled choice between the configured options. State `value` holds the value of the chosen option; a value
 * that is not one of the options is refused by the State's own validation. `density` is read from the Appearance the choice names.
 */

import type { WidgetInterfaces } from '@deviltea/widget-core'
import type { ChoiceConfig, ChoiceRawConfig } from '../config'
import type { ChoiceOption, Density, I18nText } from '../domain'
import { createWidgetPlugin } from '@deviltea/widget-core'
import { checkChoiceConfig, resolveChoiceConfig } from '../config'
import { isDensity, isString } from '../domain'
import { choiceConfigSchema } from '../schemas'
import { checkInsideSection, checkProvider, densityReads } from './structure'

export interface ChoiceInterfaces extends WidgetInterfaces {
	config: { raw: ChoiceRawConfig, resolved: ChoiceConfig }
	state: { value: string }
	properties: { label: I18nText, options: readonly ChoiceOption[], density: Density }
}

export const ChoicePlugin = createWidgetPlugin('Choice')
	.description('A labelled choice between options. State `value` (the value of the chosen option; anything else is refused). Properties: `label`, `options` and `density` (read from the Appearance named in the `appearance` config, through dep.widget(id)).')
	.interfaces<ChoiceInterfaces>()
	.config({
		description: 'The label, the Appearance it reads, the options (at least two) and the value chosen at the start.',
		schema: choiceConfigSchema,
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
		validate: (input, ctx): input is string => isString(input) && ctx.config.options.some(option => option.value === input),
		default: ({ config }) => config.value,
	}))
	.properties(properties => properties
		.label({ compute: ({ config }) => config.label })
		.options({ compute: ({ config }) => config.options })
		.density({
			registerDeps: ({ dep, blueprint, config }) => densityReads(dep, blueprint, config.appearance),
			compute: ({ deps }) => {
				const density = deps.density?.()
				return density?.ok === true && isDensity(density.value) ? density.value : 'comfortable'
			},
		}))
	.done()
