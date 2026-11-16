/**
 * `Numeric` against the real `survey-default` preset (`guests`: shown on site, required, 0 to 3, whole
 * numbers) and small surveys built for the cases the preset does not have.
 */

import { describe, expect, it } from 'vitest'
import { createRuntimeFor, createSurveyRuntime, question, surveyOf, valueOf, widgetOfType } from '../test-support'

function setup() {
	const { runtime } = createSurveyRuntime()
	return {
		runtime,
		root: widgetOfType(runtime, 'open-day', 'Survey'),
		mode: widgetOfType(runtime, 'mode', 'SingleChoice'),
		guests: widgetOfType(runtime, 'guests', 'Numeric'),
	}
}

function errorCodes(guests: ReturnType<typeof setup>['guests']) {
	return valueOf(guests.properties.errors.get())
		.map(error => error.code)
}

describe('numeric visibility, requiredness and effective value', () => {
	it('is shown only while mode is onsite, and required regardless (Q3)', () => {
		const { mode, guests } = setup()
		expect(valueOf(guests.properties.visible.get()))
			.toBe(false)
		expect(valueOf(guests.properties.required.get()))
			.toBe(true)
		mode.state.answer.set('onsite')
		expect(valueOf(guests.properties.visible.get()))
			.toBe(true)
		mode.state.answer.set('online')
		expect(valueOf(guests.properties.visible.get()))
			.toBe(false)
		expect(valueOf(guests.properties.required.get()))
			.toBe(true)
	})

	it('keeps the raw answer while hidden, with a null value and no errors, and restores it when shown (Q1, Q3)', () => {
		const { mode, guests } = setup()
		mode.state.answer.set('onsite')
		guests.state.answer.set(3)
		expect(valueOf(guests.properties.value.get()))
			.toBe(3)

		mode.state.answer.set('online')
		expect(guests.state.answer.get())
			.toBe(3)
		expect(valueOf(guests.properties.value.get()))
			.toBeNull()
		expect(valueOf(guests.properties.errors.get()))
			.toEqual([])

		mode.state.answer.set('onsite')
		expect(valueOf(guests.properties.value.get()))
			.toBe(3)
	})

	it('a hidden required question reports no required error', () => {
		const { guests } = setup()
		expect(valueOf(guests.properties.visible.get()))
			.toBe(false)
		expect(valueOf(guests.properties.errors.get()))
			.toEqual([])
	})

	it('clear() empties the answer', () => {
		const { mode, guests } = setup()
		mode.state.answer.set('onsite')
		guests.state.answer.set(2)
		expect(guests.methods.clear().ok)
			.toBe(true)
		expect(guests.state.answer.get())
			.toBeNull()
	})

	it('stores only finite numbers: a string or NaN is rejected and the previous answer stays', () => {
		const { guests } = setup()
		guests.state.answer.set(2)
		expect(guests.state.answer.set('2' as never).ok)
			.toBe(false)
		expect(guests.state.answer.set(Number.NaN).ok)
			.toBe(false)
		expect(guests.state.answer.get())
			.toBe(2)
	})
})

describe('numeric answer errors', () => {
	it('reports required while visible and unanswered, in the survey language', () => {
		const { root, mode, guests } = setup()
		mode.state.answer.set('onsite')
		expect(valueOf(guests.properties.errors.get()))
			.toEqual([{ code: 'required', message: 'This question is required.' }])
		root.state.language.set('zh-TW')
		expect(valueOf(guests.properties.errors.get()))
			.toEqual([{ code: 'required', message: '此題為必填。' }])
	})

	it.each([
		[-1, ['min'], 'Must be at least 0.'],
		[4, ['max'], 'Must be at most 3.'],
		[1.5, ['integer'], 'Must be a whole number.'],
		[0, [], undefined],
		[3, [], undefined],
	])('answer %s gives errors %j', (answer, codes, firstMessage) => {
		const { mode, guests } = setup()
		mode.state.answer.set('onsite')
		guests.state.answer.set(answer)
		expect(errorCodes(guests))
			.toEqual(codes)
		expect(valueOf(guests.properties.errors.get())[0]?.message)
			.toBe(firstMessage)
		// An answer that breaks a limit is still stored and is the effective value: errors are data.
		expect(valueOf(guests.properties.value.get()))
			.toBe(answer)
	})

	it('reports several errors at once, and the message follows the language', () => {
		const { root, mode, guests } = setup()
		mode.state.answer.set('onsite')
		guests.state.answer.set(-0.5)
		expect(errorCodes(guests))
			.toEqual(['integer', 'min'])
		root.state.language.set('zh-TW')
		expect(valueOf(guests.properties.errors.get())
			.map(error => error.message))
			.toEqual(['請輸入整數。', '不可小於 0。'])
	})

	it('has no limit errors without min, max or integer', () => {
		const { runtime } = createRuntimeFor(surveyOf([question('n', 'Numeric')]))
		const n = widgetOfType(runtime, 'n', 'Numeric')
		n.state.answer.set(-1.5)
		expect(valueOf(n.properties.errors.get()))
			.toEqual([])
	})
})

describe('numeric text', () => {
	it('is the label and help in the survey language', () => {
		const { root, guests } = setup()
		expect(valueOf(guests.properties.text.get()))
			.toEqual({ label: 'Guests coming with you', help: null, options: [] })
		root.state.language.set('zh-TW')
		expect(valueOf(guests.properties.text.get()))
			.toEqual({ label: '同行人數', help: null, options: [] })
	})
})
