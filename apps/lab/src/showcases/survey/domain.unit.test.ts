import type { AnswerValue, Condition, LeafCondition, SurveyResponse } from './domain'
import { describe, expect, it } from 'vitest'
import {
	ANSWER_OPS,
	BUILTIN_ERROR_CODES,
	builtinError,
	conditionLeaves,
	conditionTargets,
	EQUALITY_OPS,
	evaluateCondition,
	formatConfigPath,
	isAnswerErrors,
	isAnswerValue,
	isPlainObject,
	isQuestionType,
	isSurveyResponse,
	MEMBERSHIP_OPS,
	ORDER_OPS,
	pickText,
	QUESTION_TYPES,
	ruleErrors,
	sameAnswerValue,
	sameAnswerValues,
	SUPPORTED_LANGUAGES,
	surveyText,
} from './domain'

const reader = (answers: Readonly<Record<string, AnswerValue>>) => (id: string): AnswerValue => answers[id] ?? null

function leaf(op: LeafCondition['op'], value?: string | number): Condition {
	return (value === undefined ? { question: 'q', op } : { question: 'q', op, value }) as Condition
}

describe('constants', () => {
	it('lists the supported languages and question types', () => {
		expect(SUPPORTED_LANGUAGES)
			.toEqual(['en', 'zh-TW'])
		expect(QUESTION_TYPES)
			.toEqual(['ShortAnswer', 'SingleChoice', 'MultipleChoice', 'Numeric'])
		expect(isQuestionType('Numeric'))
			.toBe(true)
		expect(isQuestionType('Survey'))
			.toBe(false)
		expect(isQuestionType(1))
			.toBe(false)
	})

	it('groups the operators without overlap', () => {
		const all = [...ANSWER_OPS, ...EQUALITY_OPS, ...ORDER_OPS, ...MEMBERSHIP_OPS]
		expect(all)
			.toEqual(['answered', 'unanswered', 'equals', 'notEquals', 'greaterThan', 'lessThan', 'includes', 'excludes'])
		expect(new Set(all).size)
			.toBe(all.length)
	})
})

describe('guards', () => {
	it('isPlainObject accepts JSON objects only', () => {
		expect(isPlainObject({}))
			.toBe(true)
		expect(isPlainObject(Object.create(null)))
			.toBe(true)
		expect(isPlainObject([]))
			.toBe(false)
		expect(isPlainObject(null))
			.toBe(false)
		expect(isPlainObject(new Date()))
			.toBe(false)
		expect(isPlainObject('x'))
			.toBe(false)
	})

	it('isAnswerValue accepts null, strings, finite numbers and string arrays', () => {
		for (const value of [null, '', 'a', 0, -1.5, [], ['a', 'b']]) {
			expect(isAnswerValue(value), JSON.stringify(value))
				.toBe(true)
		}
		for (const value of [undefined, Number.NaN, Number.POSITIVE_INFINITY, true, {}, [1], ['a', null]]) {
			expect(isAnswerValue(value), String(value))
				.toBe(false)
		}
	})

	it('isAnswerErrors accepts { code, message, rule? } lists', () => {
		expect(isAnswerErrors([]))
			.toBe(true)
		expect(isAnswerErrors([{ code: 'required', message: 'm' }, { code: 'rule', message: 'm', rule: 0 }]))
			.toBe(true)
		expect(isAnswerErrors([{ code: 'required' }]))
			.toBe(false)
		expect(isAnswerErrors([{ code: 'rule', message: 'm', rule: 1.5 }]))
			.toBe(false)
		expect(isAnswerErrors('x'))
			.toBe(false)
	})

	it('isSurveyResponse checks every outcome', () => {
		const response: SurveyResponse = {
			language: 'en',
			answers: { mode: { visible: true, required: true, value: 'onsite', errors: [] } },
		}
		expect(isSurveyResponse(response))
			.toBe(true)
		expect(isSurveyResponse({ language: 'en', answers: {} }))
			.toBe(true)
		expect(isSurveyResponse({ ...response, language: 1 }))
			.toBe(false)
		expect(isSurveyResponse({ language: 'en', answers: { mode: { visible: true, required: true, value: {}, errors: [] } } }))
			.toBe(false)
		expect(isSurveyResponse({ language: 'en', answers: { mode: { visible: 'yes', required: true, value: null, errors: [] } } }))
			.toBe(false)
		expect(isSurveyResponse(null))
			.toBe(false)
	})
})

