/**
 * Interactive Survey curated Implementation-explorer registry (diagnostic #25 P3 Scope A). One entry per
 * `surveyPlugins` type (`./plugins/index.ts`) — semantic plugin file, Vue renderer file, and (only
 * where the widget's own behavior genuinely depends on domain calculations/scoring, not merely a
 * generic `isPlainObject` guard borrowed from `./domain.ts`) the domain helper file. `TripMetrics`/
 * `TripReadiness`/`TripRecommendation`/`TripSurvey` compute real trip-cost/scoring/readiness rules from
 * `./domain.ts`'s constants (`dailyCost`, `styleMultiplier`, `computeTripDays`,
 * `estimateBaselineCost`, ...); the question/section plugins only import it for plain type guards
 * (`isPlainObject`, `isValidCalendarDateString`) or option-value validation, so `domain.ts` is left out
 * of their curated files — it would not explain anything about how those widgets themselves behave.
 */

import type { SourcesRegistry } from '../../implementation/types'

const DOMAIN_PATH = 'apps/widget-lab/src/showcases/survey/domain.ts'

function loadDomain(): Promise<string> {
	return import('./domain.ts?raw').then(module => module.default)
}

function loadSections(): Promise<string> {
	return import('./plugins/sections.ts?raw').then(module => module.default)
}

function loadSurveyQuestions(): Promise<string> {
	return import('./plugins/survey-questions.ts?raw').then(module => module.default)
}

export const surveySources: SourcesRegistry = {
	TripSurvey: {
		files: [
			{ kind: 'plugin', title: 'trip-survey.ts', path: 'apps/widget-lab/src/showcases/survey/plugins/trip-survey.ts', load: () => import('./plugins/trip-survey.ts?raw').then(m => m.default) },
			{ kind: 'renderer', title: 'TripSurveyRenderer.vue', path: 'apps/widget-lab/src/showcases/survey/renderers/TripSurveyRenderer.vue', load: () => import('./renderers/TripSurveyRenderer.vue?raw').then(m => m.default) },
			{ kind: 'domain', title: 'domain.ts', path: DOMAIN_PATH, load: loadDomain },
		],
	},
	SurveySection: {
		files: [
			{ kind: 'plugin', title: 'sections.ts', path: 'apps/widget-lab/src/showcases/survey/plugins/sections.ts', load: loadSections },
			{ kind: 'renderer', title: 'SurveySectionRenderer.vue', path: 'apps/widget-lab/src/showcases/survey/renderers/SurveySectionRenderer.vue', load: () => import('./renderers/SurveySectionRenderer.vue?raw').then(m => m.default) },
		],
	},
	ConditionalSection: {
		files: [
			{ kind: 'plugin', title: 'sections.ts', path: 'apps/widget-lab/src/showcases/survey/plugins/sections.ts', load: loadSections },
			{ kind: 'renderer', title: 'ConditionalSectionRenderer.vue', path: 'apps/widget-lab/src/showcases/survey/renderers/ConditionalSectionRenderer.vue', load: () => import('./renderers/ConditionalSectionRenderer.vue?raw').then(m => m.default) },
		],
	},
	SurveyDateQuestion: {
		files: [
			{ kind: 'plugin', title: 'survey-questions.ts', path: 'apps/widget-lab/src/showcases/survey/plugins/survey-questions.ts', load: loadSurveyQuestions },
			{ kind: 'renderer', title: 'SurveyDateQuestionRenderer.vue', path: 'apps/widget-lab/src/showcases/survey/renderers/SurveyDateQuestionRenderer.vue', load: () => import('./renderers/SurveyDateQuestionRenderer.vue?raw').then(m => m.default) },
		],
	},
	SurveyNumberQuestion: {
		files: [
			{ kind: 'plugin', title: 'survey-questions.ts', path: 'apps/widget-lab/src/showcases/survey/plugins/survey-questions.ts', load: loadSurveyQuestions },
			{ kind: 'renderer', title: 'SurveyNumberQuestionRenderer.vue', path: 'apps/widget-lab/src/showcases/survey/renderers/SurveyNumberQuestionRenderer.vue', load: () => import('./renderers/SurveyNumberQuestionRenderer.vue?raw').then(m => m.default) },
		],
	},
	SurveyChoiceQuestion: {
		files: [
			{ kind: 'plugin', title: 'survey-questions.ts', path: 'apps/widget-lab/src/showcases/survey/plugins/survey-questions.ts', load: loadSurveyQuestions },
			{ kind: 'renderer', title: 'SurveyChoiceQuestionRenderer.vue', path: 'apps/widget-lab/src/showcases/survey/renderers/SurveyChoiceQuestionRenderer.vue', load: () => import('./renderers/SurveyChoiceQuestionRenderer.vue?raw').then(m => m.default) },
		],
	},
	TripMetrics: {
		files: [
			{ kind: 'plugin', title: 'trip-metrics.ts', path: 'apps/widget-lab/src/showcases/survey/plugins/trip-metrics.ts', load: () => import('./plugins/trip-metrics.ts?raw').then(m => m.default) },
			{ kind: 'renderer', title: 'TripMetricsRenderer.vue', path: 'apps/widget-lab/src/showcases/survey/renderers/TripMetricsRenderer.vue', load: () => import('./renderers/TripMetricsRenderer.vue?raw').then(m => m.default) },
			{ kind: 'domain', title: 'domain.ts', path: DOMAIN_PATH, load: loadDomain },
		],
	},
	TripReadiness: {
		files: [
			{ kind: 'plugin', title: 'trip-readiness.ts', path: 'apps/widget-lab/src/showcases/survey/plugins/trip-readiness.ts', load: () => import('./plugins/trip-readiness.ts?raw').then(m => m.default) },
			{ kind: 'renderer', title: 'TripReadinessRenderer.vue', path: 'apps/widget-lab/src/showcases/survey/renderers/TripReadinessRenderer.vue', load: () => import('./renderers/TripReadinessRenderer.vue?raw').then(m => m.default) },
			{ kind: 'domain', title: 'domain.ts', path: DOMAIN_PATH, load: loadDomain },
		],
	},
	TripRecommendation: {
		files: [
			{ kind: 'plugin', title: 'trip-recommendation.ts', path: 'apps/widget-lab/src/showcases/survey/plugins/trip-recommendation.ts', load: () => import('./plugins/trip-recommendation.ts?raw').then(m => m.default) },
			{ kind: 'renderer', title: 'TripRecommendationRenderer.vue', path: 'apps/widget-lab/src/showcases/survey/renderers/TripRecommendationRenderer.vue', load: () => import('./renderers/TripRecommendationRenderer.vue?raw').then(m => m.default) },
			{ kind: 'domain', title: 'domain.ts', path: DOMAIN_PATH, load: loadDomain },
		],
	},
}
