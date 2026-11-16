import type { ConfigChecker, ConfigDiagnostic, MultipleChoiceConfig, MultipleChoiceRawConfig, NumericConfig, NumericRawConfig, ShortAnswerConfig, ShortAnswerRawConfig, SingleChoiceConfig, SingleChoiceRawConfig, SurveyConfig, SurveyRawConfig } from './config'
import { createWidgetPlugin, createWidgetSystem } from '@deviltea/widget-core'
import { describe, expect, it } from 'vitest'
import {
	checkMultipleChoiceConfig,
	checkNumericConfig,
	checkShortAnswerConfig,
	checkSingleChoiceConfig,
	checkSurveyConfig,
	isRecovered,
	MULTIPLE_CHOICE_CONFIG_KEYS,
	NUMERIC_CONFIG_KEYS,
	resolveMultipleChoiceConfig,
	resolveNumericConfig,
	resolveShortAnswerConfig,
	resolveSingleChoiceConfig,
	resolveSurveyConfig,
	SHORT_ANSWER_CONFIG_KEYS,
	SINGLE_CHOICE_CONFIG_KEYS,
	SURVEY_CONFIG_KEYS,
	surveyLanguagesOf,
} from './config'

/** What a checker reports, reduced to what the tests assert: path and reason. */
function run(checker: ConfigChecker, input: unknown): ConfigDiagnostic[] {
	const diagnostics: ConfigDiagnostic[] = []
	checker(input, diagnostic => diagnostics.push(diagnostic))
	return diagnostics
}

function locations(checker: ConfigChecker, input: unknown): { path: readonly (string | number)[] | undefined, reason: string | undefined }[] {
	return run(checker, input)
		.map(({ path, reason }) => ({ path, reason }))
}

const label = { 'en': 'Question', 'zh-TW': '問題' }
const option = (value: string, extra: object = {}) => ({ value, label: { 'en': value, 'zh-TW': value }, ...extra })

describe('valid configs pass', () => {
	it('shortAnswer', () => {
		expect(run(checkShortAnswerConfig, { label }))
			.toEqual([])
		expect(run(checkShortAnswerConfig, {
			label,
			help: label,
			required: { question: 'mode', op: 'equals', value: 'onsite' },
			visibleWhen: { not: { question: 'mode', op: 'unanswered' } },
			maxLength: 20,
			rules: [{ when: { question: 'mode', op: 'answered' }, message: label }],
		}))
			.toEqual([])
	})

	it('singleChoice', () => {
		expect(run(checkSingleChoiceConfig, { label, required: true, options: [option('a'), option('b', { visibleWhen: { question: 'x', op: 'greaterThan', value: 0 }, enabledWhen: { question: 'x', op: 'equals', value: 1 } })] }))
			.toEqual([])
	})

	it('multipleChoice', () => {
		expect(run(checkMultipleChoiceConfig, { label, options: [option('a'), option('b'), option('c')], minSelected: 1, maxSelected: 2 }))
			.toEqual([])
		expect(run(checkMultipleChoiceConfig, { label, options: [option('a')], minSelected: 0, maxSelected: 1 }))
			.toEqual([])
	})

	it('numeric', () => {
		expect(run(checkNumericConfig, { label, min: 0, max: 3, integer: true }))
			.toEqual([])
		expect(run(checkNumericConfig, { label, min: 2, max: 2 }))
			.toEqual([])
		expect(run(checkNumericConfig, { label, min: -1.5 }))
			.toEqual([])
	})

	it('survey', () => {
		expect(run(checkSurveyConfig, { title: label, languages: ['en', 'zh-TW'] }))
			.toEqual([])
		expect(run(checkSurveyConfig, { title: { en: 'Only English' }, languages: ['en'] }))
			.toEqual([])
	})
})

