/**
 * Survey-form Vue renderer registry, registered against `surveySystem` through the public
 * `@deviltea/widget-vue` contract only (`createWidgetVueRenderer`). Every plugin has exactly one
 * renderer registration (the registry is exhaustive by construction).
 */

import { createWidgetVueRenderer } from '@deviltea/widget-vue'
import { surveySystem } from '../system'
import MultipleChoiceRenderer from './MultipleChoiceRenderer.vue'
import NumericRenderer from './NumericRenderer.vue'
import ShortAnswerRenderer from './ShortAnswerRenderer.vue'
import SingleChoiceRenderer from './SingleChoiceRenderer.vue'
import SurveyRootRenderer from './SurveyRootRenderer.vue'

export const SurveyRenderer = createWidgetVueRenderer(surveySystem, renderers =>
	renderers
		.Survey(SurveyRootRenderer)
		.SingleChoice(SingleChoiceRenderer)
		.MultipleChoice(MultipleChoiceRenderer)
		.Numeric(NumericRenderer)
		.ShortAnswer(ShortAnswerRenderer))
