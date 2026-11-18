/**
 * Dependency helpers shared by the onboarding plugins. The root reaches its steps only through declared
 * dependencies (`dep.widget(id)`): it cannot know the ids statically, so they come from the Blueprint (the children
 * of its `steps` slot). Every step exposes the same four Properties, which is the whole contract between the root
 * and a step: `title`, `missing`, `complete` and `answers`.
 */

import type { BlueprintCompileView, DependencyBuilder, WidgetInterfaces } from '@deviltea/widget-core'
import { isBoolean, isI18nText, isStringArray } from '../domain'
import { stepChildren } from './structure'

export type OnboardingDeps = Pick<DependencyBuilder<WidgetInterfaces, 'property'>, 'widget' | 'root'>

function isDefined(value: unknown): value is NonNullable<unknown> | null {
	return value !== undefined
}

/**
 * The reads of every step's `title`, `missing` and `complete`, keyed by step id. The keys are looked up, never iterated:
 * the order of the steps is the Blueprint's (`stepChildren`), so an integer-like id that an object would sort first
 * changes nothing.
 */
export function stepSummaryReads(dep: OnboardingDeps, blueprint: BlueprintCompileView) {
	return Object.fromEntries(stepChildren(blueprint)
		.map(({ id }) => {
			const step = dep.widget(id)
			return [id, {
				title: step.properties.get('title')
					.validate(isI18nText),
				complete: step.properties.get('complete')
					.validate(isBoolean),
				missing: step.properties.get('missing')
					.validate(isStringArray),
			}] as const
		}))
}

/** The read of every step's `answers`, keyed by step id (looked up in the Blueprint's order, like `stepSummaryReads`). */
export function stepAnswerReads(dep: OnboardingDeps, blueprint: BlueprintCompileView) {
	return Object.fromEntries(stepChildren(blueprint)
		.map(({ id }) => [id, {
			answers: dep.widget(id)
				.properties
				.get('answers')
				.validate(isDefined),
		}] as const))
}
