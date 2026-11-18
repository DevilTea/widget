import { describe, expect, it } from 'vitest'
import { SURVEY_QUESTION_TARGETS, surveyQuestionTarget } from './tutorial-targets'

describe('surveyQuestionTarget', () => {
	it('maps the two spotlighted questions of the survey form to their tutorial targets', () => {
		expect(SURVEY_QUESTION_TARGETS)
			.toEqual({ mode: 'survey-mode', guests: 'survey-guests' })
		expect(surveyQuestionTarget('mode'))
			.toBe('survey-mode')
		expect(surveyQuestionTarget('guests'))
			.toBe('survey-guests')
	})

	it('gives no target to other questions, nor to an id that names an inherited member of the map', () => {
		expect(surveyQuestionTarget('phone'))
			.toBeUndefined()
		for (const inherited of ['constructor', 'toString', '__proto__', 'hasOwnProperty']) {
			expect(surveyQuestionTarget(inherited))
				.toBeUndefined()
		}
	})
})