describe('config shape', () => {
	it.each([
		['ShortAnswer', checkShortAnswerConfig],
		['SingleChoice', checkSingleChoiceConfig],
		['MultipleChoice', checkMultipleChoiceConfig],
		['Numeric', checkNumericConfig],
		['Survey', checkSurveyConfig],
	] as const)('%s rejects a non-object at the root path', (_type, checker) => {
		for (const input of [null, undefined, 'x', 1, [], true]) {
			expect(locations(checker, input), String(input))
				.toEqual([{ path: [], reason: 'not-an-object' }])
		}
	})

	it('rejects unknown keys at [key] with reason unknown-key', () => {
		expect(locations(checkNumericConfig, { label, visibleIf: { question: 'a', op: 'answered' } }))
			.toEqual([{ path: ['visibleIf'], reason: 'unknown-key' }])
		expect(locations(checkShortAnswerConfig, { label, min: 1 }))
			.toEqual([{ path: ['min'], reason: 'unknown-key' }])
		expect(locations(checkSingleChoiceConfig, { label, options: [option('a')], maxSelected: 1 }))
			.toEqual([{ path: ['maxSelected'], reason: 'unknown-key' }])
		expect(locations(checkMultipleChoiceConfig, { label, options: [option('a')], minSelect: 1 }))
			.toEqual([{ path: ['minSelect'], reason: 'unknown-key' }])
		expect(locations(checkSurveyConfig, { title: label, languages: ['en'], theme: 'dark' }))
			.toEqual([{ path: ['theme'], reason: 'unknown-key' }])
	})

	it('names the allowed keys in an unknown-key message', () => {
		const [diagnostic] = run(checkNumericConfig, { label, visibleIf: 1 })
		expect(diagnostic!.message)
			.toContain('"visibleIf"')
		expect(diagnostic!.message)
			.toContain('visibleWhen')
	})

	it('requires label (every question), options (choices), title and languages (Survey)', () => {
		expect(locations(checkNumericConfig, {}))
			.toEqual([{ path: ['label'], reason: 'missing-key' }])
		expect(locations(checkShortAnswerConfig, {}))
			.toEqual([{ path: ['label'], reason: 'missing-key' }])
		expect(locations(checkSingleChoiceConfig, { label }))
			.toEqual([{ path: ['options'], reason: 'missing-key' }])
		expect(locations(checkMultipleChoiceConfig, {}))
			.toEqual([{ path: ['label'], reason: 'missing-key' }, { path: ['options'], reason: 'missing-key' }])
		expect(locations(checkSurveyConfig, {}))
			.toEqual([{ path: ['title'], reason: 'missing-key' }, { path: ['languages'], reason: 'missing-key' }])
	})

	it('puts the path in the message and the diagnostic', () => {
		const [diagnostic] = run(checkNumericConfig, { label, max: 'x' })
		expect(diagnostic)
			.toEqual({ message: 'max: must be a number.', path: ['max'], reason: 'invalid-type' })
	})
})

describe('i18nText', () => {
	it('rejects a non-object label at ["label"]', () => {
		expect(locations(checkNumericConfig, { label: 'Question' }))
			.toEqual([{ path: ['label'], reason: 'invalid-type' }])
		expect(locations(checkNumericConfig, { label: ['Question'] }))
			.toEqual([{ path: ['label'], reason: 'invalid-type' }])
	})

	it('rejects an empty label map at ["label"] with empty-text', () => {
		expect(locations(checkNumericConfig, { label: {} }))
			.toEqual([{ path: ['label'], reason: 'empty-text' }])
	})

	it('rejects a non-string or empty entry at [..., language]', () => {
		expect(locations(checkNumericConfig, { label: { 'en': 'Q', 'zh-TW': 1 } }))
			.toEqual([{ path: ['label', 'zh-TW'], reason: 'invalid-type' }])
		expect(locations(checkNumericConfig, { label: { 'en': '', 'zh-TW': '問題' } }))
			.toEqual([{ path: ['label', 'en'], reason: 'empty-text' }])
	})

	it('checks help the same way', () => {
		expect(locations(checkNumericConfig, { label, help: { en: 3 } }))
			.toEqual([{ path: ['help', 'en'], reason: 'invalid-type' }])
		expect(locations(checkNumericConfig, { label, help: 'x' }))
			.toEqual([{ path: ['help'], reason: 'invalid-type' }])
	})

	it('checks option labels and rule messages at their full path', () => {
		expect(locations(checkSingleChoiceConfig, { label, options: [option('a'), { value: 'b', label: { en: 'B', fr: 2 } }] }))
			.toEqual([{ path: ['options', 1, 'label', 'fr'], reason: 'invalid-type' }])
		expect(locations(checkNumericConfig, { label, rules: [{ when: { question: 'a', op: 'answered' }, message: {} }] }))
			.toEqual([{ path: ['rules', 0, 'message'], reason: 'empty-text' }])
	})
})

