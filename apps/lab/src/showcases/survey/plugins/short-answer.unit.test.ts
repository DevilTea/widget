/**
 * `ShortAnswer` against the real `survey-default` preset (`phone`: always shown, required on site, at
 * most 20 characters) and a small survey for a question that can be hidden.
 */

import { describe, expect, it } from 'vitest'
import { createRuntimeFor, createSurveyRuntime, question, surveyOf, valueOf, widgetOfType } from '../test-support'

function setup() {
	const { runtime } = createSurveyRuntime()
	return {
		root: widgetOfType(runtime, 'open-day', 'Survey'),
		mode: widgetOfType(runtime, 'mode', 'SingleChoice'),
		phone: widgetOfType(runtime, 'phone', 'ShortAnswer'),
	}
}

describe('shortAnswer requiredness and effective value', () => {
	it('is required only on site, regardless of whether it is shown (Q3)', () => {
		const { mode, phone } = setup()
		expect(valueOf(phone.properties.required.get()))
			.toBe(false)
		mode.state.answer.set('onsite')
		expect(valueOf(phone.properties.required.get()))
			.toBe(true)
		mode.state.answer.set('online')
		expect(valueOf(phone.properties.required.get()))
			.toBe(false)
	})

	it('trims the text, and whitespace-only text is no answer', () => {
		const { mode, phone } = setup()
		mode.state.answer.set('onsite')
		phone.state.answer.set('  0912  ')
		expect(valueOf(phone.properties.value.get()))
			.toBe('0912')
		expect(phone.state.answer.get())
			.toBe('  0912  ')

		phone.state.answer.set('   ')
		expect(valueOf(phone.properties.value.get()))
			.toBeNull()
		expect(valueOf(phone.properties.errors.get())
			.map(error => error.code))
			.toEqual(['required'])
		phone.state.answer.set('')
		expect(valueOf(phone.properties.value.get()))
			.toBeNull()
	})

	it('reports no error for an optional empty answer', () => {
		const { phone } = setup()
		expect(valueOf(phone.properties.errors.get()))
			.toEqual([])
	})

	it('counts the trimmed text against maxLength, in the survey language', () => {
		const { root, mode, phone } = setup()
		mode.state.answer.set('onsite')
		phone.state.answer.set(`  ${'1'.repeat(20)}  `)
		expect(valueOf(phone.properties.errors.get()))
			.toEqual([])

		phone.state.answer.set('1'.repeat(21))
		expect(valueOf(phone.properties.errors.get()))
			.toEqual([{ code: 'max-length', message: 'Must be at most 20 characters.' }])
		root.state.language.set('zh-TW')
		expect(valueOf(phone.properties.errors.get()))
			.toEqual([{ code: 'max-length', message: '最多 20 個字元。' }])
	})

	it('counts characters, not UTF-16 units', () => {
		const { runtime } = createRuntimeFor(surveyOf([question('note', 'ShortAnswer', { maxLength: 2 })]))
		const note = widgetOfType(runtime, 'note', 'ShortAnswer')
		note.state.answer.set('😀😀')
		expect(valueOf(note.properties.errors.get()))
			.toEqual([])
		note.state.answer.set('😀😀😀')
		expect(valueOf(note.properties.errors.get())
			.map(error => error.code))
			.toEqual(['max-length'])
	})

	it('rejects a non-string answer and clear() empties it', () => {
		const { phone } = setup()
		phone.state.answer.set('1')
		expect(phone.state.answer.set(5 as never).ok)
			.toBe(false)
		expect(phone.state.answer.get())
			.toBe('1')
		phone.methods.clear()
		expect(phone.state.answer.get())
			.toBeNull()
	})
})

describe('shortAnswer text and visibility', () => {
	it('has label and help in the survey language', () => {
		const { root, phone } = setup()
		expect(valueOf(phone.properties.text.get()))
			.toEqual({ label: 'Phone number', help: 'Needed for on-site visitors.', options: [] })
		root.state.language.set('zh-TW')
		expect(valueOf(phone.properties.text.get()))
			.toEqual({ label: '聯絡電話', help: '現場參加者必填。', options: [] })
	})

	it('a hidden question keeps its raw answer, has a null value and no errors, and restores it when shown (Q1)', () => {
		const source = surveyOf([
			question('flag', 'ShortAnswer'),
			question('detail', 'ShortAnswer', { required: true, visibleWhen: { question: 'flag', op: 'equals', value: 'yes' } }),
		])
		const { runtime } = createRuntimeFor(source)
		const flag = widgetOfType(runtime, 'flag', 'ShortAnswer')
		const detail = widgetOfType(runtime, 'detail', 'ShortAnswer')
		detail.state.answer.set('details')
		expect(valueOf(detail.properties.visible.get()))
			.toBe(false)
		expect(valueOf(detail.properties.value.get()))
			.toBeNull()
		expect(valueOf(detail.properties.required.get()))
			.toBe(true)
		expect(valueOf(detail.properties.errors.get()))
			.toEqual([])

		flag.state.answer.set('yes')
		expect(valueOf(detail.properties.value.get()))
			.toBe('details')
	})
})
