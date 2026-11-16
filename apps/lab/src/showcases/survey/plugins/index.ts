/**
 * The five survey-form plugins as one tuple for `createWidgetSystem` (see `../system.ts`). `Survey` is
 * first: the Implementation catalog marks the first type as the current one.
 */

import { MultipleChoicePlugin } from './multiple-choice'
import { NumericPlugin } from './numeric'
import { ShortAnswerPlugin } from './short-answer'
import { SingleChoicePlugin } from './single-choice'
import { SurveyPlugin } from './survey'

export * from './multiple-choice'
export * from './numeric'
export * from './short-answer'
export * from './single-choice'
export * from './survey'

export const surveyPlugins = [
	SurveyPlugin,
	SingleChoicePlugin,
	MultipleChoicePlugin,
	NumericPlugin,
	ShortAnswerPlugin,
] as const

export type SurveyPlugins = typeof surveyPlugins
