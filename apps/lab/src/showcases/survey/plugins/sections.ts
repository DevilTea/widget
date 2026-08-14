/**
 * `SurveySection` and `ConditionalSection` (checkpoint §2). Both are `config + slots + properties`
 * only — presentation-only Property projections over resolved config, plus `ConditionalSection`'s
 * genuine cross-widget `visible` dependency. No state, no methods, no rules-engine expansion: the
 * condition operator set is intentionally locked to exactly `equals` / `not-equals` / `greater-than`
 * for this showcase.
 */

import type { WidgetInterfaces } from '@deviltea/widget-core'
import { createWidgetPlugin } from '@deviltea/widget-core'
import { isPlainObject } from '../domain'

// -------------------------------------------------------------------------------------------------
// SurveySection
// -------------------------------------------------------------------------------------------------

export interface SurveySectionRawConfig {
	readonly title: string
	readonly description?: string
}

export interface SurveySectionResolvedConfig {
	readonly title: string
	readonly description: string | null
}

export interface SurveySectionInterfaces extends WidgetInterfaces {
	config: {
		raw: SurveySectionRawConfig
		resolved: SurveySectionResolvedConfig
	}
	slots: 'body'
	properties: {
		heading: string
		description: string | null
	}
}

export const SurveySectionPlugin = createWidgetPlugin('SurveySection')
	.interfaces<SurveySectionInterfaces>()
	.config({
		validate: (input): input is SurveySectionRawConfig =>
			isPlainObject(input)
			&& typeof input.title === 'string'
			&& (input.description === undefined || typeof input.description === 'string'),
		resolve: raw => ({
			title: raw?.title ?? '',
			description: raw?.description ?? null,
		}),
	})
	.slots({ body: {} })
	.properties(properties =>
		properties
			.heading({ compute: ({ config }) => config.title })
			.description({ compute: ({ config }) => config.description }))
	.done()

// -------------------------------------------------------------------------------------------------
// ConditionalSection
// -------------------------------------------------------------------------------------------------

export type ConditionOperator = 'equals' | 'not-equals' | 'greater-than'

export interface ConditionalSectionCondition {
	readonly widgetId: string
	readonly stateKey: string
	readonly operator: ConditionOperator
	readonly value: string | number | boolean
}

export interface ConditionalSectionConfig {
	readonly title: string
	readonly condition: ConditionalSectionCondition
}

export interface ConditionalSectionInterfaces extends WidgetInterfaces {
	config: {
		raw: ConditionalSectionConfig
		resolved: ConditionalSectionConfig
	}
	slots: 'body'
	properties: {
		visible: boolean
	}
}

const CONDITION_OPERATORS: readonly ConditionOperator[] = ['equals', 'not-equals', 'greater-than']

function isConditionOperator(value: unknown): value is ConditionOperator {
	return typeof value === 'string' && (CONDITION_OPERATORS as readonly string[]).includes(value)
}

function isConditionValue(value: unknown): value is string | number | boolean {
	return typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean'
}

function isConditionalSectionCondition(value: unknown): value is ConditionalSectionCondition {
	return isPlainObject(value)
		&& typeof value.widgetId === 'string'
		&& typeof value.stateKey === 'string'
		&& isConditionOperator(value.operator)
		&& isConditionValue(value.value)
}

export const ConditionalSectionPlugin = createWidgetPlugin('ConditionalSection')
	.interfaces<ConditionalSectionInterfaces>()
	.config({
		validate: (input): input is ConditionalSectionConfig =>
			isPlainObject(input) && typeof input.title === 'string' && isConditionalSectionCondition(input.condition),
		resolve: raw => ({
			title: raw?.title ?? '',
			condition: raw?.condition ?? { widgetId: '', stateKey: '', operator: 'equals', value: '' },
		}),
	})
	.slots({ body: {} })
	.properties(properties =>
		properties.visible({
			// The unknown-target dependency read starts at `unknown`; when the configured operator is
			// known at registration time to require a number (`greater-than`), `.validate()` refines it —
			// a rejection (or an unresolvable target) automatically fails `visible` via core's dependency
			// propagation (issue #10 §12), which the renderer treats identically to `false` (hidden).
			registerDeps: ({ dep, config }) => {
				const target = dep.widget(config.condition.widgetId).state.get(config.condition.stateKey)
				return config.condition.operator === 'greater-than'
					? target.validate((value): value is number => typeof value === 'number')
					: target
			},
			compute: ({ deps, config }) => {
				const result = deps()
				if (!result.success)
					return false

				switch (config.condition.operator) {
					case 'equals':
						return result.value === config.condition.value
					case 'not-equals':
						return result.value !== config.condition.value
					case 'greater-than':
						return (result.value as number) > (config.condition.value as number)
				}
			},
		}))
	.done()
