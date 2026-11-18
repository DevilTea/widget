/**
 * `data-tutorial-target` lookup for the Survey renderers that are reused across several widget instances
 * (`SingleChoiceRenderer.vue`, `NumericRenderer.vue`, ... render every question of their type alike).
 * Keyed by widget id: the renderers read `widgetId` from `useWidget()`, so the key is the stable authored
 * id. Authored against `survey-default`'s questions
 * (`showcases/survey/presets.ts`) — the tutorial's OWNER-locked deterministic starting state — not a
 * generic every-preset mapping.
 *
 * Only the two questions the Survey tour spotlights get an entry (`mode` for steps 2, 3 and 5, `guests`
 * for step 4); every other question renders no `data-tutorial-target`. The root's `survey-actions` and
 * `survey-submitted` targets are fixed attributes of `showcases/survey/renderers/SurveyRootRenderer.vue`.
 */

export const SURVEY_QUESTION_TARGETS: Readonly<Record<string, string>> = {
	mode: 'survey-mode',
	guests: 'survey-guests',
}

/** The tutorial target of a survey question, or `undefined` (own keys only: never `constructor`). */
export function surveyQuestionTarget(widgetId: string): string | undefined {
	return Object.hasOwn(SURVEY_QUESTION_TARGETS, widgetId) ? SURVEY_QUESTION_TARGETS[widgetId] : undefined
}