describe('conditions', () => {
	const cases: readonly (readonly [string, unknown, readonly (string | number)[], string])[] = [
		['a non-object', 'x', ['visibleWhen'], 'invalid-condition'],
		['an object with no discriminator', {}, ['visibleWhen'], 'invalid-condition'],
		['two discriminators', { question: 'a', op: 'answered', all: [] }, ['visibleWhen'], 'invalid-condition'],
		['an unknown operator', { question: 'a', op: 'contains', value: 'x' }, ['visibleWhen', 'op'], 'unknown-op'],
		['a missing operator', { question: 'a' }, ['visibleWhen', 'op'], 'missing-key'],
		['a non-string operator', { question: 'a', op: 1 }, ['visibleWhen', 'op'], 'unknown-op'],
		['an empty question id', { question: '', op: 'answered' }, ['visibleWhen', 'question'], 'invalid-type'],
		['a non-string question id', { question: 3, op: 'answered' }, ['visibleWhen', 'question'], 'invalid-type'],
		['a value on answered', { question: 'a', op: 'answered', value: 1 }, ['visibleWhen', 'value'], 'invalid-condition-value'],
		['a missing value on equals', { question: 'a', op: 'equals' }, ['visibleWhen', 'value'], 'invalid-condition-value'],
		['a boolean value on equals', { question: 'a', op: 'equals', value: true }, ['visibleWhen', 'value'], 'invalid-condition-value'],
		['a null value on notEquals', { question: 'a', op: 'notEquals', value: null }, ['visibleWhen', 'value'], 'invalid-condition-value'],
		['a string value on greaterThan', { question: 'a', op: 'greaterThan', value: '1' }, ['visibleWhen', 'value'], 'invalid-condition-value'],
		['a number value on includes', { question: 'a', op: 'includes', value: 1 }, ['visibleWhen', 'value'], 'invalid-condition-value'],
		['an unknown key on a leaf', { question: 'a', op: 'answered', extra: 1 }, ['visibleWhen', 'extra'], 'unknown-key'],
		['an unknown key on all', { all: [{ question: 'a', op: 'answered' }], extra: 1 }, ['visibleWhen', 'extra'], 'unknown-key'],
		['an empty all', { all: [] }, ['visibleWhen', 'all'], 'empty-condition-list'],
		['an empty any', { any: [] }, ['visibleWhen', 'any'], 'empty-condition-list'],
		['a non-array all', { all: { question: 'a', op: 'answered' } }, ['visibleWhen', 'all'], 'invalid-type'],
		['a non-condition not', { not: 3 }, ['visibleWhen', 'not'], 'invalid-condition'],
	]

	it.each(cases)('reports %s at the exact path', (_name, condition, path, reason) => {
		expect(locations(checkNumericConfig, { label, visibleWhen: condition }))
			.toEqual([{ path, reason }])
	})

	it('reports the nested path ["visibleWhen", "all", 1, "op"]', () => {
		expect(locations(checkNumericConfig, {
			label,
			visibleWhen: { all: [{ question: 'a', op: 'answered' }, { question: 'b', op: 'sometimes' }] },
		}))
			.toEqual([{ path: ['visibleWhen', 'all', 1, 'op'], reason: 'unknown-op' }])
	})

	it('reports through any and not, and every faulty leaf', () => {
		expect(locations(checkNumericConfig, {
			label,
			visibleWhen: { not: { any: [{ question: 'a', op: 'equals' }, { question: 'b', op: 'lessThan', value: 'x' }] } },
		}))
			.toEqual([
				{ path: ['visibleWhen', 'not', 'any', 0, 'value'], reason: 'invalid-condition-value' },
				{ path: ['visibleWhen', 'not', 'any', 1, 'value'], reason: 'invalid-condition-value' },
			])
	})

	it('accepts every operator with its value type', () => {
		const valid = [
			{ question: 'a', op: 'answered' },
			{ question: 'a', op: 'unanswered' },
			{ question: 'a', op: 'equals', value: 'x' },
			{ question: 'a', op: 'equals', value: 2 },
			{ question: 'a', op: 'notEquals', value: 'x' },
			{ question: 'a', op: 'greaterThan', value: 1 },
			{ question: 'a', op: 'lessThan', value: -1 },
			{ question: 'a', op: 'includes', value: 'x' },
			{ question: 'a', op: 'excludes', value: 'x' },
		]
		for (const condition of valid) {
			expect(run(checkNumericConfig, { label, visibleWhen: condition }), JSON.stringify(condition))
				.toEqual([])
		}
	})

	it('checks required as boolean or condition', () => {
		expect(run(checkNumericConfig, { label, required: true }))
			.toEqual([])
		expect(locations(checkNumericConfig, { label, required: 'yes' }))
			.toEqual([{ path: ['required'], reason: 'invalid-condition' }])
		expect(locations(checkNumericConfig, { label, required: { any: [{ question: 'a', op: 'equals', value: [] }] } }))
			.toEqual([{ path: ['required', 'any', 0, 'value'], reason: 'invalid-condition-value' }])
	})

	it('checks option conditions at ["options", i, field, ...]', () => {
		expect(locations(checkSingleChoiceConfig, {
			label,
			options: [option('a'), option('b', { enabledWhen: { question: 'x', op: 'greaterThan', value: 'no' } }), option('c', { visibleWhen: { all: [] } })],
		}))
			.toEqual([
				{ path: ['options', 1, 'enabledWhen', 'value'], reason: 'invalid-condition-value' },
				{ path: ['options', 2, 'visibleWhen', 'all'], reason: 'empty-condition-list' },
			])
	})
})

