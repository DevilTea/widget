// @vitest-environment happy-dom
/**
 * The root renderer's Submit flow against the default preset: the "blocked" message is only shown while
 * the survey cannot be submitted, the Submitted block leaves out hidden questions, and the native
 * controls carry the inline style that beats the Lab's CSS reset.
 */
import { flushPromises } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'
import { createSurveyRuntime, widgetOfType } from '../test-support'
import { mountSurvey, widgetSelector } from './test-harness'

describe('blocked message', () => {
	it('goes away when the last error is fixed, and the next Submit succeeds', async () => {
		const { runtime } = createSurveyRuntime()
		const wrapper = await mountSurvey(runtime)
		const diagnostic = (): boolean => wrapper.find('[data-testid="survey-submit-diagnostic"]')
			.exists()

		await wrapper.find('[data-testid="survey-submit"]')
			.trigger('click')
		await flushPromises()
		expect(diagnostic())
			.toBe(true)

		widgetOfType(runtime, 'mode', 'SingleChoice').state.answer.set('online')
		await flushPromises()
		// Still blocked: Sessions is required, so the message stays.
		expect(diagnostic())
			.toBe(true)

		widgetOfType(runtime, 'sessions', 'MultipleChoice').state.answer.set(['printing'])
		await flushPromises()
		expect(diagnostic())
			.toBe(false)
		expect(wrapper.find('[data-testid="survey-submitted"]')
			.exists())
			.toBe(false)

		await wrapper.find('[data-testid="survey-submit"]')
			.trigger('click')
		await flushPromises()
		expect(wrapper.find('[data-testid="survey-submitted"]')
			.exists())
			.toBe(true)
		expect(diagnostic())
			.toBe(false)
		wrapper.unmount()
	})

	it('comes back when a fixed answer breaks again, since the Method diagnostic is still the last result', async () => {
		const { runtime } = createSurveyRuntime()
		const wrapper = await mountSurvey(runtime)
		await wrapper.find('[data-testid="survey-submit"]')
			.trigger('click')
		widgetOfType(runtime, 'mode', 'SingleChoice').state.answer.set('online')
		widgetOfType(runtime, 'sessions', 'MultipleChoice').state.answer.set(['printing'])
		await flushPromises()
		expect(wrapper.find('[data-testid="survey-submit-diagnostic"]')
			.exists())
			.toBe(false)

		widgetOfType(runtime, 'sessions', 'MultipleChoice').state.answer.set(null)
		await flushPromises()
		expect(wrapper.find('[data-testid="survey-submit-diagnostic"]')
			.text())
			.toBe('Some answers have errors. Fix them before submitting.')
		wrapper.unmount()
	})
})

describe('submitted block', () => {
	it('leaves out questions that were hidden when the survey was submitted', async () => {
		const { runtime } = createSurveyRuntime()
		const wrapper = await mountSurvey(runtime)
		widgetOfType(runtime, 'mode', 'SingleChoice').state.answer.set('onsite')
		widgetOfType(runtime, 'guests', 'Numeric').state.answer.set(2)
		widgetOfType(runtime, 'sessions', 'MultipleChoice').state.answer.set(['printing'])
		widgetOfType(runtime, 'phone', 'ShortAnswer').state.answer.set('0912 345 678')
		await flushPromises()
		await wrapper.find('[data-testid="survey-submit"]')
			.trigger('click')
		await flushPromises()
		const ids = (): string[] => wrapper.findAll('[data-testid="survey-submitted"] dt')
			.map(dt => dt.text())
		expect(ids())
			.toEqual(['mode', 'guests', 'sessions', 'phone'])

		// Online hides Guests; the stored answer stays, but a new submission does not list it.
		widgetOfType(runtime, 'mode', 'SingleChoice').state.answer.set('online')
		await flushPromises()
		await wrapper.find('[data-testid="survey-submit"]')
			.trigger('click')
		await flushPromises()
		expect(ids())
			.toEqual(['mode', 'sessions', 'phone'])
		expect(wrapper.find('[data-testid="survey-submitted"]')
			.text())
			.not
			.toContain('guests')
		wrapper.unmount()
	})
})

describe('native control style', () => {
	it('sets colour, size and weight inline on Submit, and colour, size and a visible border on the fields', async () => {
		const { runtime } = createSurveyRuntime()
		const wrapper = await mountSurvey(runtime)
		widgetOfType(runtime, 'mode', 'SingleChoice').state.answer.set('onsite')
		await flushPromises()

		const style = (selector: string): string => wrapper.find(selector)
			.attributes('style') ?? ''
		const submit = style('[data-testid="survey-submit"]')
		expect(submit)
			.toContain('color: var(--lab-color-accent-contrast)')
		expect(submit)
			.toContain('font-size: 17px')
		expect(submit)
			.toContain('font-weight: 600')
		for (const selector of ['select', `${widgetSelector('guests')} input`, `${widgetSelector('phone')} input`]) {
			expect(style(selector), selector)
				.toContain('color: var(--lab-color-text)')
			expect(style(selector), selector)
				.toContain('font-size: 17px')
			expect(style(selector), selector)
				.toContain('border-color: var(--lab-color-text-muted)')
		}
		wrapper.unmount()
	})
})