describe('evaluateCondition truth table', () => {
	// Rows: [condition, answer, expected]. `null` is a hidden or unanswered question.
	const rows: readonly (readonly [Condition, AnswerValue, boolean])[] = [
		[leaf('answered'), null, false],
		[leaf('answered'), '', true],
		[leaf('answered'), 'a', true],
		[leaf('answered'), 0, true],
		[leaf('answered'), [], true],
		[leaf('unanswered'), null, true],
		[leaf('unanswered'), '', false],
		[leaf('unanswered'), 'a', false],
		[leaf('unanswered'), 0, false],
		[leaf('equals', 'a'), 'a', true],
		[leaf('equals', 'a'), 'b', false],
		[leaf('equals', 'a'), null, false],
		[leaf('equals', 'a'), ['a'], false],
		[leaf('equals', 2), 2, true],
		[leaf('equals', 2), 3, false],
		[leaf('equals', 2), '2', false],
		[leaf('equals', 2), null, false],
		[leaf('equals', 0), 0, true],
		[leaf('notEquals', 'a'), 'a', false],
		[leaf('notEquals', 'a'), 'b', true],
		[leaf('notEquals', 'a'), null, true],
		[leaf('notEquals', 'a'), ['a'], true],
		[leaf('notEquals', 2), 2, false],
		[leaf('notEquals', 2), 3, true],
		[leaf('notEquals', 2), null, true],
		[leaf('greaterThan', 2), 3, true],
		[leaf('greaterThan', 2), 2, false],
		[leaf('greaterThan', 2), 1, false],
		[leaf('greaterThan', 2), null, false],
		[leaf('greaterThan', 2), '3', false],
		[leaf('greaterThan', 0), 0, false],
		[leaf('lessThan', 2), 1, true],
		[leaf('lessThan', 2), 2, false],
		[leaf('lessThan', 2), 3, false],
		[leaf('lessThan', 2), null, false],
		[leaf('lessThan', 2), '1', false],
		[leaf('includes', 'a'), ['a', 'b'], true],
		[leaf('includes', 'c'), ['a', 'b'], false],
		[leaf('includes', 'a'), [], false],
		[leaf('includes', 'a'), null, false],
		[leaf('includes', 'a'), 'a', false],
		[leaf('excludes', 'a'), ['a', 'b'], false],
		[leaf('excludes', 'c'), ['a', 'b'], true],
		[leaf('excludes', 'a'), [], true],
		[leaf('excludes', 'a'), null, true],
		[leaf('excludes', 'a'), 'a', true],
	]

	it.each(rows)('%j on %j is %s', (condition, answer, expected) => {
		expect(evaluateCondition(condition, reader({ q: answer })))
			.toBe(expected)
	})

	it('reads an unknown question as null', () => {
		expect(evaluateCondition({ question: 'missing', op: 'unanswered' }, reader({})))
			.toBe(true)
		expect(evaluateCondition({ question: 'missing', op: 'answered' }, reader({})))
			.toBe(false)
	})

	it('combines with all, any and not', () => {
		const a: Condition = { question: 'a', op: 'equals', value: 'x' }
		const b: Condition = { question: 'b', op: 'greaterThan', value: 1 }
		expect(evaluateCondition({ all: [a, b] }, reader({ a: 'x', b: 2 })))
			.toBe(true)
		expect(evaluateCondition({ all: [a, b] }, reader({ a: 'x', b: 1 })))
			.toBe(false)
		expect(evaluateCondition({ any: [a, b] }, reader({ a: 'y', b: 2 })))
			.toBe(true)
		expect(evaluateCondition({ any: [a, b] }, reader({ a: 'y', b: 1 })))
			.toBe(false)
		expect(evaluateCondition({ not: a }, reader({ a: 'y' })))
			.toBe(true)
		expect(evaluateCondition({ not: { all: [a, b] } }, reader({ a: 'x', b: 2 })))
			.toBe(false)
	})

	it('treats a hidden (null) answer inside combinators like an unanswered one', () => {
		const hidden = reader({ mode: null, guests: null })
		expect(evaluateCondition({ all: [{ question: 'mode', op: 'equals', value: 'onsite' }, { question: 'guests', op: 'greaterThan', value: 0 }] }, hidden))
			.toBe(false)
		expect(evaluateCondition({ any: [{ question: 'mode', op: 'unanswered' }, { question: 'guests', op: 'answered' }] }, hidden))
			.toBe(true)
		expect(evaluateCondition({ not: { question: 'mode', op: 'equals', value: 'onsite' } }, hidden))
			.toBe(true)
	})
})