describe('rules', () => {
	it('requires an array', () => {
		expect(locations(checkNumericConfig, { label, rules: {} }))
			.toEqual([{ path: ['rules'], reason: 'invalid-type' }])
	})

	it('requires object rules with when and message and no other keys', () => {
		expect(locations(checkNumericConfig, { label, rules: ['x'] }))
			.toEqual([{ path: ['rules', 0], reason: 'not-an-object' }])
		expect(locations(checkNumericConfig, { label, rules: [{}] }))
			.toEqual([{ path: ['rules', 0, 'when'], reason: 'missing-key' }, { path: ['rules', 0, 'message'], reason: 'missing-key' }])
		expect(locations(checkNumericConfig, { label, rules: [{ when: { question: 'a', op: 'answered' }, message: label, level: 'warn' }] }))
			.toEqual([{ path: ['rules', 0, 'level'], reason: 'unknown-key' }])
	})

	it('locates a faulty condition inside a rule', () => {
		expect(locations(checkNumericConfig, {
			label,
			rules: [
				{ when: { question: 'a', op: 'answered' }, message: label },
				{ when: { all: [{ question: 'a', op: 'answered' }, { question: 'b', op: 'near', value: 1 }] }, message: label },
			],
		}))
			.toEqual([{ path: ['rules', 1, 'when', 'all', 1, 'op'], reason: 'unknown-op' }])
	})
})

describe('options', () => {
	it('rejects an empty or non-array options', () => {
		expect(locations(checkSingleChoiceConfig, { label, options: [] }))
			.toEqual([{ path: ['options'], reason: 'empty-options' }])
		expect(locations(checkMultipleChoiceConfig, { label, options: [] }))
			.toEqual([{ path: ['options'], reason: 'empty-options' }])
		expect(locations(checkSingleChoiceConfig, { label, options: 'a' }))
			.toEqual([{ path: ['options'], reason: 'invalid-type' }])
	})

	it('rejects a non-object option, unknown option keys and missing value or label', () => {
		expect(locations(checkSingleChoiceConfig, { label, options: [option('a'), 'b'] }))
			.toEqual([{ path: ['options', 1], reason: 'not-an-object' }])
		expect(locations(checkSingleChoiceConfig, { label, options: [option('a', { visibleIf: 1 })] }))
			.toEqual([{ path: ['options', 0, 'visibleIf'], reason: 'unknown-key' }])
		expect(locations(checkSingleChoiceConfig, { label, options: [{}] }))
			.toEqual([{ path: ['options', 0, 'value'], reason: 'missing-key' }, { path: ['options', 0, 'label'], reason: 'missing-key' }])
	})

	it('rejects a non-string or empty option value at ["options", i, "value"]', () => {
		expect(locations(checkSingleChoiceConfig, { label, options: [option('a'), { value: 2, label }] }))
			.toEqual([{ path: ['options', 1, 'value'], reason: 'invalid-type' }])
		expect(locations(checkSingleChoiceConfig, { label, options: [{ value: '', label }] }))
			.toEqual([{ path: ['options', 0, 'value'], reason: 'invalid-type' }])
	})

	it('rejects a duplicate option value at the later option', () => {
		expect(locations(checkSingleChoiceConfig, { label, options: [option('a'), option('b'), option('a')] }))
			.toEqual([{ path: ['options', 2, 'value'], reason: 'duplicate-option-value' }])
		expect(locations(checkMultipleChoiceConfig, { label, options: [option('a'), option('a'), option('a')] }))
			.toEqual([{ path: ['options', 1, 'value'], reason: 'duplicate-option-value' }, { path: ['options', 2, 'value'], reason: 'duplicate-option-value' }])
	})
})

