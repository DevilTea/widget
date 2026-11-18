// @vitest-environment happy-dom
/**
 * `SurveyRootRenderer` (through the real `SurveyRenderer` registry) against the default preset: language
 * switch, blocked and valid Submit, the Submitted block with its changed-since-submit marker, the
 * Response block, and the tutorial targets.
 */
import { flushPromises } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'
import { createSurveyRuntime, valueOf, widgetOfType } from '../test-support'
import { createTestHost, mountSurvey, widgetSelector } from './test-harness'

function fillOnsite(runtime: ReturnType<typeof createSurveyRuntime>['runtime']): void {
	widgetOfType(runtime, 'mode', 'SingleChoice').state.answer.set('onsite')
	widgetOfType(runtime, 'guests', 'Numeric').state.answer.set(2)
	widgetOfType(runtime, 'sessions', 'MultipleChoice').state.answer.set(['printing'])
	widgetOfType(runtime, 'phone', 'ShortAnswer').state.answer.set('0912 345 678')
}

describe('surveyRootRenderer', () => {
	it('shows the title, a labelled language select with endonyms, and the questions in order', async () => {
		const { runtime } = createSurveyRuntime()
		const wrapper = await mountSurvey(runtime)

		expect(wrapper.find('h1')
			.text())
			.toBe('Maker Space open day: sign-up')
		const select = wrapper.find('select')
		expect(wrapper.find(`label[for="${select.attributes('id')}"]`)
			.text())
			.toBe('Language')
		expect(select.findAll('option')
			.map(option => option.text()))
			.toEqual(['English', '繁體中文'])
		expect((select.element as HTMLSelectElement).value)
			.toBe('en')
		expect(wrapper.findAll('[data-widget-id]')
			.map(element => element.attributes('data-widget-id')))
			.toEqual(['open-day', 'mode', 'sessions', 'phone'])
		wrapper.unmount()
	})

	it('switches every label, option and message when the language changes, and writes State language', async () => {
		const { runtime } = createSurveyRuntime()
		const wrapper = await mountSurvey(runtime)

		await wrapper.find('select')
			.setValue('zh-TW')
		await flushPromises()

		expect(widgetOfType(runtime, 'open-day', 'Survey').state.language.get())
			.toBe('zh-TW')
		expect(wrapper.find('h1')
			.text())
			.toBe('創客空間開放日報名')
		expect(wrapper.find(widgetSelector('mode'))
			.text())
			.toContain('您會如何參加？')
		expect(wrapper.find(widgetSelector('mode'))
			.text())
			.toContain('現場參加')
		expect(wrapper.find(`${widgetSelector('mode')} [data-testid="survey-question-error"]`)
			.text())
			.toContain('此題為必填。')
		expect(wrapper.find('[data-testid="survey-submit"]')
			.text())
			.toBe('送出')
		wrapper.unmount()
	})

	it('shows the Method diagnostic verbatim for a blocked Submit, and no Submitted block', async () => {
		const { runtime } = createSurveyRuntime()
		const wrapper = await mountSurvey(runtime)

		await wrapper.find('[data-testid="survey-submit"]')
			.trigger('click')
		await flushPromises()

		const diagnostic = wrapper.find('[data-testid="survey-submit-diagnostic"]')
		expect(diagnostic.text())
			.toBe('Some answers have errors. Fix them before submitting.')
		expect(diagnostic.attributes('role'))
			.toBe('alert')
		expect(wrapper.find('[data-testid="survey-submitted"]')
			.exists())
			.toBe(false)
		expect(widgetOfType(runtime, 'open-day', 'Survey').state.submitted.get())
			.toBeNull()
		wrapper.unmount()
	})

	it('shows the Submitted block after a valid Submit, then the marker once an answer changes', async () => {
		const { runtime } = createSurveyRuntime()
		const wrapper = await mountSurvey(runtime)
		fillOnsite(runtime)
		await flushPromises()

		await wrapper.find('[data-testid="survey-submit"]')
			.trigger('click')
		await flushPromises()

		const submitted = wrapper.find('[data-testid="survey-submitted"]')
		expect(submitted.exists())
			.toBe(true)
		expect(submitted.attributes('data-tutorial-target'))
			.toBe('survey-submitted')
		expect(submitted.find('h2')
			.text())
			.toContain('Submitted')
		expect(submitted.text())
			.toContain('0912 345 678')
		expect(wrapper.find('[data-testid="survey-submit-diagnostic"]')
			.exists())
			.toBe(false)
		expect(wrapper.find('[data-testid="survey-changed-since-submit"]')
			.exists())
			.toBe(false)

		widgetOfType(runtime, 'guests', 'Numeric').state.answer.set(1)
		await flushPromises()

		const marker = wrapper.find('[data-testid="survey-changed-since-submit"]')
		expect(marker.text())
			.toBe('Answers changed since you submitted')
		// The snapshot keeps the submitted values while the live response moved on.
		expect(submitted.text())
			.toContain('2')
		expect(valueOf(widgetOfType(runtime, 'open-day', 'Survey').properties.response.get()).answers.guests?.value)
			.toBe(1)
		wrapper.unmount()
	})

	it('shows the live response as pretty JSON in a collapsed details block with the four member names', async () => {
		const { runtime } = createSurveyRuntime()
		const wrapper = await mountSurvey(runtime)

		const details = wrapper.find('details[data-testid="survey-response"]')
		expect(details.attributes('open'))
			.toBeUndefined()
		expect(details.find('summary')
			.text())
			.toBe('Response — what a backend reads')
		const json = details.find('[data-testid="survey-response-json"]')
			.text()
		for (const member of ['visible', 'required', 'value', 'errors']) {
			expect(json)
				.toContain(`"${member}"`)
		}
		expect(JSON.parse(json))
			.toEqual(valueOf(widgetOfType(runtime, 'open-day', 'Survey').properties.response.get()))
		expect(json)
			.toContain('\n  ')

		widgetOfType(runtime, 'mode', 'SingleChoice').state.answer.set('online')
		await flushPromises()
		expect(JSON.parse(details.find('[data-testid="survey-response-json"]')
			.text()).answers.mode.value)
			.toBe('online')
		wrapper.unmount()
	})

	it('puts the tutorial targets on mode, guests, the actions and the Submitted block', async () => {
		const { runtime } = createSurveyRuntime()
		const wrapper = await mountSurvey(runtime)
		const targets = (): string[] => wrapper.findAll('[data-tutorial-target]')
			.map(element => element.attributes('data-tutorial-target')!)

		expect(targets())
			.toEqual(['survey-mode', 'survey-actions'])

		fillOnsite(runtime)
		await flushPromises()
		expect(targets())
			.toEqual(['survey-mode', 'survey-guests', 'survey-actions'])

		await wrapper.find('[data-testid="survey-submit"]')
			.trigger('click')
		await flushPromises()
		expect(targets())
			.toEqual(['survey-mode', 'survey-guests', 'survey-actions', 'survey-submitted'])
		expect(wrapper.find('[data-tutorial-target="survey-actions"] [data-testid="survey-submit"]')
			.exists())
			.toBe(true)
		wrapper.unmount()
	})

	it('reads changedSinceSubmit and response even before anything is submitted', async () => {
		const { runtime } = createSurveyRuntime()
		const wrapper = await mountSurvey(runtime)

		expect(wrapper.find(widgetSelector('open-day'))
			.attributes('data-changed-since-submit'))
			.toBe('false')
		wrapper.unmount()
	})

	it('follows the host locale: the language label and the response summary switch and switch back', async () => {
		const { runtime } = createSurveyRuntime()
		const host = createTestHost({ locale: 'en' })
		const wrapper = await mountSurvey(runtime, { host })
		const label = (): string => wrapper.find('label.survey-language-label')
			.text()
		const summary = (): string => wrapper.find('summary')
			.text()

		expect([label(), summary()])
			.toEqual(['Language', 'Response — what a backend reads'])

		host.locale.value = 'zh-TW'
		await flushPromises()
		expect([label(), summary()])
			.toEqual(['語言', '回應——後端讀取的內容'])
		// The survey's own content is in the survey's language (State), not the host locale.
		expect(wrapper.find('h1')
			.text())
			.toBe('Maker Space open day: sign-up')

		host.locale.value = 'en'
		await flushPromises()
		expect([label(), summary()])
			.toEqual(['Language', 'Response — what a backend reads'])
		wrapper.unmount()
	})

	it('follows the host theme through its own data-survey-theme attribute on the root', async () => {
		const { runtime } = createSurveyRuntime()
		const host = createTestHost({ theme: 'dark' })
		const wrapper = await mountSurvey(runtime, { host })

		expect(wrapper.find('.survey')
			.attributes('data-survey-theme'))
			.toBe('dark')

		host.theme.value = 'light'
		await flushPromises()
		expect(wrapper.find('.survey')
			.attributes('data-survey-theme'))
			.toBe('light')
		wrapper.unmount()
	})
})
