/**
 * `InterestsStep`: step 2, what the new member wants to make. State `selected` is the list of picked option ids
 * (in the order of the options, whatever order they were ticked in, so two visitors with the same picks have the
 * same State). The step is complete once at least `minimum` interests are picked.
 */

import type { WidgetInterfaces } from '@deviltea/widget-core'
import type { InterestOptionRaw, InterestsConfig, InterestsRawConfig } from '../config'
import type { I18nText } from '../domain'
import { createWidgetPlugin, undocumented } from '@deviltea/widget-core'
import { checkInterestsConfig, resolveInterestsConfig } from '../config'
import { isStringArray } from '../domain'
import { checkInsideOnboarding } from './structure'

/**
 * Step 2 of the onboarding wizard: the interests the new member picks from the configured options (State `selected`: the
 * picked ids). Properties: `title`, `options`, `missing` (`interests:<n>` while `n` more must be picked to reach
 * `minimum`), `complete` and `answers` (the picked ids).
 */
export interface InterestsInterfaces extends WidgetInterfaces {
	/** The step title, the options (an id and a label per language), how many must be picked and which are picked at the start. */
	config: { raw: InterestsRawConfig, resolved: InterestsConfig }
	state: {
		/** The picked option ids, in the order of the options. */
		selected: readonly string[]
	}
	properties: {
		/** The step title per language. */
		title: I18nText
		/** The configured options: an id and a label per language. */
		options: readonly InterestOptionRaw[]
		/** `interests:<n>` while `n` more must be picked to reach `minimum`. */
		missing: readonly string[]
		/** Whether at least `minimum` interests are picked. */
		complete: boolean
		/** The picked ids. */
		answers: readonly string[]
	}
}

export const InterestsStepPlugin = createWidgetPlugin('InterestsStep')
	.description(undocumented)
	.interfaces<InterestsInterfaces>()
	.config({
		description: undocumented,
		validate: (input, ctx): input is InterestsRawConfig => {
			checkInterestsConfig(input, diagnostic => ctx.addDiagnostic(diagnostic))
			return !ctx.hasAnyDiagnostic()
		},
		resolve: resolveInterestsConfig,
	})
	.structure(ctx => checkInsideOnboarding(ctx, 'InterestsStep'))
	.state(state => state.selected({
		description: undocumented,
		validate: (input, ctx): input is readonly string[] => {
			if (!isStringArray(input))
				return false
			const known = ctx.config.options.map(option => option.id)
			return input.every(id => known.includes(id)) && new Set(input).size === input.length
		},
		default: ({ config }) => config.options.map(option => option.id)
			.filter(id => config.preselected.includes(id)),
	}))
	.properties(properties => properties
		.title({ description: undocumented, compute: ({ config }) => config.title })
		.options({ description: undocumented, compute: ({ config }) => config.options })
		.missing({
			description: undocumented,
			registerDeps: ({ dep }) => ({ selected: dep.self.state.get('selected') }),
			compute: ({ deps, config }) => {
				const selected = deps.selected()
				const remaining = config.minimum - (selected.ok ? (selected.value ?? []).length : 0)
				return remaining > 0 ? [`interests:${remaining}`] : []
			},
		})
		.complete({
			description: undocumented,
			registerDeps: ({ dep }) => ({ missing: dep.self.properties.get('missing') }),
			compute: ({ deps }) => {
				const missing = deps.missing()
				return missing.ok && missing.value.length === 0
			},
		})
		.answers({
			description: undocumented,
			registerDeps: ({ dep }) => ({ selected: dep.self.state.get('selected') }),
			compute: ({ deps }) => {
				const selected = deps.selected()
				return selected.ok ? (selected.value ?? []) : []
			},
		}))
	.done()
