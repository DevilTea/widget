// @vitest-environment happy-dom
/**
 * What each question renderer does with the Properties of a small inline survey: nothing while
 * `visible` is not `true` (every type), a disabled option, a radio that follows State written elsewhere,
 * and a number input that does not take the mouse wheel.
 */
import { flushPromises } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'
import { createRuntimeFor, question, surveyOf, t, widgetOfType } from '../test-support'
import { mountSurvey, widgetSelector } from './test-harness'

const GATE_IS_YES = { question: 'gate', op: 'equals', value: 'yes' }

function options(...values: string[]) {
	return values.map(value => ({ value, label: t(value) }))
}

/** A `gate` question (always visible) and one question of each type shown only while `gate` is `yes`. */
function gatedSurvey() {
	return createRuntimeFor(surveyOf([
		question('gate', 'SingleChoice', { options: options('yes', 'no') }),
		question('single', 'SingleChoice', { options: options('a', 'b'), visibleWhen: GATE_IS_YES }),
		question('multi', 'MultipleChoice', { options: options('a', 'b'), visibleWhen: GATE_IS_YES }),
		question('short', 'ShortAnswer', { visibleWhen: GATE_IS_YES }),
		question('number', 'Numeric', { visibleWhen: GATE_IS_YES }),
	])).runtime
}

describe('a question that is not visible', () => {
	it.each(['single', 'multi', 'short', 'number'])('renders nothing for %s, and renders it once the gate opens', async (id) => {
		const runtime = gatedSurvey()
		const gate = widgetOfType(runtime, 'gate', 'SingleChoice')
		const wrapper = await mountSurvey(runtime)

		expect(wrapper.find(widgetSelector(id))
			.exists())
			.toBe(false)
		expect(wrapper.findAll('[data-widget-id]')
			.map(element => element.attributes('data-widget-id')))
			.toEqual(['survey', 'gate'])

		gate.state.answer.set('yes')
		await flushPromises()
		expect(wrapper.find(widgetSelector(id))
			.exists())
			.toBe(true)

		gate.state.answer.set('no')
		await flushPromises()
		expect(wrapper.find(widgetSelector(id))
			.exists())
			.toBe(false)
		wrapper.unmount()
	})
})

describe('singleChoiceRenderer options and state', () => {
	function seatSurvey() {
		return createRuntimeFor(surveyOf([
			question('gate', 'SingleChoice', { options: options('yes', 'no') }),
			question('seat', 'SingleChoice', {
				options: [
					{ value: 'aisle', label: t('aisle') },
					{ value: 'window', label: t('window'), enabledWhen: GATE_IS_YES },
					{ value: 'middle', label: t('middle'), visibleWhen: GATE_IS_YES },
				],
			}),
		])).runtime
	}

	it('renders a disabled option as a disabled radio, a hidden one not at all, and follows the condition', async () => {
		const runtime = seatSurvey()
		const wrapper = await mountSurvey(runtime)
		const radios = (): Record<string, boolean> => Object.fromEntries(wrapper.findAll(`${widgetSelector('seat')} input[type="radio"]`)
			.map(radio => [radio.attributes('value')!, radio.attributes('disabled') !== undefined]))

		expect(radios())
			.toEqual({ aisle: false, window: true })

		widgetOfType(runtime, 'gate', 'SingleChoice').state.answer.set('yes')
		await flushPromises()
		expect(radios())
			.toEqual({ aisle: false, window: false, middle: false })
		wrapper.unmount()
	})

	it('checks the radio of the stored answer, also when State is written elsewhere, and clears it for null', async () => {
		const runtime = seatSurvey()
		const wrapper = await mountSurvey(runtime)
		const seat = widgetOfType(runtime, 'seat', 'SingleChoice')
		const checked = (): string[] => wrapper.findAll(`${widgetSelector('seat')} input[type="radio"]`)
			.filter(radio => (radio.element as HTMLInputElement).checked)
			.map(radio => radio.attributes('value')!)

		expect(checked())
			.toEqual([])
		seat.state.answer.set('aisle')
		await flushPromises()
		expect(checked())
			.toEqual(['aisle'])

		// Another write through the Runtime moves the DOM; nothing was clicked.
		widgetOfType(runtime, 'gate', 'SingleChoice').state.answer.set('yes')
		seat.state.answer.set('window')
		await flushPromises()
		expect(checked())
			.toEqual(['window'])

		seat.state.answer.set(null)
		await flushPromises()
		expect(checked())
			.toEqual([])
		wrapper.unmount()
	})
})

describe('multipleChoiceRenderer state', () => {
	it('checks the boxes of the stored answer when State is written elsewhere', async () => {
		const runtime = createRuntimeFor(surveyOf([question('multi', 'MultipleChoice', { options: options('a', 'b', 'c') })])).runtime
		const wrapper = await mountSurvey(runtime)
		const checked = (): string[] => wrapper.findAll('input[type="checkbox"]')
			.filter(box => (box.element as HTMLInputElement).checked)
			.map(box => box.attributes('value')!)

		widgetOfType(runtime, 'multi', 'MultipleChoice').state.answer.set(['c', 'a'])
		await flushPromises()
		expect(checked())
			.toEqual(['a', 'c'])
		widgetOfType(runtime, 'multi', 'MultipleChoice').state.answer.set(null)
		await flushPromises()
		expect(checked())
			.toEqual([])
		wrapper.unmount()
	})
})

describe('numericRenderer wheel', () => {
	it('blurs a focused number input on the mouse wheel, so scrolling never edits the answer', async () => {
		const runtime = createRuntimeFor(surveyOf([question('guests', 'Numeric')])).runtime
		const wrapper = await mountSurvey(runtime, { attachTo: document.body })
		const input = wrapper.find('input[type="number"]')
			.element as HTMLInputElement

		input.focus()
		expect(document.activeElement)
			.toBe(input)
		input.dispatchEvent(new WheelEvent('wheel', { bubbles: true, cancelable: true, deltaY: 100 }))
		expect(document.activeElement)
			.not
			.toBe(input)
		expect(widgetOfType(runtime, 'guests', 'Numeric').state.answer.get())
			.toBeNull()
		wrapper.unmount()
	})
})
