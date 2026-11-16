/**
 * `classifyConditionTargets` on the default preset: for each slot, which questions are safe targets and
 * which would close an evaluation cycle. Every expectation is checked against the real compile; the
 * helper has no analysis of its own.
 */

import type { ConditionSlot } from './cycle-safe-targets'
import { describe, expect, it } from 'vitest'
import { classifyConditionTargets } from './cycle-safe-targets'
import { defaultSurveyPreset, surveyPresets } from './presets'

const source = () => JSON.parse(defaultSurveyPreset.sourceText) as any
const ALL = ['mode', 'guests', 'sessions', 'phone']

describe('classifyConditionTargets', () => {
	it.each<[string, string, ConditionSlot, string[], string[]]>([
		['guests visibleWhen', 'guests', { kind: 'visibleWhen' }, ['mode', 'phone'], ['guests', 'sessions']],
		['sessions option kids visibleWhen', 'sessions', { kind: 'option', option: 'kids', field: 'visibleWhen' }, ['mode', 'guests', 'phone'], ['sessions']],
		['sessions option laser enabledWhen', 'sessions', { kind: 'option', option: 'laser', field: 'enabledWhen' }, ['mode', 'guests', 'phone'], ['sessions']],
		['mode visibleWhen', 'mode', { kind: 'visibleWhen' }, ['phone'], ['mode', 'guests', 'sessions']],
		['phone required (a condition)', 'phone', { kind: 'required' }, ALL, []],
		['guests required (true)', 'guests', { kind: 'required' }, ALL, []],
		['sessions rule 0', 'sessions', { kind: 'rule', index: 0 }, ALL, []],
	])('%s', (_name, questionId, slot, safe, cycle) => {
		expect(classifyConditionTargets(source(), questionId, slot))
			.toEqual({ ok: true, safe, cycle })
	})

	it('lists safe and cycle targets in document order', () => {
		const result = classifyConditionTargets(source(), 'guests', { kind: 'visibleWhen' })
		expect(result.ok && [...result.safe, ...result.cycle].sort())
			.toEqual([...ALL].sort())
	})

	it('does not mutate the input document', () => {
		const input = source()
		const before = structuredClone(input)
		classifyConditionTargets(input, 'guests', { kind: 'visibleWhen' })
		classifyConditionTargets(input, 'sessions', { kind: 'rule', index: 0 })
		expect(input)
			.toEqual(before)
	})

	it('fails with a reason instead of classifying', () => {
		const aiDraft = JSON.parse(surveyPresets.find(preset => preset.id === 'survey-ai-draft')!.sourceText)
		expect(classifyConditionTargets(aiDraft, 'guests', { kind: 'visibleWhen' }))
			.toEqual({ ok: false, reason: 'invalid-document' })
		expect(classifyConditionTargets('not a survey', 'guests', { kind: 'visibleWhen' }))
			.toEqual({ ok: false, reason: 'invalid-document' })
		expect(classifyConditionTargets(source(), 'nobody', { kind: 'visibleWhen' }))
			.toEqual({ ok: false, reason: 'unknown-question' })
		expect(classifyConditionTargets(source(), 'open-day', { kind: 'visibleWhen' }))
			.toEqual({ ok: false, reason: 'unknown-question' })
		expect(classifyConditionTargets(source(), 'sessions', { kind: 'option', option: 'nope', field: 'visibleWhen' }))
			.toEqual({ ok: false, reason: 'unknown-slot' })
		expect(classifyConditionTargets(source(), 'guests', { kind: 'option', option: 'kids', field: 'visibleWhen' }))
			.toEqual({ ok: false, reason: 'unknown-slot' })
		expect(classifyConditionTargets(source(), 'sessions', { kind: 'rule', index: 1 }))
			.toEqual({ ok: false, reason: 'unknown-slot' })
	})
})
