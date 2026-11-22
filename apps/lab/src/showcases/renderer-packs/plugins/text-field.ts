/**
 * `TextField`: a labelled text box. State `value` takes any string (writing State is always accepted, whatever the renderer
 * pack drew the box with); Property `message` is the validation message of the current value (`textProblem`: text per
 * language, or `null` while it is acceptable), so every pack says the same thing about the same value. `density` is read from
 * the Appearance the field names in its `appearance` config.
 */

import type { WidgetInterfaces } from '@deviltea/widget-core'
import type { TextFieldConfig, TextFieldRawConfig } from '../config'
import type { Density, I18nText } from '../domain'
import { createWidgetPlugin } from '@deviltea/widget-core'
import { checkTextFieldConfig, resolveTextFieldConfig } from '../config'
import { isDensity, isString, textProblem } from '../domain'
import { checkInsideSection, checkProvider, densityReads } from './structure'

/**
 * A labelled text box. State `value`. Properties: `label`, `placeholder`, `maxLength`, `message` (the validation message of
 * the current value, or null while it is acceptable) and `density` (read from the Appearance named in the `appearance` config,
 * through dep.widget(id)).
 */
export interface TextFieldInterfaces extends WidgetInterfaces {
	/** The label, a placeholder, how many characters are acceptable, the Appearance it reads and the value at the start. */
	config: { raw: TextFieldRawConfig, resolved: TextFieldConfig }
	state: {
		/** The text, as typed: any string is accepted. */
		value: string
	}
	properties: {
		/** The label per language. */
		label: I18nText
		/** The placeholder per language; `null` without one. */
		placeholder: I18nText | null
		/** How many characters are acceptable. */
		maxLength: number
		/** The validation message of the current value per language; `null` while it is acceptable. */
		message: I18nText | null
		/** `comfortable` or `compact`: the `density` State of the Appearance named in the `appearance` config, read through `dep.widget(id)`; `comfortable` when it cannot be read. */
		density: Density
	}
}

export const TextFieldPlugin = createWidgetPlugin('TextField')
	.interfaces<TextFieldInterfaces>()
	.config({
		validate: (input, ctx): input is TextFieldRawConfig => {
			checkTextFieldConfig(input, diagnostic => ctx.addDiagnostic(diagnostic))
			return !ctx.hasAnyDiagnostic()
		},
		resolve: resolveTextFieldConfig,
	})
	.structure((ctx) => {
		checkInsideSection(ctx, 'TextField')
		// A recovered config (it failed its own validation, which is reported) names nothing worth checking.
		if (!ctx.config.recovered)
			checkProvider(ctx, ctx.config.appearance, 'Appearance', 'appearance')
	})
	.state(state => state.value({
		validate: (input): input is string => isString(input),
		default: ({ config }) => config.value,
	}))
	.properties(properties => properties
		.label({ compute: ({ config }) => config.label })
		.placeholder({ compute: ({ config }) => config.placeholder })
		.maxLength({ compute: ({ config }) => config.maxLength })
		.message({
			registerDeps: ({ dep }) => ({ value: dep.self.state.get('value') }),
			compute: ({ deps, config }) => {
				const value = deps.value()
				return value.ok ? textProblem(value.value ?? '', config.maxLength) : null
			},
		})
		.density({
			registerDeps: ({ dep, blueprint, config }) => densityReads(dep, blueprint, config.appearance),
			compute: ({ deps }) => {
				const density = deps.density?.()
				return density?.ok === true && isDensity(density.value) ? density.value : 'comfortable'
			},
		}))
	.done()
