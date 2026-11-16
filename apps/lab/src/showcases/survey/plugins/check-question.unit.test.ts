/**
 * The structure checks every question plugin shares (`checkQuestion`), through real Blueprints: which
 * diagnostics a definition produces, with their widget and `reason`. What is left to Core (a missing or
 * non-question target) is asserted to produce only Core's dependency diagnostics.
 */

import { describe, expect, it } from 'vitest'
import { surveySystem } from '../system'
import { question, surveyOf, t } from '../test-support'

interface Seen { readonly code: string, readonly widget: string | null, readonly reason?: string, readonly message: string }

function diagnosticsOf(source: unknown): Seen[] {
	return surveySystem.createBlueprint(source)
		.diagnostics
		.map((diagnostic) => {
			const node = 'node' in diagnostic.location ? diagnostic.location.node : null
			return {
				code: diagnostic.code,
				widget: node === null ? null : node.id,
				...('reason' in diagnostic && diagnostic.reason !== undefined ? { reason: diagnostic.reason } : {}),
				message: diagnostic.message,
			}
		})
}

function structure(source: unknown) {
	return diagnosticsOf(source)
		.filter(diagnostic => diagnostic.code === 'invalid-widget-structure')
}

function choice(id: string, extra: Record<string, unknown> = {}) {
	return question(id, 'SingleChoice', { options: [{ value: 'x', label: t('X') }, { value: 'y', label: t('Y') }], ...extra })
}

describe('placement and id format', () => {
	it('a question that is the root is outside a Survey', () => {
		expect(structure(question('age', 'Numeric')))
			.toEqual([expect.objectContaining({ widget: 'age', reason: 'question-outside-survey' })])
	})

	it('a Survey inside a Survey is not a root and not a question', () => {
		const inner = { id: 'inner', type: 'Survey', config: { title: t('Inner'), languages: ['en'] }, slots: { questions: [] } }
		const found = structure(surveyOf([inner]))
		expect(found.map(diagnostic => [diagnostic.widget, diagnostic.reason]))
			.toEqual(expect.arrayContaining([['inner', 'survey-not-root'], ['survey', 'not-a-question']]))
	})

	it.each(['Guests', '1st', 'a_b', 'a b', '-a'])('rejects the id %j', (id) => {
		expect(structure(surveyOf([question(id, 'Numeric')])))
			.toEqual([expect.objectContaining({ widget: id, reason: 'question-id-format' })])
	})

	it.each(['a', 'guests', 'q-1', 'open-day-2'])('accepts the id %j', (id) => {
		expect(structure(surveyOf([question(id, 'Numeric')])))
			.toEqual([])
	})
})

describe('missing translations', () => {
	it('reports each missing text with its config path, per language of the survey', () => {
		const source = surveyOf([
			question('q', 'MultipleChoice', {
				label: { en: 'Q' },
				help: { 'zh-TW': 'help' },
				options: [{ value: 'a', label: t('A') }, { value: 'b', label: { en: 'B' } }],
				rules: [{ when: { question: 'q', op: 'answered' }, message: { en: 'm' } }],
			}),
		])
		expect(structure(source)
			.map(diagnostic => [diagnostic.reason, diagnostic.message]))
			.toEqual([
				['missing-translation', 'label has no "zh-TW" text.'],
				['missing-translation', 'help has no "en" text.'],
				['missing-translation', 'options[1].label has no "zh-TW" text.'],
				['missing-translation', 'rules[0].message has no "zh-TW" text.'],
			])
	})

	it('needs only the languages the survey lists', () => {
		const source = surveyOf([question('q', 'Numeric', { label: { en: 'Q' } })], ['en'])
		expect(structure(source))
			.toEqual([])
	})

	it('is skipped for every question when the Survey config is invalid (its languages are unknown)', () => {
		const source = surveyOf([question('q', 'Numeric', { label: { en: 'Q' } })], ['fr'])
		expect(diagnosticsOf(source)
			.map(diagnostic => diagnostic.code))
			.toEqual(['invalid-widget-config'])
	})

	it('is skipped for a question whose own config failed, so only the config diagnostic remains', () => {
		const source = surveyOf([choice('mode', { options: [] })])
		const found = diagnosticsOf(source)
		expect(found.map(diagnostic => [diagnostic.code, diagnostic.widget]))
			.toEqual([['invalid-widget-config', 'mode']])
	})
})

