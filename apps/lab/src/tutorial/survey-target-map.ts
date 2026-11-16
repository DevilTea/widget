/**
 * `data-tutorial-target` lookup for Survey renderer components that are reused across several distinct
 * widget instances (`SurveyNumberQuestionRenderer.vue` renders Adults/Children/Budget alike;
 * `SurveyDateQuestionRenderer.vue` renders Departure/Return alike). Deliberately keyed by each
 * question's `label` Property — a value every renderer already reads through `useProperties()` for its
 * own `<label>` text — rather than by widget id: `useWidget()` never exposes widget instance identity to
 * renderer code (a locked `@deviltea/widget-vue` boundary; see diagnostic #25's gate review point 9 on the
 * `useWidget()` identity gap, which is explicitly P2's concern, not P1's), so this stays within what a
 * renderer can already see. Authored against `survey-default`'s known labels (`showcases/trip-survey/presets.ts`)
 * — the tutorial's OWNER-locked deterministic starting state — not a generic every-preset mapping.
 *
 * Only questions the Survey tour actually spotlights get an entry; every other question (Budget,
 * Departure, Destination, Travel style, Family priority) renders no `data-tutorial-target` at all.
 */

export const SURVEY_NUMBER_QUESTION_TARGETS: Readonly<Record<string, string>> = {
	Adults: 'survey-adults',
	Children: 'survey-children',
}

export const SURVEY_DATE_QUESTION_TARGETS: Readonly<Record<string, string>> = {
	'Return date': 'survey-return-date',
}

/**
 * The survey-form showcase's `data-tutorial-target` lookup, keyed by widget id: its renderers read
 * `widgetId` from `useWidget()`, so unlike the label-keyed maps above the key is the stable id. Authored
 * against the default preset's questions (`showcases/survey/presets.ts`); only the two questions the
 * tour spotlights get an entry. The root's `survey-actions` and `survey-submitted` targets are fixed
 * attributes of `showcases/survey/renderers/SurveyRootRenderer.vue`. PS2 removes the label-keyed maps above.
 */
export const SURVEY_QUESTION_TARGETS: Readonly<Record<string, string>> = {
	mode: 'survey-mode',
	guests: 'survey-guests',
}

/** The tutorial target of a survey-form question, or `undefined` (own keys only: never `constructor`). */
export function surveyQuestionTarget(widgetId: string): string | undefined {
	return Object.hasOwn(SURVEY_QUESTION_TARGETS, widgetId) ? SURVEY_QUESTION_TARGETS[widgetId] : undefined
}
