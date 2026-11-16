/**
 * Conformance tests for the three leaf question plugins (checkpoint §2/§4.1): primitive State
 * validation only, invalid writes preserve the previous authoritative value and produce a
 * `state-validation` Runtime Diagnostic, and `reset()` restores the configured default.
 */

import { describe, expect, it } from 'vitest'
import { surveySystem } from '../system'
import { widgetOfType } from '../test-support'

function runtimeOf(definition: unknown) {
	const blueprint = surveySystem.createBlueprint(definition)
	if (blueprint.status !== 'valid')
		throw new Error(`Expected a valid Blueprint, got diagnostics: ${JSON.stringify(blueprint.diagnostics)}`)
	return blueprint.createRuntime()
}

describe('surveyDateQuestion', () => {
	it('accepts null and a strict calendar-valid YYYY-MM-DD string', () => {
		const runtime = runtimeOf({ id: 'q', type: 'SurveyDateQuestion', config: { label: 'Departure', default: null } })
		const widget = widgetOfType(runtime, 'q', 'SurveyDateQuestion')

		expect(widget.state.answer.get())
			.toBeNull()
		expect(widget.state.answer.set('2027-04-10'))
			.toEqual({ ok: true, value: '2027-04-10' })
		expect(widget.state.answer.get())
			.toBe('2027-04-10')
	})

	it('rejects a calendar-invalid date (e.g. 2027-02-30), preserving the previous value', () => {
		const runtime = runtimeOf({ id: 'q', type: 'SurveyDateQuestion', config: { label: 'Departure', default: '2027-04-10' } })
		const widget = widgetOfType(runtime, 'q', 'SurveyDateQuestion')

		const result = widget.state.answer.set('2027-02-30')
		expect(result.ok)
			.toBe(false)
		expect(widget.state.answer.get())
			.toBe('2027-04-10')
		expect(widget.state.answer.getDiagnostics())
			.toHaveLength(1)
		expect(widget.state.answer.getDiagnostics()[0]!.code)
			.toBe('invalid-state-value')
	})

	it('reset() restores the configured default', () => {
		const runtime = runtimeOf({ id: 'q', type: 'SurveyDateQuestion', config: { label: 'Departure', default: '2027-04-10' } })
		const widget = widgetOfType(runtime, 'q', 'SurveyDateQuestion')

		widget.state.answer.set('2027-05-01')
		widget.methods.reset()
		expect(widget.state.answer.get())
			.toBe('2027-04-10')
	})
})

describe('surveyNumberQuestion', () => {
	it('rejects a candidate below min, preserving the previous value with a state-validation diagnostic', () => {
		const runtime = runtimeOf({ id: 'q', type: 'SurveyNumberQuestion', config: { label: 'Adults', min: 1, max: 8, integer: true, default: 2 } })
		const widget = widgetOfType(runtime, 'q', 'SurveyNumberQuestion')

		const result = widget.state.answer.set(0)
		expect(result.ok)
			.toBe(false)
		expect(widget.state.answer.get())
			.toBe(2)
		expect(widget.state.answer.getDiagnostics()[0]!.code)
			.toBe('invalid-state-value')
	})

	it('rejects a candidate above max, preserving the previous value', () => {
		const runtime = runtimeOf({ id: 'q', type: 'SurveyNumberQuestion', config: { label: 'Adults', min: 1, max: 8, integer: true, default: 2 } })
		const widget = widgetOfType(runtime, 'q', 'SurveyNumberQuestion')

		expect(widget.state.answer.set(9).ok)
			.toBe(false)
		expect(widget.state.answer.get())
			.toBe(2)
	})

	it('rejects a non-integer candidate when integer: true, preserving the previous value', () => {
		const runtime = runtimeOf({ id: 'q', type: 'SurveyNumberQuestion', config: { label: 'Adults', integer: true, default: 2 } })
		const widget = widgetOfType(runtime, 'q', 'SurveyNumberQuestion')

		expect(widget.state.answer.set(2.5).ok)
			.toBe(false)
		expect(widget.state.answer.get())
			.toBe(2)
	})

	it('accepts a valid in-range candidate', () => {
		const runtime = runtimeOf({ id: 'q', type: 'SurveyNumberQuestion', config: { label: 'Adults', min: 1, max: 8, integer: true, default: 2 } })
		const widget = widgetOfType(runtime, 'q', 'SurveyNumberQuestion')

		expect(widget.state.answer.set(5))
			.toEqual({ ok: true, value: 5 })
	})
})

describe('surveyChoiceQuestion', () => {
	const options = [
		{ value: 'tokyo', label: 'Tokyo' },
		{ value: 'seoul', label: 'Seoul' },
		{ value: 'bangkok', label: 'Bangkok' },
	]

	it('accepts a configured option value and null', () => {
		const runtime = runtimeOf({ id: 'q', type: 'SurveyChoiceQuestion', config: { label: 'Destination', options, default: 'tokyo' } })
		const widget = widgetOfType(runtime, 'q', 'SurveyChoiceQuestion')

		expect(widget.state.answer.get())
			.toBe('tokyo')
		expect(widget.state.answer.set('seoul'))
			.toEqual({ ok: true, value: 'seoul' })
		expect(widget.state.answer.set(null))
			.toEqual({ ok: true, value: null })
	})

	it('rejects a value outside the configured options, preserving the previous value', () => {
		const runtime = runtimeOf({ id: 'q', type: 'SurveyChoiceQuestion', config: { label: 'Destination', options, default: 'tokyo' } })
		const widget = widgetOfType(runtime, 'q', 'SurveyChoiceQuestion')

		const result = widget.state.answer.set('paris')
		expect(result.ok)
			.toBe(false)
		expect(widget.state.answer.get())
			.toBe('tokyo')
		expect(widget.state.answer.getDiagnostics()[0]!.code)
			.toBe('invalid-state-value')
	})

	it('reset() restores the configured default', () => {
		const runtime = runtimeOf({ id: 'q', type: 'SurveyChoiceQuestion', config: { label: 'Destination', options, default: 'tokyo' } })
		const widget = widgetOfType(runtime, 'q', 'SurveyChoiceQuestion')

		widget.state.answer.set('seoul')
		widget.methods.reset()
		expect(widget.state.answer.get())
			.toBe('tokyo')
	})
})
