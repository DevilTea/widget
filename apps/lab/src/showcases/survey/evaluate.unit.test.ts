/**
 * The JSON-in/JSON-out evaluation function: what a backend gets for a request, and that it is the same
 * response the Preview's root widget computes for the same answers.
 */

import { describe, expect, it } from 'vitest'
import { evaluateResponse, evaluateResponseJson } from './evaluate'
import { defaultSurveyPreset, surveyPresets } from './presets'
import { createSurveyRuntime, question, surveyOf, t, valueOf, widgetOfType } from './test-support'

const survey = JSON.parse(defaultSurveyPreset.sourceText) as unknown
const aiDraft = JSON.parse(surveyPresets.find(preset => preset.id === 'survey-ai-draft')!.sourceText) as unknown

const onsiteAnswers = { mode: 'onsite', guests: 2, sessions: ['printing', 'laser'], phone: '0912 345 678' }

describe('evaluateResponse', () => {
	it('returns the response, canSubmit and no rejections for a valid request', () => {
		const result = evaluateResponse({ survey, answers: onsiteAnswers })
		expect(result)
			.toEqual({
				ok: true,
				canSubmit: true,
				rejected: [],
				response: {
					language: 'en',
					answers: {
						mode: { visible: true, required: true, value: 'onsite', errors: [] },
						guests: { visible: true, required: true, value: 2, errors: [] },
						sessions: { visible: true, required: true, value: ['printing', 'laser'], errors: [] },
						phone: { visible: true, required: true, value: '0912 345 678', errors: [] },
					},
				},
			})
	})

	it('reports answer errors as data, and a hidden question as value null', () => {
		const result = evaluateResponse({ survey, answers: { mode: 'online', guests: 3, sessions: ['laser'] } })
		expect(result.ok && result.canSubmit)
			.toBe(false)
		expect(result.ok ? result.response.answers : null)
			.toEqual({
				mode: { visible: true, required: true, value: 'online', errors: [] },
				guests: { visible: false, required: true, value: null, errors: [] },
				sessions: { visible: true, required: true, value: null, errors: [{ code: 'invalid-option', message: 'The selected option is not available.' }] },
				phone: { visible: true, required: false, value: null, errors: [] },
			})
	})

	it('treats an empty choice answer as no selection, so only required is reported', () => {
		const result = evaluateResponse({ survey, answers: { mode: '', sessions: [''] } })
		expect(result.ok ? result.response.answers.mode!.errors.map(error => error.code) : null)
			.toEqual(['required'])
		expect(result.ok ? result.response.answers.sessions!.errors.map(error => error.code) : null)
			.toEqual(['required'])
	})

	it('answers in the requested language', () => {
		const result = evaluateResponse({ survey, language: 'zh-TW', answers: { mode: 'onsite' } })
		expect(result.ok ? result.response.language : null)
			.toBe('zh-TW')
		expect(result.ok ? result.response.answers.guests!.errors : null)
			.toEqual([{ code: 'required', message: '此題為必填。' }])
	})

	it('equals the Runtime\'s open-day.response for the same answers', () => {
		const { runtime } = createSurveyRuntime()
		widgetOfType(runtime, 'mode', 'SingleChoice').state.answer.set('onsite')
		widgetOfType(runtime, 'guests', 'Numeric').state.answer.set(2)
		widgetOfType(runtime, 'sessions', 'MultipleChoice').state.answer.set(['printing', 'laser'])
		widgetOfType(runtime, 'phone', 'ShortAnswer').state.answer.set('0912 345 678')
		const root = widgetOfType(runtime, 'open-day', 'Survey')
		root.state.language.set('zh-TW')
		const result = evaluateResponse({ survey, language: 'zh-TW', answers: onsiteAnswers })
		expect(result.ok ? result.response : null)
			.toEqual(valueOf(root.properties.response.get()))
		expect(result.ok ? result.canSubmit : null)
			.toBe(valueOf(root.properties.canSubmit.get()))
	})

	it('starts from fresh State each time', () => {
		evaluateResponse({ survey, answers: onsiteAnswers })
		const second = evaluateResponse({ survey, answers: {} })
		expect(second.ok ? second.response.answers.mode!.value : 'failed')
			.toBeNull()
	})
})