describe('conditionTargets', () => {
	it('returns nothing for null', () => {
		expect([...conditionTargets(null)])
			.toEqual([])
	})

	it('lists distinct question ids in first-use order across combinators', () => {
		const condition: Condition = {
			all: [
				{ question: 'b', op: 'answered' },
				{ any: [{ question: 'a', op: 'equals', value: 1 }, { question: 'b', op: 'unanswered' }] },
				{ not: { all: [{ question: 'c', op: 'includes', value: 'x' }, { question: 'a', op: 'answered' }] } },
			],
		}
		expect([...conditionTargets(condition)])
			.toEqual(['b', 'a', 'c'])
	})

	it('accumulates into a supplied set', () => {
		const into = new Set(['z'])
		const result = conditionTargets({ question: 'a', op: 'answered' }, into)
		expect(result)
			.toBe(into)
		expect([...result])
			.toEqual(['z', 'a'])
	})
})

describe('conditionLeaves', () => {
	it('returns the leaf at the given path for a leaf condition', () => {
		const condition: Condition = { question: 'mode', op: 'equals', value: 'onsite' }
		expect(conditionLeaves(condition, ['visibleWhen']))
			.toEqual([{ path: ['visibleWhen'], leaf: condition }])
	})

	it('walks all, any and not in document order with full paths', () => {
		const first: LeafCondition = { question: 'a', op: 'answered' }
		const second: LeafCondition = { question: 'b', op: 'equals', value: 'x' }
		const third: LeafCondition = { question: 'c', op: 'lessThan', value: 3 }
		const condition: Condition = { all: [first, { any: [second, { not: third }] }] }
		expect(conditionLeaves(condition, ['options', 2, 'visibleWhen']))
			.toEqual([
				{ path: ['options', 2, 'visibleWhen', 'all', 0], leaf: first },
				{ path: ['options', 2, 'visibleWhen', 'all', 1, 'any', 0], leaf: second },
				{ path: ['options', 2, 'visibleWhen', 'all', 1, 'any', 1, 'not'], leaf: third },
			])
	})

	it('keeps duplicate questions as separate leaves', () => {
		const condition: Condition = { any: [{ question: 'a', op: 'answered' }, { question: 'a', op: 'unanswered' }] }
		expect(conditionLeaves(condition, ['required'])
			.map(item => item.path))
			.toEqual([['required', 'any', 0], ['required', 'any', 1]])
	})
})

describe('formatConfigPath', () => {
	it('renders keys with dots and indexes with brackets', () => {
		expect(formatConfigPath([]))
			.toBe('')
		expect(formatConfigPath(['label']))
			.toBe('label')
		expect(formatConfigPath(['options', 2, 'label', 'zh-TW']))
			.toBe('options[2].label.zh-TW')
		expect(formatConfigPath(['rules', 0, 'when', 'all', 1]))
			.toBe('rules[0].when.all[1]')
	})
})

describe('pickText', () => {
	it('reads the language', () => {
		const text = { 'en': 'Hello', 'zh-TW': '哈囉' }
		expect(pickText(text, 'en'))
			.toBe('Hello')
		expect(pickText(text, 'zh-TW'))
			.toBe('哈囉')
	})

	it('returns an empty string without falling back to another language', () => {
		expect(pickText({ en: 'Hello' }, 'zh-TW'))
			.toBe('')
	})

	it('never reads inherited members', () => {
		expect(pickText({ en: 'Hello' }, 'constructor'))
			.toBe('')
		expect(pickText({ en: 'Hello' }, 'toString'))
			.toBe('')
	})
})