describe('numeric', () => {
	it('rejects min greater than max at ["max"]', () => {
		expect(locations(checkNumericConfig, { label, min: 3, max: 2 }))
			.toEqual([{ path: ['max'], reason: 'min-greater-than-max' }])
	})

	it('rejects non-number min and max at their own path and skips the comparison', () => {
		expect(locations(checkNumericConfig, { label, min: '1', max: 0 }))
			.toEqual([{ path: ['min'], reason: 'invalid-type' }])
		expect(locations(checkNumericConfig, { label, min: 1, max: Number.NaN }))
			.toEqual([{ path: ['max'], reason: 'invalid-type' }])
	})

	it('rejects a non-boolean integer at ["integer"]', () => {
		expect(locations(checkNumericConfig, { label, integer: 1 }))
			.toEqual([{ path: ['integer'], reason: 'invalid-type' }])
	})
})

describe('shortAnswer', () => {
	it('requires maxLength to be a positive integer', () => {
		expect(locations(checkShortAnswerConfig, { label, maxLength: 0 }))
			.toEqual([{ path: ['maxLength'], reason: 'out-of-range' }])
		expect(locations(checkShortAnswerConfig, { label, maxLength: 2.5 }))
			.toEqual([{ path: ['maxLength'], reason: 'out-of-range' }])
		expect(locations(checkShortAnswerConfig, { label, maxLength: -3 }))
			.toEqual([{ path: ['maxLength'], reason: 'out-of-range' }])
		expect(locations(checkShortAnswerConfig, { label, maxLength: '20' }))
			.toEqual([{ path: ['maxLength'], reason: 'invalid-type' }])
		expect(run(checkShortAnswerConfig, { label, maxLength: 1 }))
			.toEqual([])
	})
})

describe('multipleChoice', () => {
	const options = [option('a'), option('b'), option('c')]

	it('requires integer selection counts', () => {
		expect(locations(checkMultipleChoiceConfig, { label, options, minSelected: -1 }))
			.toEqual([{ path: ['minSelected'], reason: 'out-of-range' }])
		expect(locations(checkMultipleChoiceConfig, { label, options, minSelected: 1.5 }))
			.toEqual([{ path: ['minSelected'], reason: 'out-of-range' }])
		expect(locations(checkMultipleChoiceConfig, { label, options, maxSelected: 0 }))
			.toEqual([{ path: ['maxSelected'], reason: 'out-of-range' }])
		expect(locations(checkMultipleChoiceConfig, { label, options, maxSelected: 'two' }))
			.toEqual([{ path: ['maxSelected'], reason: 'invalid-type' }])
	})

	it('rejects minSelected greater than maxSelected at ["maxSelected"]', () => {
		expect(locations(checkMultipleChoiceConfig, { label, options, minSelected: 3, maxSelected: 2 }))
			.toEqual([{ path: ['maxSelected'], reason: 'min-greater-than-max' }])
	})

	it('rejects counts above the number of options', () => {
		expect(locations(checkMultipleChoiceConfig, { label, options, maxSelected: 4 }))
			.toEqual([{ path: ['maxSelected'], reason: 'exceeds-options' }])
		expect(locations(checkMultipleChoiceConfig, { label, options, minSelected: 4 }))
			.toEqual([{ path: ['minSelected'], reason: 'exceeds-options' }])
		expect(run(checkMultipleChoiceConfig, { label, options, minSelected: 3, maxSelected: 3 }))
			.toEqual([])
	})

	it('does not compare counts with options that are missing or empty', () => {
		expect(locations(checkMultipleChoiceConfig, { label, options: [], maxSelected: 5 }))
			.toEqual([{ path: ['options'], reason: 'empty-options' }])
		expect(locations(checkMultipleChoiceConfig, { label, maxSelected: 5 }))
			.toEqual([{ path: ['options'], reason: 'missing-key' }])
	})
})

