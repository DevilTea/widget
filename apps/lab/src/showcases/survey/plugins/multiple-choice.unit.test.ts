/**
 * `MultipleChoice` against the real `survey-default` preset (`sessions`: 1 to 2 of three options, laser
 * enabled on site, kids shown for guests > 0, one custom rule) and a small survey for `minSelected`.
 */

import { describe, expect, it } from 'vitest'
import { createRuntimeFor, createSurveyRuntime, question, surveyOf, t, valueOf, widgetOfType } from '../test-support'

function setup() {
	const { runtime } = createSurveyRuntime()
	return {
		root: widgetOfType(runtime, 'open-day', 'Survey'),
		mode: widgetOfType(runtime, 'mode', 'SingleChoice'),
		guests: widgetOfType(runtime, 'guests', 'Numeric'),
		sessions: widgetOfType(runtime, 'sessions', 'MultipleChoice'),
	}
}

type Sessions = ReturnType<typeof setup>['sessions']
function codes(sessions: Sessions) {
	return valueOf(sessions.properties.errors.get())
		.map(error => error.code)
}

describe('multipleChoice option conditions and the effective value (Q2)', () => {
	it('evaluates visible and enabled per option, from mode and guests', () => {
		const { mode, guests, sessions } = setup()
		expect(valueOf(sessions.properties.options.get()))
			.toEqual([
				{ value: 'printing', visible: true, enabled: true },
				{ value: 'laser', visible: true, enabled: false },
				{ value: 'kids', visible: false, enabled: true },
			])
		mode.state.answer.set('onsite')
		guests.state.answer.set(1)
		expect(valueOf(sessions.properties.options.get()))
			.toEqual([
				{ value: 'printing', visible: true, enabled: true },
				{ value: 'laser', visible: true, enabled: true },
				{ value: 'kids', visible: true, enabled: true },
			])
	})

	it('keeps only visible and enabled selections, in answer order and without duplicates; an empty result is null', () => {
		const { mode, sessions } = setup()
		mode.state.answer.set('onsite')
		sessions.state.answer.set(['laser', 'printing', 'laser'])
		expect(valueOf(sessions.properties.value.get()))
			.toEqual(['laser', 'printing'])

		sessions.state.answer.set([])
		expect(valueOf(sessions.properties.value.get()))
			.toBeNull()
		sessions.state.answer.set(['kids'])
		expect(valueOf(sessions.properties.value.get()))
			.toBeNull()
	})

	it('drops a selection that becomes disabled, keeps the raw answer and reports invalid-option', () => {
		const { mode, sessions } = setup()
		mode.state.answer.set('onsite')
		sessions.state.answer.set(['printing', 'laser'])
		expect(codes(sessions))
			.toEqual([])

		mode.state.answer.set('online')
		expect(sessions.state.answer.get())
			.toEqual(['printing', 'laser'])
		expect(valueOf(sessions.properties.value.get()))
			.toEqual(['printing'])
		expect(codes(sessions))
			.toEqual(['invalid-option'])

		mode.state.answer.set('onsite')
		expect(valueOf(sessions.properties.value.get()))
			.toEqual(['printing', 'laser'])
	})

	it('reports required as well when nothing is left, and invalid-option for an unknown option', () => {
		const { mode, sessions } = setup()
		mode.state.answer.set('online')
		sessions.state.answer.set(['laser'])
		expect(codes(sessions))
			.toEqual(['required', 'invalid-option'])
		sessions.state.answer.set(['printing', 'moon'])
		expect(codes(sessions))
			.toEqual(['invalid-option'])
	})

	it('rejects an answer that is not an array of strings', () => {
		const { sessions } = setup()
		expect(sessions.state.answer.set('printing' as never).ok)
			.toBe(false)
		expect(sessions.state.answer.set([1] as never).ok)
			.toBe(false)
	})
})

describe('multipleChoice selection counts', () => {
	it('reports max-selected from the effective selection', () => {
		const { mode, guests, sessions } = setup()
		mode.state.answer.set('onsite')
		guests.state.answer.set(1)
		sessions.state.answer.set(['printing', 'laser'])
		expect(codes(sessions))
			.toEqual([])
		sessions.state.answer.set(['printing', 'laser', 'kids'])
		expect(valueOf(sessions.properties.errors.get())[0])
			.toEqual({ code: 'max-selected', message: 'Select at most 2.' })
	})

	it('reports min-selected once answered, not before, and required covers the empty case', () => {
		const { runtime } = createRuntimeFor(surveyOf([question('pick', 'MultipleChoice', {
			minSelected: 2,
			options: [{ value: 'a', label: t('A') }, { value: 'b', label: t('B') }, { value: 'c', label: t('C') }],
		})]))
		const pick = widgetOfType(runtime, 'pick', 'MultipleChoice')
		expect(valueOf(pick.properties.errors.get()))
			.toEqual([])
		pick.state.answer.set(['a'])
		expect(valueOf(pick.properties.errors.get()))
			.toEqual([{ code: 'min-selected', message: 'Select at least 2.' }])
		pick.state.answer.set(['a', 'b'])
		expect(valueOf(pick.properties.errors.get()))
			.toEqual([])
	})
})

describe('multipleChoice custom rule and language', () => {
	it('fires the rule while laser is effectively selected and there are more than 2 guests', () => {
		const { mode, guests, sessions } = setup()
		mode.state.answer.set('onsite')
		guests.state.answer.set(3)
		sessions.state.answer.set(['laser'])
		expect(valueOf(sessions.properties.errors.get()))
			.toEqual([{ code: 'rule', message: 'Laser cutting has room for at most 2 guests.', rule: 0 }])

		// Online: laser is disabled, so it is not an effective selection and the rule goes (the raw answer stays).
		mode.state.answer.set('online')
		expect(codes(sessions))
			.toEqual(['required', 'invalid-option'])

		mode.state.answer.set('onsite')
		guests.state.answer.set(2)
		expect(codes(sessions))
			.toEqual([])
	})

	it('switches text, messages and rule message with the survey language', () => {
		const { root, mode, guests, sessions } = setup()
		mode.state.answer.set('onsite')
		guests.state.answer.set(3)
		sessions.state.answer.set(['laser'])
		root.state.language.set('zh-TW')
		expect(valueOf(sessions.properties.errors.get())[0]!.message)
			.toBe('雷射切割最多只能帶 2 位同行者。')
		expect(valueOf(sessions.properties.text.get()))
			.toEqual({
				label: '想參加的場次',
				help: '請選一到兩個。',
				options: [
					{ value: 'printing', label: '3D 列印入門' },
					{ value: 'laser', label: '雷射切割' },
					{ value: 'kids', label: '親子區' },
				],
			})
	})

	it('clear() empties the answer', () => {
		const { sessions } = setup()
		sessions.state.answer.set(['printing'])
		sessions.methods.clear()
		expect(sessions.state.answer.get())
			.toBeNull()
	})
})