describe('condition type checks', () => {
	const target = (type: string, extra: Record<string, unknown> = {}) => type === 'Numeric'
		? question('target', 'Numeric', extra)
		: type === 'MultipleChoice'
			? question('target', 'MultipleChoice', { options: [{ value: 'x', label: t('X') }], ...extra })
			: type === 'SingleChoice' ? choice('target', extra) : question('target', 'ShortAnswer', extra)
	const conditioned = (targetType: string, condition: unknown) => surveyOf([target(targetType), question('subject', 'Numeric', { visibleWhen: condition })])

	it.each([
		['Numeric', { question: 'target', op: 'includes', value: 'x' }],
		['SingleChoice', { question: 'target', op: 'greaterThan', value: 1 }],
		['ShortAnswer', { question: 'target', op: 'lessThan', value: 1 }],
		['MultipleChoice', { question: 'target', op: 'equals', value: 'x' }],
		['MultipleChoice', { question: 'target', op: 'notEquals', value: 'x' }],
		['SingleChoice', { question: 'target', op: 'excludes', value: 'x' }],
		['Numeric', { question: 'target', op: 'equals', value: 'x' }],
		['SingleChoice', { question: 'target', op: 'equals', value: 1 }],
		['ShortAnswer', { question: 'target', op: 'notEquals', value: 1 }],
	])('%s target: %j is a type mismatch', (type, condition) => {
		expect(structure(conditioned(type, condition)))
			.toEqual([expect.objectContaining({ widget: 'subject', reason: 'condition-type-mismatch' })])
	})

	it.each([
		['Numeric', { question: 'target', op: 'answered' }],
		['MultipleChoice', { question: 'target', op: 'unanswered' }],
		['Numeric', { question: 'target', op: 'greaterThan', value: 1 }],
		['Numeric', { question: 'target', op: 'equals', value: 1 }],
		['SingleChoice', { question: 'target', op: 'equals', value: 'x' }],
		['ShortAnswer', { question: 'target', op: 'equals', value: 'anything' }],
		['MultipleChoice', { question: 'target', op: 'includes', value: 'x' }],
		['MultipleChoice', { question: 'target', op: 'excludes', value: 'x' }],
	])('%s target: %j fits', (type, condition) => {
		expect(structure(conditioned(type, condition)))
			.toEqual([])
	})

	it('names the config path of the leaf, through all, any and not', () => {
		const condition = { all: [{ question: 'target', op: 'answered' }, { not: { question: 'target', op: 'includes', value: 'x' } }] }
		expect(structure(conditioned('Numeric', condition))[0]!.message)
			.toContain('visibleWhen.all[1].not: "includes" does not apply to "target", a Numeric question')
	})

	it('checks required, option conditions and rules too', () => {
		const source = surveyOf([
			question('n', 'Numeric'),
			choice('c', {
				required: { question: 'n', op: 'includes', value: 'x' },
				options: [{ value: 'x', label: t('X'), enabledWhen: { question: 'n', op: 'equals', value: 'str' } }],
				rules: [{ when: { question: 'n', op: 'excludes', value: 'x' }, message: t('m') }],
			}),
		])
		expect(structure(source)
			.map(diagnostic => diagnostic.message.split(':')[0]))
			.toEqual(['required', 'options[0].enabledWhen', 'rules[0].when'])
	})
})

