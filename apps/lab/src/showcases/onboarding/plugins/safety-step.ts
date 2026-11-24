/**
 * `SafetyStep`: step 3, the safety briefing. The visitor acknowledges each rule on its own; State `acknowledged`
 * holds the ids of the rules acknowledged so far. The step is complete when every rule is.
 */

import type { WidgetInterfaces } from '@deviltea/widget-core'
import type { SafetyConfig, SafetyRawConfig, SafetyRuleRaw } from '../config'
import type { I18nText } from '../domain'
import { createWidgetPlugin, undocumented } from '@deviltea/widget-core'
import { checkSafetyConfig, resolveSafetyConfig } from '../config'
import { isStringArray } from '../domain'
import { checkInsideOnboarding } from './structure'

/**
 * Step 3 of the onboarding wizard: the safety briefing. The visitor acknowledges each configured rule (State
 * `acknowledged`: the ids acknowledged so far). Properties: `title`, `rules`, `missing` (one `rule:<id>` per rule not yet
 * acknowledged), `complete` and `answers` (the acknowledged ids).
 */
export interface SafetyInterfaces extends WidgetInterfaces {
	/** The step title, the safety rules (an id and a text per language) and which are acknowledged at the start. */
	config: { raw: SafetyRawConfig, resolved: SafetyConfig }
	state: {
		/** The ids of the rules acknowledged so far. */
		acknowledged: readonly string[]
	}
	properties: {
		/** The step title per language. */
		title: I18nText
		/** The configured rules: an id and a text per language. */
		rules: readonly SafetyRuleRaw[]
		/** One `rule:<id>` per rule not yet acknowledged. */
		missing: readonly string[]
		/** Whether every rule is acknowledged. */
		complete: boolean
		/** The acknowledged ids. */
		answers: readonly string[]
	}
}

export const SafetyStepPlugin = createWidgetPlugin('SafetyStep')
	.description(undocumented)
	.interfaces<SafetyInterfaces>()
	.config({
		description: undocumented,
		validate: (input, ctx): input is SafetyRawConfig => {
			checkSafetyConfig(input, diagnostic => ctx.addDiagnostic(diagnostic))
			return !ctx.hasAnyDiagnostic()
		},
		resolve: resolveSafetyConfig,
	})
	.structure(ctx => checkInsideOnboarding(ctx, 'SafetyStep'))
	.state(state => state.acknowledged({
		description: undocumented,
		validate: (input, ctx): input is readonly string[] => {
			if (!isStringArray(input))
				return false
			const known = ctx.config.rules.map(rule => rule.id)
			return input.every(id => known.includes(id)) && new Set(input).size === input.length
		},
		default: ({ config }) => config.rules.map(rule => rule.id)
			.filter(id => config.acknowledged.includes(id)),
	}))
	.properties(properties => properties
		.title({ description: undocumented, compute: ({ config }) => config.title })
		.rules({ description: undocumented, compute: ({ config }) => config.rules })
		.missing({
			description: undocumented,
			registerDeps: ({ dep }) => ({ acknowledged: dep.self.state.get('acknowledged') }),
			compute: ({ deps, config }) => {
				const acknowledged = deps.acknowledged()
				const done = acknowledged.ok ? (acknowledged.value ?? []) : []
				return config.rules.filter(rule => !done.includes(rule.id))
					.map(rule => `rule:${rule.id}`)
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
			registerDeps: ({ dep }) => ({ acknowledged: dep.self.state.get('acknowledged') }),
			compute: ({ deps }) => {
				const acknowledged = deps.acknowledged()
				return acknowledged.ok ? (acknowledged.value ?? []) : []
			},
		}))
	.done()
