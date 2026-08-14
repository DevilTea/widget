/**
 * Survey Vue renderer registry, registered against `surveySystem` through the public
 * `@deviltea/widget-vue` contract only (`createWidgetVueRenderer`). Every plugin has a renderer
 * registration (the registry is exhaustive by construction) — `TripReadinessRenderer` /
 * `TripRecommendationRenderer` render nothing because those two widgets live only in `TripSurvey`'s
 * semantic-only `semantics` slot, which `TripSurveyRenderer` intentionally never renders.
 */

import { createWidgetVueRenderer } from '@deviltea/widget-vue'
import { surveySystem } from '../system'
import ConditionalSectionRenderer from './ConditionalSectionRenderer.vue'
import SurveyChoiceQuestionRenderer from './SurveyChoiceQuestionRenderer.vue'
import SurveyDateQuestionRenderer from './SurveyDateQuestionRenderer.vue'
import SurveyNumberQuestionRenderer from './SurveyNumberQuestionRenderer.vue'
import SurveySectionRenderer from './SurveySectionRenderer.vue'
import TripMetricsRenderer from './TripMetricsRenderer.vue'
import TripReadinessRenderer from './TripReadinessRenderer.vue'
import TripRecommendationRenderer from './TripRecommendationRenderer.vue'
import TripSurveyRenderer from './TripSurveyRenderer.vue'

export const SurveyRenderer = createWidgetVueRenderer(surveySystem, renderers =>
	renderers
		.TripSurvey(TripSurveyRenderer)
		.SurveySection(SurveySectionRenderer)
		.ConditionalSection(ConditionalSectionRenderer)
		.SurveyDateQuestion(SurveyDateQuestionRenderer)
		.SurveyNumberQuestion(SurveyNumberQuestionRenderer)
		.SurveyChoiceQuestion(SurveyChoiceQuestionRenderer)
		.TripMetrics(TripMetricsRenderer)
		.TripReadiness(TripReadinessRenderer)
		.TripRecommendation(TripRecommendationRenderer))
