/**
 * `Survey`: the aggregated `response`, `canSubmit`, `changedSinceSubmit`, the survey language, and the
 * blocked versus successful `submit()`, against the real `survey-default` preset.
 */

import type { SurveyResponse } from '../domain'
import { inspectBlueprint } from '@deviltea/widget-core/inspection'
import { describe, expect, it } from 'vitest'
import { createSurveyRuntime, valueOf, widgetOfType } from '../test-support'

function setup() {
	const { runtime } = createSurveyRuntime()
	const submitted: SurveyResponse[] = []
	const root = widgetOfType(runtime, 'open-day', 'Survey')
	root.events.submitted.subscribe(response => submitted.push(response))
	return {
		runtime,
		root,
		submitted,
		mode: widgetOfType(runtime, 'mode', 'SingleChoice'),
		guests: widgetOfType(runtime, 'guests', 'Numeric'),
		sessions: widgetOfType(runtime, 'sessions', 'MultipleChoice'),
		phone: widgetOfType(runtime, 'phone', 'ShortAnswer'),
	}
}

type Setup = ReturnType<typeof setup>

/** A complete valid on-site answer set. */
function fillOnsite({ mode, guests, sessions, phone }: Setup, guestCount = 2): void {
	mode.state.answer.set('onsite')
	guests.state.answer.set(guestCount)
	sessions.state.answer.set(['printing'])
	phone.state.answer.set('0912 345 678')
}

describe('survey response', () => {
	it('has one outcome per question, in document order, with the four fixed members', () => {
		const { root } = setup()
		expect(valueOf(root.properties.response.get()))
			.toEqual({
				language: 'en',
				answers: {
					mode: { visible: true, required: true, value: null, errors: [{ code: 'required', message: 'This question is required.' }] },
					guests: { visible: false, required: true, value: null, errors: [] },
					sessions: { visible: true, required: true, value: null, errors: [{ code: 'required', message: 'This question is required.' }] },
					phone: { visible: true, required: false, value: null, errors: [] },
				},
			})
		expect(Object.keys(valueOf(root.properties.response.get()).answers))
			.toEqual(['mode', 'guests', 'sessions', 'phone'])
	})

	it('follows the answers, and a hidden question reports value null and no errors but still its required rule', () => {
		const s = setup()
		fillOnsite(s)
		expect(valueOf(s.root.properties.response.get()).answers)
			.toEqual({
				mode: { visible: true, required: true, value: 'onsite', errors: [] },
				guests: { visible: true, required: true, value: 2, errors: [] },
				sessions: { visible: true, required: true, value: ['printing'], errors: [] },
				phone: { visible: true, required: true, value: '0912 345 678', errors: [] },
			})
		s.mode.state.answer.set('online')
		expect(valueOf(s.root.properties.response.get()).answers.guests)
			.toEqual({ visible: false, required: true, value: null, errors: [] })
	})

	it('is in the survey language, which only a configured language can set', () => {
		const { root } = setup()
		expect(valueOf(root.properties.text.get()))
			.toMatchObject({ title: 'Maker Space open day: sign-up', submit: 'Submit' })
		expect(root.state.language.set('zh-TW').ok)
			.toBe(true)
		expect(valueOf(root.properties.text.get()))
			.toMatchObject({ title: '創客空間開放日報名', submit: '送出' })
		expect(valueOf(root.properties.response.get()).language)
			.toBe('zh-TW')
		expect(root.state.language.set('fr').ok)
			.toBe(false)
		expect(root.state.language.get())
			.toBe('zh-TW')
	})
})

describe('survey canSubmit', () => {
	it('is false while any visible question has errors and true when none has', () => {
		const s = setup()
		expect(valueOf(s.root.properties.canSubmit.get()))
			.toBe(false)
		fillOnsite(s)
		expect(valueOf(s.root.properties.canSubmit.get()))
			.toBe(true)
		s.guests.state.answer.set(9)
		expect(valueOf(s.root.properties.canSubmit.get()))
			.toBe(false)
	})

	it('ignores hidden questions even when they are required (Q3)', () => {
		const s = setup()
		s.mode.state.answer.set('online')
		s.sessions.state.answer.set(['printing'])
		expect(valueOf(s.guests.properties.required.get()))
			.toBe(true)
		expect(valueOf(s.root.properties.canSubmit.get()))
			.toBe(true)
	})
})