describe('evaluateResponse rejections', () => {
	it('lists an unknown question, a wrongly typed answer and an unsupported language, and still evaluates the rest', () => {
		const result = evaluateResponse({
			survey,
			language: 'fr',
			answers: { mode: 'onsite', ghost: 1, guests: '2', sessions: 'printing', phone: 5, title: 'x' },
		})
		expect(result.ok ? result.rejected : null)
			.toEqual([
				{ questionId: null, reason: 'invalid-language' },
				{ questionId: 'ghost', reason: 'unknown-question' },
				{ questionId: 'guests', reason: 'invalid-answer' },
				{ questionId: 'sessions', reason: 'invalid-answer' },
				{ questionId: 'phone', reason: 'invalid-answer' },
				{ questionId: 'title', reason: 'unknown-question' },
			])
		expect(result.ok ? result.response.language : null)
			.toBe('en')
		expect(result.ok ? result.response.answers.mode!.value : null)
			.toBe('onsite')
		expect(result.ok ? result.response.answers.guests!.value : 'failed')
			.toBeNull()
	})

	it('rejects the root as a question: its id is not a question', () => {
		const result = evaluateResponse({ survey, answers: { 'open-day': 'x' } })
		expect(result.ok ? result.rejected : null)
			.toEqual([{ questionId: 'open-day', reason: 'unknown-question' }])
	})
})

describe('evaluateResponse for a survey that does not compile', () => {
	it('is not ok and returns the located diagnostics as plain data', () => {
		const result = evaluateResponse({ survey: aiDraft, answers: {} })
		expect(result.ok)
			.toBe(false)
		const diagnostics = result.ok ? [] : result.diagnostics
		expect(diagnostics.map(diagnostic => JSON.stringify([diagnostic.code, diagnostic.widgetId, diagnostic.member, diagnostic.sourcePath]))
			.sort())
			.toEqual([
				['invalid-widget-config', 'mode', null, ['slots', 'questions', 0, 'config', 'options']],
				['invalid-widget-structure', 'phone', null, ['slots', 'questions', 3]],
				['invalid-widget-structure', 'sessions', null, ['slots', 'questions', 2]],
				['missing-dependency-target', 'guests', 'visible', ['slots', 'questions', 1]],
				['unknown-widget-type', 'rating', null, ['slots', 'questions', 4]],
			].map(fact => JSON.stringify(fact))
				.sort())
	})

	it('locates a slot-child diagnostic at the child inside the slot', () => {
		const inner = { id: 'inner', type: 'Survey', config: { title: t('Inner'), languages: ['en'] } }
		const result = evaluateResponse({ survey: surveyOf([question('age', 'Numeric'), inner]), answers: {} })
		expect(result.ok ? null : result.diagnostics.map(diagnostic => [diagnostic.code, diagnostic.widgetId, diagnostic.sourcePath]))
			.toEqual(expect.arrayContaining([['invalid-widget-structure', 'survey', ['slots', 'questions', 1]]]))
	})

	it('reports the cycle on the members of the loop', () => {
		const cycle = JSON.parse(surveyPresets.find(preset => preset.id === 'survey-cycle')!.sourceText) as unknown
		const result = evaluateResponse({ survey: cycle, answers: {} })
		expect(result.ok
			? []
			: result.diagnostics.map(diagnostic => `${diagnostic.widgetId}.${diagnostic.member}`)
					.sort())
			.toEqual(['guests.value', 'guests.visible', 'sessions.options', 'sessions.value'])
	})

	it('reports a source that is not a widget, and a request that is not a request', () => {
		const notAWidget = evaluateResponse({ survey: 5, answers: {} })
		expect(notAWidget.ok)
			.toBe(false)
		const malformed = evaluateResponse({ survey, answers: [] as never })
		expect(malformed)
			.toMatchObject({ ok: false, diagnostics: [{ code: 'invalid-request' }] })
	})
})

describe('evaluateResponseJson', () => {
	it('survives a JSON round trip and matches evaluateResponse', () => {
		const request = { survey, language: 'zh-TW', answers: onsiteAnswers }
		const text = evaluateResponseJson(JSON.stringify(request))
		expect(JSON.parse(text))
			.toEqual(evaluateResponse(request))
		expect(JSON.parse(JSON.stringify(JSON.parse(text))))
			.toEqual(JSON.parse(text))
	})

	it('answers text that is not JSON with an invalid-request result', () => {
		expect(JSON.parse(evaluateResponseJson('{ nope')))
			.toMatchObject({ ok: false, diagnostics: [{ code: 'invalid-request' }] })
	})
})