describe('built-in messages', () => {
	it('has a message for every code in both languages', () => {
		for (const language of SUPPORTED_LANGUAGES) {
			for (const code of BUILTIN_ERROR_CODES) {
				const error = builtinError(code, language, { min: 1, max: 2 })
				expect(error.code)
					.toBe(code)
				expect(error.message.length, `${language}/${code}`)
					.toBeGreaterThan(0)
				expect(error.message, `${language}/${code}`).not.toMatch(/\{\w+\}/)
			}
		}
	})

	it('produces the exact English messages', () => {
		expect(builtinError('required', 'en'))
			.toEqual({ code: 'required', message: 'This question is required.' })
		expect(builtinError('min', 'en', { min: 0 }))
			.toEqual({ code: 'min', message: 'Must be at least 0.' })
		expect(builtinError('max', 'en', { max: 3 }))
			.toEqual({ code: 'max', message: 'Must be at most 3.' })
		expect(builtinError('integer', 'en'))
			.toEqual({ code: 'integer', message: 'Must be a whole number.' })
		expect(builtinError('max-length', 'en', { max: 20 }))
			.toEqual({ code: 'max-length', message: 'Must be at most 20 characters.' })
		expect(builtinError('min-selected', 'en', { min: 1 }))
			.toEqual({ code: 'min-selected', message: 'Select at least 1.' })
		expect(builtinError('max-selected', 'en', { max: 2 }))
			.toEqual({ code: 'max-selected', message: 'Select at most 2.' })
		expect(builtinError('invalid-option', 'en'))
			.toEqual({ code: 'invalid-option', message: 'The selected option is not available.' })
	})

	it('produces the exact zh-TW messages', () => {
		expect(builtinError('required', 'zh-TW'))
			.toEqual({ code: 'required', message: '此題為必填。' })
		expect(builtinError('min', 'zh-TW', { min: 0 }))
			.toEqual({ code: 'min', message: '不可小於 0。' })
		expect(builtinError('max', 'zh-TW', { max: 3 }))
			.toEqual({ code: 'max', message: '不可大於 3。' })
		expect(builtinError('integer', 'zh-TW'))
			.toEqual({ code: 'integer', message: '請輸入整數。' })
		expect(builtinError('max-length', 'zh-TW', { max: 20 }))
			.toEqual({ code: 'max-length', message: '最多 20 個字元。' })
		expect(builtinError('min-selected', 'zh-TW', { min: 1 }))
			.toEqual({ code: 'min-selected', message: '至少選擇 1 項。' })
		expect(builtinError('max-selected', 'zh-TW', { max: 2 }))
			.toEqual({ code: 'max-selected', message: '最多選擇 2 項。' })
		expect(builtinError('invalid-option', 'zh-TW'))
			.toEqual({ code: 'invalid-option', message: '所選的選項目前無法使用。' })
	})

	it('keeps a placeholder whose parameter is missing, and falls back to English for an unknown language', () => {
		expect(builtinError('min', 'en').message)
			.toBe('Must be at least {min}.')
		expect(builtinError('required', 'fr').message)
			.toBe('This question is required.')
	})
})

describe('ruleErrors', () => {
	const rules = [
		{ when: { question: 'a', op: 'greaterThan', value: 2 } as Condition, message: { 'en': 'Too many.', 'zh-TW': '太多了。' } },
		{ when: { question: 'b', op: 'answered' } as Condition, message: { 'en': 'B is set.', 'zh-TW': 'B 已填。' } },
		{ when: { question: 'a', op: 'greaterThan', value: 0 } as Condition, message: { 'en': 'Some.', 'zh-TW': '有一些。' } },
	]

	it('reports one error per holding rule, in rule order, with the rule index', () => {
		expect(ruleErrors(rules, reader({ a: 3, b: 'x' }), 'en'))
			.toEqual([
				{ code: 'rule', message: 'Too many.', rule: 0 },
				{ code: 'rule', message: 'B is set.', rule: 1 },
				{ code: 'rule', message: 'Some.', rule: 2 },
			])
		expect(ruleErrors(rules, reader({ a: 1 }), 'zh-TW'))
			.toEqual([{ code: 'rule', message: '有一些。', rule: 2 }])
	})

	it('reports nothing when no rule holds, including for hidden (null) answers', () => {
		expect(ruleErrors(rules, reader({ a: 0 }), 'en'))
			.toEqual([])
		expect(ruleErrors(rules, reader({ a: null, b: null }), 'en'))
			.toEqual([])
		expect(ruleErrors([], reader({}), 'en'))
			.toEqual([])
	})
})

