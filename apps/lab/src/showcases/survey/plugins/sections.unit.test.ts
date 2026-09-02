/**
 * `ConditionalSection.visible` for all three locked operators (checkpoint §2/§3), plus the
 * hidden-branch semantics: hiding does not mutate source topology and does not reset the hidden
 * child's Runtime State. `SurveySection` gets a light presentation-projection smoke test too.
 */

import { describe, expect, it } from 'vitest'
import { surveySystem } from '../system'
import { widgetOfType } from '../test-support'

const definition = {
	id: 'root',
	type: 'SurveySection',
	config: { title: 'Root', description: 'Root description' },
	slots: {
		body: [
			{ id: 'children', type: 'SurveyNumberQuestion', config: { label: 'Children', min: 0, default: 0 } },
			{
				id: 'flag',
				type: 'SurveyChoiceQuestion',
				config: { label: 'Flag', options: [{ value: 'a', label: 'A' }, { value: 'b', label: 'B' }], default: 'a' },
			},
			{
				id: 'cond-eq',
				type: 'ConditionalSection',
				config: { title: 'Eq', condition: { widgetId: 'flag', stateKey: 'answer', operator: 'equals', value: 'a' } },
				slots: { body: [] },
			},
			{
				id: 'cond-neq',
				type: 'ConditionalSection',
				config: { title: 'Neq', condition: { widgetId: 'flag', stateKey: 'answer', operator: 'not-equals', value: 'a' } },
				slots: { body: [] },
			},
			{
				id: 'cond-gt',
				type: 'ConditionalSection',
				config: { title: 'Gt', condition: { widgetId: 'children', stateKey: 'answer', operator: 'greater-than', value: 0 } },
				slots: {
					body: [
						{ id: 'family', type: 'SurveyChoiceQuestion', config: { label: 'Family', options: [{ value: 'x', label: 'X' }], default: null } },
					],
				},
			},
			{
				id: 'cond-gt-non-numeric',
				type: 'ConditionalSection',
				config: { title: 'Gt on a string target', condition: { widgetId: 'flag', stateKey: 'answer', operator: 'greater-than', value: 0 } },
				slots: { body: [] },
			},
		],
	},
}

function createRuntime() {
	const blueprint = surveySystem.createBlueprint(definition)
	if (blueprint.status !== 'valid')
		throw new Error(`Expected a valid Blueprint, got diagnostics: ${JSON.stringify(blueprint.diagnostics)}`)
	return blueprint.createRuntime()
}

describe('conditionalSection.visible', () => {
	it('"equals": visible when the target state equals the configured value', () => {
		const runtime = createRuntime()
		const condEq = widgetOfType(runtime, 'cond-eq', 'ConditionalSection')
		const flag = widgetOfType(runtime, 'flag', 'SurveyChoiceQuestion')

		expect(condEq.properties.visible.get())
			.toEqual({ ok: true, value: true })

		flag.state.answer.set('b')
		expect(condEq.properties.visible.get())
			.toEqual({ ok: true, value: false })
	})

	it('"not-equals": visible when the target state differs from the configured value', () => {
		const runtime = createRuntime()
		const condNeq = widgetOfType(runtime, 'cond-neq', 'ConditionalSection')
		const flag = widgetOfType(runtime, 'flag', 'SurveyChoiceQuestion')

		expect(condNeq.properties.visible.get())
			.toEqual({ ok: true, value: false })

		flag.state.answer.set('b')
		expect(condNeq.properties.visible.get())
			.toEqual({ ok: true, value: true })
	})

	it('"greater-than": visible when the (numeric) target state is greater than the configured value', () => {
		const runtime = createRuntime()
		const condGt = widgetOfType(runtime, 'cond-gt', 'ConditionalSection')
		const children = widgetOfType(runtime, 'children', 'SurveyNumberQuestion')

		expect(condGt.properties.visible.get())
			.toEqual({ ok: true, value: false })

		children.state.answer.set(2)
		expect(condGt.properties.visible.get())
			.toEqual({ ok: true, value: true })
	})

	it('"greater-than" against a non-numeric target fails via the .validate() refinement (property-dependency failure)', () => {
		const runtime = createRuntime()
		const condGtNonNumeric = widgetOfType(runtime, 'cond-gt-non-numeric', 'ConditionalSection')

		const result = condGtNonNumeric.properties.visible.get()
		expect(result.ok)
			.toBe(false)
		if (result.ok)
			throw new Error('expected a failure')
		expect(result.failure.diagnostics[0]!.code)
			.toBe('dependency-value-rejected')
	})

	it('hiding does not reset the hidden child\'s Runtime State (topology and State are untouched)', () => {
		const runtime = createRuntime()
		const children = widgetOfType(runtime, 'children', 'SurveyNumberQuestion')
		const family = widgetOfType(runtime, 'family', 'SurveyChoiceQuestion')
		const condGt = widgetOfType(runtime, 'cond-gt', 'ConditionalSection')

		children.state.answer.set(1)
		expect(condGt.properties.visible.get())
			.toEqual({ ok: true, value: true })
		family.state.answer.set('x')

		children.state.answer.set(0)
		expect(condGt.properties.visible.get())
			.toEqual({ ok: true, value: false })
		// The child widget still exists in the Runtime and its State is untouched by becoming hidden.
		expect(runtime.getWidget('family'))
			.not.toBeNull()
		expect(family.state.answer.get())
			.toBe('x')
	})
})

describe('surveySection', () => {
	it('projects resolved config as heading/description Properties', () => {
		const runtime = createRuntime()
		const root = widgetOfType(runtime, 'root', 'SurveySection')

		expect(root.properties.heading.get())
			.toEqual({ ok: true, value: 'Root' })
		expect(root.properties.description.get())
			.toEqual({ ok: true, value: 'Root description' })
	})
})