describe('survey submit()', () => {
	it('is blocked while there are errors: a Method failure in the survey language, nothing written, nothing emitted', () => {
		const s = setup()
		const blocked = s.root.methods.submit()
		expect(blocked.ok)
			.toBe(false)
		expect(blocked.ok ? null : blocked.failure.diagnostics)
			.toEqual([expect.objectContaining({
				code: 'invalid-method-result',
				reason: 'answer-errors',
				message: 'Some answers have errors. Fix them before submitting.',
			})])
		expect(s.root.state.submitted.get())
			.toBeNull()
		expect(s.submitted)
			.toEqual([])

		s.root.state.language.set('zh-TW')
		const blockedInChinese = s.root.methods.submit()
		expect(blockedInChinese.ok ? null : blockedInChinese.failure.diagnostics[0]!.message)
			.toBe('部分答案有錯誤，請修正後再送出。')
		expect(s.submitted)
			.toEqual([])
	})

	it('writes submitted and emits submitted once with the response', () => {
		const s = setup()
		fillOnsite(s)
		const result = s.root.methods.submit()
		expect(result.ok)
			.toBe(true)
		const response = valueOf(s.root.properties.response.get())
		expect(valueOf(result))
			.toEqual(response)
		expect(s.root.state.submitted.get())
			.toEqual(response)
		expect(s.submitted)
			.toEqual([response])
	})

	it('takes no arguments', () => {
		const s = setup()
		fillOnsite(s)
		expect((s.root.methods.submit as (...args: unknown[]) => { ok: boolean })('extra').ok)
			.toBe(false)
		expect(s.submitted)
			.toEqual([])
	})
})

describe('survey changedSinceSubmit', () => {
	it('is false before any submit, stays false right after, becomes true when a value changes and false again on revert', () => {
		const s = setup()
		const changed = () => valueOf(s.root.properties.changedSinceSubmit.get())
		fillOnsite(s)
		expect(changed())
			.toBe(false)
		s.root.methods.submit()
		expect(changed())
			.toBe(false)

		s.guests.state.answer.set(3)
		expect(changed())
			.toBe(true)
		s.guests.state.answer.set(2)
		expect(changed())
			.toBe(false)
	})

	it('ignores the language and the messages, and notices a value that appears or disappears', () => {
		const s = setup()
		fillOnsite(s)
		s.root.methods.submit()
		s.root.state.language.set('zh-TW')
		expect(valueOf(s.root.properties.changedSinceSubmit.get()))
			.toBe(false)

		s.phone.state.answer.set('')
		expect(valueOf(s.root.properties.changedSinceSubmit.get()))
			.toBe(true)
		s.phone.state.answer.set('0912 345 678')
		expect(valueOf(s.root.properties.changedSinceSubmit.get()))
			.toBe(false)

		// Hiding a question changes its effective value (null), so the snapshot has moved.
		s.mode.state.answer.set('online')
		expect(valueOf(s.root.properties.changedSinceSubmit.get()))
			.toBe(true)
	})

	it('returns to false after a second submit takes the changed answers as the new snapshot', () => {
		const s = setup()
		fillOnsite(s)
		s.root.methods.submit()
		s.guests.state.answer.set(3)
		expect(valueOf(s.root.properties.changedSinceSubmit.get()))
			.toBe(true)
		expect(s.root.methods.submit().ok)
			.toBe(true)
		expect(valueOf(s.root.properties.changedSinceSubmit.get()))
			.toBe(false)
		expect(s.root.state.submitted.get()!.answers.guests!.value)
			.toBe(3)
		expect(s.submitted)
			.toHaveLength(2)
	})

	it('a blocked submit leaves it false', () => {
		const s = setup()
		s.root.methods.submit()
		expect(valueOf(s.root.properties.changedSinceSubmit.get()))
			.toBe(false)
	})
})

describe('survey Method effects as the compiler reports them', () => {
	it('submit writes State and emits an Event, transitively; clear writes but does not emit', () => {
		const { runtime } = createSurveyRuntime()
		const inspection = inspectBlueprint(runtime.blueprint)
		const methodsOf = (id: string) => {
			const node = inspection.nodes.find(candidate => candidate.resolved && candidate.node.id === id)
			if (node === undefined || !node.resolved)
				throw new Error(`no resolved node ${id}`)
			return node.methods
		}
		expect(methodsOf('open-day')
			.find(method => method.name === 'submit'))
			.toMatchObject({ transitivelyWrites: true, transitivelyEmits: true })
		expect(methodsOf('guests')
			.find(method => method.name === 'clear'))
			.toMatchObject({ transitivelyWrites: true, transitivelyEmits: false })
	})
})
