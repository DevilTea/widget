/**
 * The nine Showcase A ("Interactive Survey") plugins (checkpoint §2), as one tuple for
 * `createWidgetSystem` (see `../system.ts`).
 */

import { ConditionalSectionPlugin, SurveySectionPlugin } from './sections'
import { SurveyChoiceQuestionPlugin, SurveyDateQuestionPlugin, SurveyNumberQuestionPlugin } from './survey-questions'
import { TripMetricsPlugin } from './trip-metrics'
import { TripReadinessPlugin } from './trip-readiness'
import { TripRecommendationPlugin } from './trip-recommendation'
import { TripSurveyPlugin } from './trip-survey'

export * from './sections'
export * from './survey-questions'
export * from './trip-metrics'
export * from './trip-readiness'
export * from './trip-recommendation'
export * from './trip-survey'

export const surveyPlugins = [
	TripSurveyPlugin,
	SurveySectionPlugin,
	ConditionalSectionPlugin,
	SurveyDateQuestionPlugin,
	SurveyNumberQuestionPlugin,
	SurveyChoiceQuestionPlugin,
	TripMetricsPlugin,
	TripReadinessPlugin,
	TripRecommendationPlugin,
] as const

export type SurveyPlugins = typeof surveyPlugins