describe('condition option checks', () => {
	const survey = (condition: unknown, targetExtra: Record<string, unknown> = {}) => surveyOf([
		choice('pick', targetExtra),
		question('subject', 'Numeric', { visibleWhen: condition }),
	])

	it('reports an option value the target does not have', () => {
		expect(structure(survey({ question: 'pick', op: 'equals', value: 'z' })))
			.toEqual([expect.objectContaining({ widget: 'subject', reason: 'condition-unknown-option', message: 'visibleWhen: "pick" has no option "z".' })])
		expect(structure(survey({ question: 'pick', op: 'notEquals', value: 'x' })))
			.toEqual([])
	})

	it('checks MultipleChoice option values for includes and excludes', () => {
		const source = surveyOf([
			question('many', 'MultipleChoice', { options: [{ value: 'a', label: t('A') }] }),
			question('subject', 'Numeric', { visibleWhen: { any: [{ question: 'many', op: 'includes', value: 'a' }, { question: 'many', op: 'excludes', value: 'b' }] } }),
		])
		expect(structure(source)
			.map(diagnostic => [diagnostic.reason, diagnostic.message]))
			.toEqual([['condition-unknown-option', 'visibleWhen.any[1]: "many" has no option "b".']])
	})

	it('a recovered target is still type-checked but not option-checked', () => {
		const recoveredPick = choice('pick', { options: [] }) // invalid config: compiled through resolve(null)
		const optionCheck = surveyOf([recoveredPick, question('subject', 'Numeric', { visibleWhen: { question: 'pick', op: 'equals', value: 'z' } })])
		expect(diagnosticsOf(optionCheck)
			.map(diagnostic => [diagnostic.code, diagnostic.widget]))
			.toEqual([['invalid-widget-config', 'pick']])

		const typeCheck = surveyOf([recoveredPick, question('subject', 'Numeric', { visibleWhen: { question: 'pick', op: 'greaterThan', value: 1 } })])
		expect(diagnosticsOf(typeCheck)
			.map(diagnostic => [diagnostic.code, diagnostic.widget, diagnostic.reason]))
			.toEqual([['invalid-widget-config', 'pick', 'empty-options'], ['invalid-widget-structure', 'subject', 'condition-type-mismatch']])
	})
})

describe('no cascades on top of the one real problem', () => {
	it('a question at the root has only question-outside-survey, no missing language member', () => {
		expect(diagnosticsOf(question('age', 'Numeric'))
			.map(diagnostic => [diagnostic.code, diagnostic.widget, diagnostic.reason]))
			.toEqual([['invalid-widget-structure', 'age', 'question-outside-survey']])
	})

	it('a duplicate question id has only Core\'s duplicate-widget-id, not ambiguous dependencies from the root', () => {
		const found = diagnosticsOf(surveyOf([question('a', 'Numeric'), question('a', 'Numeric'), question('b', 'ShortAnswer')]))
		expect(found.map(diagnostic => [diagnostic.code, diagnostic.widget]))
			.toEqual([['duplicate-widget-id', 'a'], ['duplicate-widget-id', 'a']])
	})

	it('a condition that names a duplicated id is still Core\'s ambiguous-dependency-target', () => {
		const found = diagnosticsOf(surveyOf([question('a', 'Numeric'), question('a', 'Numeric'), question('b', 'Numeric', { visibleWhen: { question: 'a', op: 'answered' } })]))
		expect(found.map(diagnostic => diagnostic.code)
			.sort())
			.toEqual(['ambiguous-dependency-target', 'duplicate-widget-id', 'duplicate-widget-id'])
	})
})

describe('what is left to Core', () => {
	it('a target that does not exist is only a missing-dependency-target', () => {
		const found = diagnosticsOf(surveyOf([question('subject', 'Numeric', { visibleWhen: { question: 'ghost', op: 'answered' } })]))
		expect(found.map(diagnostic => [diagnostic.code, diagnostic.widget]))
			.toEqual([['missing-dependency-target', 'subject']])
	})

	it('a target that is not a question is only a missing-dependency-member', () => {
		const found = diagnosticsOf(surveyOf([question('subject', 'Numeric', { visibleWhen: { question: 'survey', op: 'answered' } })]))
		expect(found.map(diagnostic => diagnostic.code))
			.toEqual(['missing-dependency-member'])
	})
})