describe('survey', () => {
	it('requires title to be an I18nText', () => {
		expect(locations(checkSurveyConfig, { title: 'Open day', languages: ['en'] }))
			.toEqual([{ path: ['title'], reason: 'invalid-type' }])
		expect(locations(checkSurveyConfig, { title: {}, languages: ['en'] }))
			.toEqual([{ path: ['title'], reason: 'empty-text' }])
	})

	it('requires a non-empty languages array', () => {
		expect(locations(checkSurveyConfig, { title: label, languages: [] }))
			.toEqual([{ path: ['languages'], reason: 'empty-languages' }])
		expect(locations(checkSurveyConfig, { title: label, languages: 'en' }))
			.toEqual([{ path: ['languages'], reason: 'invalid-type' }])
	})

	it('rejects an unsupported language at ["languages", i]', () => {
		expect(locations(checkSurveyConfig, { title: label, languages: ['en', 'fr'] }))
			.toEqual([{ path: ['languages', 1], reason: 'unsupported-language' }])
		expect(locations(checkSurveyConfig, { title: label, languages: ['en', 'zh-CN'] }))
			.toEqual([{ path: ['languages', 1], reason: 'unsupported-language' }])
	})

	it('rejects a duplicate language at the later entry', () => {
		expect(locations(checkSurveyConfig, { title: label, languages: ['zh-TW', 'en', 'zh-TW'] }))
			.toEqual([{ path: ['languages', 2], reason: 'duplicate-language' }])
	})

	it('rejects a non-string language', () => {
		expect(locations(checkSurveyConfig, { title: label, languages: ['en', 1] }))
			.toEqual([{ path: ['languages', 1], reason: 'invalid-type' }])
	})

	it('requires the title to cover every survey language', () => {
		expect(locations(checkSurveyConfig, { title: { en: 'Open day' }, languages: ['en', 'zh-TW'] }))
			.toEqual([{ path: ['title', 'zh-TW'], reason: 'missing-translation' }])
	})

	it('does not report missing translations when the languages themselves are invalid', () => {
		expect(locations(checkSurveyConfig, { title: { en: 'Open day' }, languages: ['en', 'fr'] }))
			.toEqual([{ path: ['languages', 1], reason: 'unsupported-language' }])
	})
})

describe('resolve helpers', () => {
	it('resolve(null) returns the empty recovered config', () => {
		expect(resolveShortAnswerConfig(null))
			.toEqual({ label: {}, help: null, required: false, visibleWhen: null, rules: [], recovered: true, maxLength: null })
		expect(resolveSingleChoiceConfig(null))
			.toEqual({ label: {}, help: null, required: false, visibleWhen: null, rules: [], recovered: true, options: [] })
		expect(resolveMultipleChoiceConfig(null))
			.toEqual({ label: {}, help: null, required: false, visibleWhen: null, rules: [], recovered: true, options: [], minSelected: null, maxSelected: null })
		expect(resolveNumericConfig(null))
			.toEqual({ label: {}, help: null, required: false, visibleWhen: null, rules: [], recovered: true, min: null, max: null, integer: false })
		expect(resolveSurveyConfig(null))
			.toEqual({ title: {}, languages: [], recovered: true })
	})

	it('fills absent optional keys with null, false or empty and is not recovered', () => {
		expect(resolveNumericConfig({ label }))
			.toEqual({ label, help: null, required: false, visibleWhen: null, rules: [], recovered: false, min: null, max: null, integer: false })
		expect(resolveShortAnswerConfig({ label }))
			.toMatchObject({ maxLength: null, recovered: false })
		expect(resolveSingleChoiceConfig({ label, options: [option('a')] }))
			.toMatchObject({ options: [{ value: 'a', label: { 'en': 'a', 'zh-TW': 'a' }, visibleWhen: null, enabledWhen: null }], recovered: false })
	})

	it('keeps authored values', () => {
		const visibleWhen = { question: 'mode', op: 'equals', value: 'onsite' } as const
		const rules = [{ when: visibleWhen, message: label }]
		expect(resolveNumericConfig({ label, help: label, required: visibleWhen, visibleWhen, rules, min: 0, max: 3, integer: true }))
			.toEqual({ label, help: label, required: visibleWhen, visibleWhen, rules, recovered: false, min: 0, max: 3, integer: true })
		expect(resolveMultipleChoiceConfig({ label, options: [option('a', { visibleWhen, enabledWhen: visibleWhen })], minSelected: 1, maxSelected: 1 }))
			.toMatchObject({ options: [{ value: 'a', visibleWhen, enabledWhen: visibleWhen }], minSelected: 1, maxSelected: 1 })
		expect(resolveSurveyConfig({ title: label, languages: ['en', 'zh-TW'] }))
			.toEqual({ title: label, languages: ['en', 'zh-TW'], recovered: false })
	})
})

