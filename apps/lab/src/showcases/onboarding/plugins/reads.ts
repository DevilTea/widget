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

/** One entry per step, in order: the reads of its `title`, `missing` and `complete`. A container of dependency expressions only: pair it with `stepChildren(blueprint)` (same order) for the ids. */
export function stepSummaryReads(dep: OnboardingDeps, blueprint: BlueprintCompileView) {
	return stepChildren(blueprint)
		.map(({ id }) => {
			const step = dep.widget(id)
			return {
				title: step.properties.get('title')
					.validate(isI18nText),
				complete: step.properties.get('complete')
					.validate(isBoolean),
				missing: step.properties.get('missing')
					.validate(isStringArray),
			}
		})
}

/** One entry per step: the read of its `answers`. */
export function stepAnswerReads(dep: OnboardingDeps, blueprint: BlueprintCompileView) {
	return stepChildren(blueprint)
		.map(({ id }) => ({
			answers: dep.widget(id)
				.properties
				.get('answers')
				.validate(isDefined),
		}))
}
