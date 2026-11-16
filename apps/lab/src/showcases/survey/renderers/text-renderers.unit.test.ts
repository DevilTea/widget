// @vitest-environment happy-dom
/**
 * `NumericRenderer` and `ShortAnswerRenderer` against the real default preset: hidden until the plugin
 * says visible, label and help wiring, `''` to `null`, and errors shown from the Properties.
 */
import { flushPromises } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'
import { createSurveyRuntime, widgetOfType } from '../test-support'
import { mountSurvey, widgetSelector } from './test-harness'

describe('numericRenderer', () => {
	it('renders nothing until the mode is on site, then a labelled number input with the required error', async () => {
		const { runtime } = createSurveyRuntime()
		const wrapper = await mountSurvey(runtime)
		expect(wrapper.find(widgetSelector('guests'))
			.exists())
			.toBe(false)
		expect(wrapper.find('input[type="number"]')
			.exists())
			.toBe(false)

		widgetOfType(runtime, 'mode', 'SingleChoice').state.answer.set('onsite')
		await flushPromises()

		const root = wrapper.find(widgetSelector('guests'))
		expect(root.attributes('data-tutorial-target'))
			.toBe('survey-guests')
		const input = root.find('input[type="number"]')
		const label = root.find('label')
		expect(label.attributes('for'))
			.toBe(input.attributes('id'))
		expect(label.text())
			.toContain('Guests coming with you')
		expect(input.attributes('aria-required'))
			.toBe('true')
		expect(input.attributes('aria-invalid'))
			.toBe('true')
		expect(root.find(`[id="${input.attributes('aria-describedby')}"]`)
			.text())
			.toContain('This question is required.')
		wrapper.unmount()
	})

	it('writes the typed number, shows the max error while still storing it, and clears an empty box to null', async () => {
		const { runtime } = createSurveyRuntime()
		const wrapper = await mountSurvey(runtime)
		const mode = widgetOfType(runtime, 'mode', 'SingleChoice')
		const guests = widgetOfType(runtime, 'guests', 'Numeric')
		mode.state.answer.set('onsite')
		await flushPromises()

		const input = wrapper.find(`${widgetSelector('guests')} input`)
		await input.setValue('5')
		await flushPromises()
		expect(guests.state.answer.get())
			.toBe(5)
		const error = wrapper.find(`${widgetSelector('guests')} [data-testid="survey-question-error"]`)
		expect(error.attributes('data-error-code'))
			.toBe('max')
		expect(error.text())
			.toContain('Must be at most 3.')

		await input.setValue('2')
		await flushPromises()
		expect(guests.state.answer.get())
			.toBe(2)
		expect(wrapper.find(`${widgetSelector('guests')} [data-testid="survey-question-error"]`)
			.exists())
			.toBe(false)

		await input.setValue('')
		await flushPromises()
		expect(guests.state.answer.get())
			.toBeNull()
		wrapper.unmount()
	})

	it('hides again, without losing the stored answer, when the mode goes back to online', async () => {
		const { runtime } = createSurveyRuntime()
		const wrapper = await mountSurvey(runtime)
		const mode = widgetOfType(runtime, 'mode', 'SingleChoice')
		const guests = widgetOfType(runtime, 'guests', 'Numeric')
		mode.state.answer.set('onsite')
		guests.state.answer.set(3)
		await flushPromises()
		expect(wrapper.find(widgetSelector('guests'))
			.exists())
			.toBe(true)

		mode.state.answer.set('online')
		await flushPromises()
		expect(wrapper.find(widgetSelector('guests'))
			.exists())
			.toBe(false)
		expect(guests.state.answer.get())
			.toBe(3)
		wrapper.unmount()
	})
})

describe('shortAnswerRenderer', () => {
	it('associates its label and help with the input and writes the text, with an empty box as null', async () => {
		const { runtime } = createSurveyRuntime()
		const wrapper = await mountSurvey(runtime)
		const phone = widgetOfType(runtime, 'phone', 'ShortAnswer')

		const root = wrapper.find(widgetSelector('phone'))
		const input = root.find('input[type="text"]')
		expect(root.find('label')
			.attributes('for'))
			.toBe(input.attributes('id'))
		expect(root.find(`[id="${input.attributes('aria-describedby')}"]`)
			.text())
			.toBe('Needed for on-site visitors.')
		// Not required yet, no errors, no aria-required.
		expect(input.attributes('aria-required'))
			.toBeUndefined()

		await input.setValue('0912 345 678')
		await flushPromises()
		expect(phone.state.answer.get())
			.toBe('0912 345 678')
		await input.setValue('')
		await flushPromises()
		expect(phone.state.answer.get())
			.toBeNull()
		wrapper.unmount()
	})

	it('becomes required with the plugin\'s error once the mode is on site', async () => {
		const { runtime } = createSurveyRuntime()
		const wrapper = await mountSurvey(runtime)
		widgetOfType(runtime, 'mode', 'SingleChoice').state.answer.set('onsite')
		await flushPromises()

		const root = wrapper.find(widgetSelector('phone'))
		expect(root.find('input')
			.attributes('aria-required'))
			.toBe('true')
		expect(root.find('[data-testid="survey-question-error"]')
			.text())
			.toContain('This question is required.')
		wrapper.unmount()
	})
})
