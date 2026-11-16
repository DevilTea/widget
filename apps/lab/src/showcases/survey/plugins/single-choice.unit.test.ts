/**
 * `SingleChoice` against the real `survey-default` preset (`mode`) and a small survey whose options have
 * conditions (`seat`: option `b` is enabled on site, option `c` is shown on site).
 */

import { describe, expect, it } from 'vitest'
import { createRuntimeFor, createSurveyRuntime, question, surveyOf, t, valueOf, widgetOfType } from '../test-support'

function seatSurvey() {
	const { runtime } = createRuntimeFor(surveyOf([
		question('where', 'SingleChoice', { options: [{ value: 'onsite', label: t('On site') }, { value: 'online', label: t('Online') }] }),
		question('seat', 'SingleChoice', {
			required: true,
			options: [
				{ value: 'a', label: t('A') },
				{ value: 'b', label: t('B'), enabledWhen: { question: 'where', op: 'equals', value: 'onsite' } },
				{ value: 'c', label: t('C'), visibleWhen: { question: 'where', op: 'equals', value: 'onsite' } },
			],
		}),
	]))
	return {
		runtime,
		root: widgetOfType(runtime, 'survey', 'Survey'),
		where: widgetOfType(runtime, 'where', 'SingleChoice'),
		seat: widgetOfType(runtime, 'seat', 'SingleChoice'),
	}
}

describe('singleChoice on the default preset', () => {
	it('stores any string, but only an available option is the effective value', () => {
		const { runtime } = createSurveyRuntime()
		const mode = widgetOfType(runtime, 'mode', 'SingleChoice')
		expect(valueOf(mode.properties.value.get()))
			.toBeNull()
		mode.state.answer.set('online')
		expect(valueOf(mode.properties.value.get()))
			.toBe('online')
		expect(valueOf(mode.properties.errors.get()))
			.toEqual([])
		expect(mode.state.answer.set(3 as never).ok)
			.toBe(false)
	})

	it('reports required while unanswered, and invalid-option for an unknown option', () => {
		const { runtime } = createSurveyRuntime()
		const mode = widgetOfType(runtime, 'mode', 'SingleChoice')
		expect(valueOf(mode.properties.errors.get())
			.map(error => error.code))
			.toEqual(['required'])
		mode.state.answer.set('moon')
		expect(valueOf(mode.properties.value.get()))
			.toBeNull()
		expect(valueOf(mode.properties.errors.get())
			.map(error => error.code))
			.toEqual(['required', 'invalid-option'])
	})

	it('has the labels of every option in the survey language', () => {
		const { runtime } = createSurveyRuntime()
		const root = widgetOfType(runtime, 'open-day', 'Survey')
		const mode = widgetOfType(runtime, 'mode', 'SingleChoice')
		expect(valueOf(mode.properties.text.get()))
			.toEqual({
				label: 'How will you join?',
				help: null,
				options: [{ value: 'onsite', label: 'On site' }, { value: 'online', label: 'Online' }],
			})
		root.state.language.set('zh-TW')
		expect(valueOf(mode.properties.text.get()).options)
			.toEqual([{ value: 'onsite', label: '現場參加' }, { value: 'online', label: '線上參加' }])
		expect(valueOf(mode.properties.errors.get())[0]!.message)
			.toBe('此題為必填。')
	})

	it('clear() empties the answer', () => {
		const { runtime } = createSurveyRuntime()
		const mode = widgetOfType(runtime, 'mode', 'SingleChoice')
		mode.state.answer.set('online')
		mode.methods.clear()
		expect(mode.state.answer.get())
			.toBeNull()
	})
})

describe('singleChoice option conditions (Q2)', () => {
	it('evaluates visible and enabled per option', () => {
		const { where, seat } = seatSurvey()
		expect(valueOf(seat.properties.options.get()))
			.toEqual([
				{ value: 'a', visible: true, enabled: true },
				{ value: 'b', visible: true, enabled: false },
				{ value: 'c', visible: false, enabled: true },
			])
		where.state.answer.set('onsite')
		expect(valueOf(seat.properties.options.get()))
			.toEqual([
				{ value: 'a', visible: true, enabled: true },
				{ value: 'b', visible: true, enabled: true },
				{ value: 'c', visible: true, enabled: true },
			])
	})

	it('drops a selected option that becomes disabled and reports invalid-option; it returns with the option', () => {
		const { where, seat } = seatSurvey()
		where.state.answer.set('onsite')
		seat.state.answer.set('b')
		expect(valueOf(seat.properties.value.get()))
			.toBe('b')
		expect(valueOf(seat.properties.errors.get()))
			.toEqual([])

		where.state.answer.set('online')
		expect(seat.state.answer.get())
			.toBe('b')
		expect(valueOf(seat.properties.value.get()))
			.toBeNull()
		expect(valueOf(seat.properties.errors.get())
			.map(error => error.code))
			.toEqual(['required', 'invalid-option'])

		where.state.answer.set('onsite')
		expect(valueOf(seat.properties.value.get()))
			.toBe('b')
	})

	it('drops a selected option that becomes hidden', () => {
		const { where, seat } = seatSurvey()
		where.state.answer.set('onsite')
		seat.state.answer.set('c')
		where.state.answer.set('online')
		expect(valueOf(seat.properties.value.get()))
			.toBeNull()
		expect(valueOf(seat.properties.errors.get())
			.map(error => error.code))
			.toContain('invalid-option')
	})
})
