/**
 * `data-tutorial-target` lookup for Survey renderer components that are reused across several distinct
 * widget instances (`SurveyNumberQuestionRenderer.vue` renders Adults/Children/Budget alike;
 * `SurveyDateQuestionRenderer.vue` renders Departure/Return alike). Deliberately keyed by each
 * question's `label` Property — a value every renderer already reads through `useProperties()` for its
 * own `<label>` text — rather than by widget id: `useWidget()` never exposes widget instance identity to
 * renderer code (a locked `@deviltea/widget-vue` boundary; see diagnostic #25's gate review point 9 on the
 * `useWidget()` identity gap, which is explicitly P2's concern, not P1's), so this stays within what a
 * renderer can already see. Authored against `survey-default`'s known labels (`showcases/survey/presets.ts`)
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
