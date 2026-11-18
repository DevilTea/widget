/**
 * `SafetyStep`: step 3, the safety briefing. The visitor acknowledges each rule on its own; State `acknowledged`
 * holds the ids of the rules acknowledged so far. The step is complete when every rule is.
 */

import type { WidgetInterfaces } from '@deviltea/widget-core'
import type { SafetyConfig, SafetyRawConfig, SafetyRuleRaw } from '../config'
import type { I18nText } from '../domain'
import { createWidgetPlugin } from '@deviltea/widget-core'
import { checkSafetyConfig, resolveSafetyConfig } from '../config'
import { isStringArray } from '../domain'
import { safetyConfigSchema } from '../schemas'
import { checkInsideOnboarding } from './structure'

export interface SafetyInterfaces extends WidgetInterfaces {
	config: { raw: SafetyRawConfig, resolved: SafetyConfig }
	state: { acknowledged: readonly string[] }
	properties: {
		title: I18nText
		rules: readonly SafetyRuleRaw[]
		missing: readonly string[]
		complete: boolean
		answers: readonly string[]
	}
}

export const SafetyStepPlugin = createWidgetPlugin('SafetyStep')
	.description('Step 3 of the onboarding wizard: the safety briefing. The visitor acknowledges each configured rule (State `acknowledged`: the ids acknowledged so far). Properties: `title`, `rules`, `missing` (one `rule:<id>` per rule not yet acknowledged), `complete` and `answers` (the acknowledged ids).')
	.interfaces<SafetyInterfaces>()
	.config({
		description: 'The step title, the safety rules (an id and a text per language) and which are acknowledged at the start.',
		schema: safetyConfigSchema,
		validate: (input, ctx): input is SafetyRawConfig => {
			checkSafetyConfig(input, diagnostic => ctx.addDiagnostic(diagnostic))
			return !ctx.hasAnyDiagnostic()
		},
		resolve: resolveSafetyConfig,
	})
	.structure(ctx => checkInsideOnboarding(ctx, 'SafetyStep'))
	.state(state => state.acknowledged({
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
		.title({ compute: ({ config }) => config.title })
		.rules({ compute: ({ config }) => config.rules })
		.missing({
			registerDeps: ({ dep }) => ({ acknowledged: dep.self.state.get('acknowledged') }),
			compute: ({ deps, config }) => {
				const acknowledged = deps.acknowledged()
				const done = acknowledged.ok ? (acknowledged.value ?? []) : []
				return config.rules.filter(rule => !done.includes(rule.id))
					.map(rule => `rule:${rule.id}`)
			},
		})
		.complete({
			registerDeps: ({ dep }) => ({ missing: dep.self.properties.get('missing') }),
			compute: ({ deps }) => {
				const missing = deps.missing()
				return missing.ok && missing.value.length === 0
			},
		})
		.answers({
			registerDeps: ({ dep }) => ({ acknowledged: dep.self.state.get('acknowledged') }),
			compute: ({ deps }) => {
				const acknowledged = deps.acknowledged()
				return acknowledged.ok ? (acknowledged.value ?? []) : []
			},
		}))
	.done()
