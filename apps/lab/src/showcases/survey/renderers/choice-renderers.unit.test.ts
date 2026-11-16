// @vitest-environment happy-dom
/**
 * `SingleChoiceRenderer` and `MultipleChoiceRenderer` against the real default preset: label and error
 * wiring, writes to State `answer`, and disabled and hidden options.
 */
import { flushPromises } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'
import { createSurveyRuntime, widgetOfType } from '../test-support'
import { mountSurvey, widgetSelector } from './test-harness'

describe('singleChoiceRenderer', () => {
	it('is a radiogroup fieldset named by its legend, with the required error linked by aria-describedby', async () => {
		const { runtime } = createSurveyRuntime()
		const wrapper = await mountSurvey(runtime)

		const group = wrapper.find(`fieldset${widgetSelector('mode')}`)
		expect(group.exists())
			.toBe(true)
		expect(group.attributes('role'))
			.toBe('radiogroup')
		expect(group.attributes('aria-required'))
			.toBe('true')
		expect(group.attributes('aria-invalid'))
			.toBe('true')
		expect(group.attributes('data-tutorial-target'))
			.toBe('survey-mode')
		const legend = group.find(':scope > legend')
		expect(legend.text())
			.toContain('How will you join?')

		// Errors are visible from load, and the group points at them.
		const error = group.find('[data-testid="survey-question-error"]')
		expect(error.text())
			.toContain('This question is required.')
		expect(error.attributes('data-error-code'))
			.toBe('required')
		const describedBy = group.attributes('aria-describedby')
		expect(describedBy)
			.toBeTruthy()
		expect(group.find(`[id="${describedBy}"]`).element)
			.toBe(error.element.parentElement)

		const radios = group.findAll('input[type="radio"]')
		expect(radios)
			.toHaveLength(2)
		expect(new Set(radios.map(radio => radio.attributes('name'))).size)
			.toBe(1)
		// Each option label is the radio's accessible label.
		expect(radios.map(radio => radio.element.closest('label')?.textContent?.trim()))
			.toEqual(['On site', 'Online'])
		wrapper.unmount()
	})

	it('writes State answer when an option is chosen and checks the stored option', async () => {
		const { runtime } = createSurveyRuntime()
		const wrapper = await mountSurvey(runtime)
		const mode = widgetOfType(runtime, 'mode', 'SingleChoice')

		await wrapper.find('input[type="radio"][value="onsite"]')
			.setValue(true)
		await flushPromises()
		expect(mode.state.answer.get())
			.toBe('onsite')
		expect((wrapper.find('input[type="radio"][value="onsite"]').element as HTMLInputElement).checked)
			.toBe(true)
		// The required error went away: the renderer shows the Property, it does not compute it.
		expect(wrapper.find(`fieldset${widgetSelector('mode')} [data-testid="survey-question-error"]`)
			.exists())
			.toBe(false)
		expect(wrapper.find(`fieldset${widgetSelector('mode')}`)
			.attributes('aria-invalid'))
			.toBeUndefined()

		await wrapper.find('input[type="radio"][value="online"]')
			.setValue(true)
		await flushPromises()
		expect(mode.state.answer.get())
			.toBe('online')
		wrapper.unmount()
	})
})

describe('multipleChoiceRenderer', () => {
	it('renders a fieldset of checkboxes with disabled options disabled and hidden options not rendered', async () => {
		const { runtime } = createSurveyRuntime()
		const wrapper = await mountSurvey(runtime)

		const group = wrapper.find(`fieldset${widgetSelector('sessions')}`)
		expect(group.find(':scope > legend')
			.text())
			.toContain('Sessions you want to join')
		expect(group.text())
			.toContain('Pick one or two.')
		const boxes = group.findAll('input[type="checkbox"]')
		// "Kids' corner" is hidden until Guests is above zero: no row at all.
		expect(boxes.map(box => box.attributes('value')))
			.toEqual(['printing', 'laser'])
		// "Laser cutting" needs the On site mode: rendered but disabled.
		expect(boxes.map(box => box.attributes('disabled') !== undefined))
			.toEqual([false, true])
		expect(group.text())
			.not
			.toContain('Kids\' corner')
		wrapper.unmount()
	})

	it('writes State answer on toggling, keeps unavailable choices out of the way and enables options as the mode changes', async () => {
		const { runtime } = createSurveyRuntime()
		const wrapper = await mountSurvey(runtime)
		const sessions = widgetOfType(runtime, 'sessions', 'MultipleChoice')

		await wrapper.find('input[value="printing"]')
			.setValue(true)
		await flushPromises()
		expect(sessions.state.answer.get())
			.toEqual(['printing'])

		widgetOfType(runtime, 'mode', 'SingleChoice').state.answer.set('onsite')
		await flushPromises()
		const laser = wrapper.find('input[value="laser"]')
		expect(laser.attributes('disabled'))
			.toBeUndefined()
		await laser.setValue(true)
		await flushPromises()
		expect(sessions.state.answer.get())
			.toEqual(['printing', 'laser'])

		await wrapper.find('input[value="printing"]')
			.setValue(false)
		await wrapper.find('input[value="laser"]')
			.setValue(false)
		await flushPromises()
		expect(sessions.state.answer.get())
			.toBeNull()
		wrapper.unmount()
	})

	it('labels each checkbox, and links the group to its help and errors', async () => {
		const { runtime } = createSurveyRuntime()
		const wrapper = await mountSurvey(runtime)
		const group = wrapper.find(`fieldset${widgetSelector('sessions')}`)

		expect(group.findAll('input[type="checkbox"]')
			.map(box => box.element.closest('label')?.textContent?.trim()))
			.toEqual(['3D printing basics', 'Laser cutting'])
		const describedBy = group.attributes('aria-describedby')!.split(' ')
		expect(describedBy)
			.toHaveLength(2)
		expect(group.find(`[id="${describedBy[0]}"]`)
			.text())
			.toBe('Pick one or two.')
		expect(group.find(`[id="${describedBy[1]}"]`)
			.text())
			.toContain('This question is required.')
		wrapper.unmount()
	})
})