describe('isRecovered and surveyLanguagesOf', () => {
	it('isRecovered is true only for a node whose config is the recovered fallback', () => {
		expect(isRecovered({ resolved: true, config: resolveNumericConfig(null) }))
			.toBe(true)
		expect(isRecovered({ resolved: true, config: resolveNumericConfig({ label }) }))
			.toBe(false)
		expect(isRecovered({ resolved: false, id: 'x', type: 'Nope' }))
			.toBe(false)
		expect(isRecovered({ resolved: true, config: null }))
			.toBe(false)
		expect(isRecovered({ resolved: true, config: 'recovered' }))
			.toBe(false)
	})

	it('surveyLanguagesOf returns the languages of a resolved, non-recovered Survey only', () => {
		const survey = { resolved: true, type: 'Survey', config: resolveSurveyConfig({ title: label, languages: ['zh-TW', 'en'] }) }
		expect(surveyLanguagesOf(survey))
			.toEqual(['zh-TW', 'en'])
		expect(surveyLanguagesOf({ ...survey, config: resolveSurveyConfig(null) }))
			.toBeNull()
		expect(surveyLanguagesOf({ ...survey, type: 'Numeric' }))
			.toBeNull()
		expect(surveyLanguagesOf({ ...survey, resolved: false }))
			.toBeNull()
		expect(surveyLanguagesOf({ resolved: true, type: 'Survey' }))
			.toBeNull()
	})
})

describe('key lists', () => {
	it('list exactly the keys a checker accepts', () => {
		const accepted = (checker: ConfigChecker, keys: readonly string[], base: object = { label }) => keys.filter(key => !run(checker, { ...base, [key]: undefined })
			.some(d => d.reason === 'unknown-key'))
		expect(accepted(checkShortAnswerConfig, [...SHORT_ANSWER_CONFIG_KEYS, 'options', 'min', 'title']))
			.toEqual([...SHORT_ANSWER_CONFIG_KEYS])
		expect(accepted(checkSingleChoiceConfig, [...SINGLE_CHOICE_CONFIG_KEYS, 'maxLength', 'min', 'title']))
			.toEqual([...SINGLE_CHOICE_CONFIG_KEYS])
		expect(accepted(checkMultipleChoiceConfig, [...MULTIPLE_CHOICE_CONFIG_KEYS, 'maxLength', 'min', 'title']))
			.toEqual([...MULTIPLE_CHOICE_CONFIG_KEYS])
		expect(accepted(checkNumericConfig, [...NUMERIC_CONFIG_KEYS, 'options', 'maxLength', 'title']))
			.toEqual([...NUMERIC_CONFIG_KEYS])
		expect(accepted(checkSurveyConfig, [...SURVEY_CONFIG_KEYS, 'label', 'languagez'], {}))
			.toEqual([...SURVEY_CONFIG_KEYS])
	})
})