describe('surveyText', () => {
	const config = { title: { 'en': 'Open day', 'zh-TW': '開放日' }, languages: ['en', 'zh-TW'] }

	it('returns the English chrome', () => {
		expect(surveyText(config, 'en'))
			.toEqual({
				title: 'Open day',
				submit: 'Submit',
				submitted: 'Submitted',
				changedSinceSubmit: 'Answers changed since you submitted',
				blocked: 'Some answers have errors. Fix them before submitting.',
				languages: [{ code: 'en', name: 'English' }, { code: 'zh-TW', name: '繁體中文' }],
			})
	})

	it('returns the zh-TW chrome with the same endonyms', () => {
		expect(surveyText(config, 'zh-TW'))
			.toEqual({
				title: '開放日',
				submit: '送出',
				submitted: '已送出',
				changedSinceSubmit: '送出後答案已變更',
				blocked: '部分答案有錯誤，請修正後再送出。',
				languages: [{ code: 'en', name: 'English' }, { code: 'zh-TW', name: '繁體中文' }],
			})
	})

	it('lists only the survey languages, in order, and names an uncovered code by itself', () => {
		expect(surveyText({ title: { en: 'T' }, languages: ['zh-TW'] }, 'en').languages)
			.toEqual([{ code: 'zh-TW', name: '繁體中文' }])
		expect(surveyText({ title: { en: 'T' }, languages: ['fr'] }, 'en').languages)
			.toEqual([{ code: 'fr', name: 'fr' }])
	})
})

describe('sameAnswerValue', () => {
	it('compares scalars strictly and arrays by element in order', () => {
		expect(sameAnswerValue(null, null))
			.toBe(true)
		expect(sameAnswerValue('a', 'a'))
			.toBe(true)
		expect(sameAnswerValue(1, 1))
			.toBe(true)
		expect(sameAnswerValue(1, '1'))
			.toBe(false)
		expect(sameAnswerValue(null, 0))
			.toBe(false)
		expect(sameAnswerValue(['a', 'b'], ['a', 'b']))
			.toBe(true)
		expect(sameAnswerValue(['a', 'b'], ['b', 'a']))
			.toBe(false)
		expect(sameAnswerValue(['a'], ['a', 'b']))
			.toBe(false)
		expect(sameAnswerValue([], []))
			.toBe(true)
		expect(sameAnswerValue([], null))
			.toBe(false)
		expect(sameAnswerValue(['a'], 'a'))
			.toBe(false)
	})
})

describe('sameAnswerValues', () => {
	const outcome = (value: AnswerValue, extra: { visible?: boolean, required?: boolean, errors?: { code: string, message: string }[] } = {}) => ({
		visible: extra.visible ?? true,
		required: extra.required ?? false,
		value,
		errors: extra.errors ?? [],
	})
	const base: SurveyResponse = {
		language: 'en',
		answers: { mode: outcome('onsite'), guests: outcome(2), sessions: outcome(['printing', 'laser']), phone: outcome(null) },
	}

	it('is true for identical values', () => {
		expect(sameAnswerValues(base, structuredClone(base)))
			.toBe(true)
	})

	it('ignores language, visibility, requiredness and messages', () => {
		const other: SurveyResponse = {
			language: 'zh-TW',
			answers: {
				mode: outcome('onsite', { visible: false, required: true }),
				guests: outcome(2, { errors: [{ code: 'max', message: '不可大於 3。' }] }),
				sessions: outcome(['printing', 'laser']),
				phone: outcome(null),
			},
		}
		expect(sameAnswerValues(base, other))
			.toBe(true)
	})

	it('detects a changed scalar, a changed array and a value that became null', () => {
		expect(sameAnswerValues(base, { ...base, answers: { ...base.answers, guests: outcome(3) } }))
			.toBe(false)
		expect(sameAnswerValues(base, { ...base, answers: { ...base.answers, sessions: outcome(['printing']) } }))
			.toBe(false)
		expect(sameAnswerValues(base, { ...base, answers: { ...base.answers, mode: outcome(null) } }))
			.toBe(false)
	})

	it('treats a question present in only one response as a difference', () => {
		const { phone: _phone, ...withoutPhone } = base.answers
		expect(sameAnswerValues(base, { ...base, answers: withoutPhone }))
			.toBe(false)
		expect(sameAnswerValues({ ...base, answers: withoutPhone }, base))
			.toBe(false)
		expect(sameAnswerValues({ language: 'en', answers: { a: outcome(null) } }, { language: 'en', answers: { b: outcome(null) } }))
			.toBe(false)
	})
})