describe('integration with Core', () => {
	// Compiling these plugins is also the type-level check that the recursive `Condition` and the other
	// raw config types satisfy `.interfaces<>()`'s JSON-domain check (design risk R5).
	const Numeric = createWidgetPlugin('Numeric')
		.description('Numeric config fixture')
		.interfaces<{ config: { raw: NumericRawConfig, resolved: NumericConfig } }>()
		.config({
			description: 'Numeric config',
			validate: (input, ctx): input is NumericRawConfig => {
				checkNumericConfig(input, ctx.addDiagnostic)
				return !ctx.hasAnyDiagnostic()
			},
			resolve: resolveNumericConfig,
		})
		.done()
	const ShortAnswer = createWidgetPlugin('ShortAnswer')
		.description('ShortAnswer config fixture')
		.interfaces<{ config: { raw: ShortAnswerRawConfig, resolved: ShortAnswerConfig } }>()
		.config({
			description: 'ShortAnswer config',
			validate: (input, ctx): input is ShortAnswerRawConfig => {
				checkShortAnswerConfig(input, ctx.addDiagnostic)
				return !ctx.hasAnyDiagnostic()
			},
			resolve: resolveShortAnswerConfig,
		})
		.done()
	const SingleChoice = createWidgetPlugin('SingleChoice')
		.description('SingleChoice config fixture')
		.interfaces<{ config: { raw: SingleChoiceRawConfig, resolved: SingleChoiceConfig } }>()
		.config({
			description: 'SingleChoice config',
			validate: (input, ctx): input is SingleChoiceRawConfig => {
				checkSingleChoiceConfig(input, ctx.addDiagnostic)
				return !ctx.hasAnyDiagnostic()
			},
			resolve: resolveSingleChoiceConfig,
		})
		.done()
	const MultipleChoice = createWidgetPlugin('MultipleChoice')
		.description('MultipleChoice config fixture')
		.interfaces<{ config: { raw: MultipleChoiceRawConfig, resolved: MultipleChoiceConfig } }>()
		.config({
			description: 'MultipleChoice config',
			validate: (input, ctx): input is MultipleChoiceRawConfig => {
				checkMultipleChoiceConfig(input, ctx.addDiagnostic)
				return !ctx.hasAnyDiagnostic()
			},
			resolve: resolveMultipleChoiceConfig,
		})
		.done()
	const Survey = createWidgetPlugin('Survey')
		.description('Survey config fixture')
		.interfaces<{ config: { raw: SurveyRawConfig, resolved: SurveyConfig } }>()
		.config({
			description: 'Survey config',
			validate: (input, ctx): input is SurveyRawConfig => {
				checkSurveyConfig(input, ctx.addDiagnostic)
				return !ctx.hasAnyDiagnostic()
			},
			resolve: resolveSurveyConfig,
		})
		.done()
	const system = createWidgetSystem({ plugins: [Numeric, ShortAnswer, SingleChoice, MultipleChoice, Survey] as const })

	it('accepts the raw config types in `.interfaces<>()` and carries a checker diagnostic to Core with its path and reason', () => {
		const blueprint = system.createBlueprint({
			id: 'root',
			type: 'Numeric',
			config: { label, visibleWhen: { all: [{ question: 'a', op: 'answered' }, { question: 'b', op: 'sometimes' }] } },
		})
		expect(blueprint.status)
			.toBe('invalid')
		expect(blueprint.diagnostics)
			.toHaveLength(1)
		expect(blueprint.diagnostics[0])
			.toMatchObject({
				code: 'invalid-widget-config',
				path: ['visibleWhen', 'all', 1, 'op'],
				reason: 'unknown-op',
			})
	})

	it('compiles a valid config of every type', () => {
		for (const [type, config] of [
			['Numeric', { label, min: 0, visibleWhen: { not: { question: 'a', op: 'answered' } } }],
			['ShortAnswer', { label, maxLength: 3 }],
			['SingleChoice', { label, options: [option('a', { enabledWhen: { question: 'a', op: 'unanswered' } })] }],
			['MultipleChoice', { label, options: [option('a')], maxSelected: 1 }],
			['Survey', { title: label, languages: ['en', 'zh-TW'] }],
		] as const) {
			const blueprint = system.createBlueprint({ id: 'root', type, config })
			expect(blueprint.status, type)
				.toBe('valid')
		}
	})

	it('resolves an invalid config through resolve(null) with recovered: true', () => {
		const blueprint = system.createBlueprint({ id: 'root', type: 'Numeric', config: { label: 1 } })
		expect(blueprint.status)
			.toBe('invalid')
		expect(isRecovered(blueprint.root))
			.toBe(true)
	})
})
