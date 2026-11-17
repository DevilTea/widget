import type { Locator, Page } from '@playwright/test'
import { defaultSurveyPreset } from '../src/showcases/survey/presets'
import { expect, expectPreviewStatus, previewFrame, selectShowcase, setLocale, test } from './fixtures'

/**
 * Issue #230 (audit U09): Events are visible in the Lab. The survey's `submit()` Method emits `submitted` once the
 * answers have no errors, so these specs drive the real Preview: the declared Events in the Catalog and in the
 * Selected widget declaration, and the live Events log fed by the Inspector protocol's `runtime.subscribeEvent`.
 *
 * Nothing waits a fixed time: the log says when it is listening (`events-listening`), and a negative claim (not
 * recorded while hidden, while paused) is made after a positive one on the same Runtime that proves the Event
 * was emitted and the log was able to see it.
 */

const SUBMITTED_DESCRIPTION = 'An answer set with no errors was submitted. Carries the response: visible, required, value and errors per question.'

interface LabTestWindow {
	__WIDGET_LAB_TEST__?: { setDraftSourceText: (text: string) => void }
}

async function openLab(page: Page, query = 'lab-test'): Promise<void> {
	await page.goto(`/?${query}`)
	await expect(previewFrame(page)
		.getByRole('heading', { name: 'Maker Space open day: sign-up' }))
		.toBeVisible()
}

async function openEvents(page: Page): Promise<Locator> {
	await eventsTab(page)
		.click()
	await expect(page.getByTestId('events-listening'))
		.toHaveText('Listening to 1 declared Event on 1 widget.')
	return page.getByTestId('events-panel')
}

/** Fills in a valid on-site answer set, without submitting. */
async function answerSurvey(page: Page): Promise<void> {
	const preview = previewFrame(page)
	await preview.getByLabel('On site', { exact: true })
		.check()
	await preview.getByLabel('Guests coming with you')
		.fill('2')
	await preview.getByLabel('3D printing basics')
		.check()
	await preview.getByLabel('Phone number')
		.fill('0912 345 678')
}

async function submit(page: Page): Promise<void> {
	await previewFrame(page)
		.getByRole('button', { name: 'Submit', exact: true })
		.click()
}

/** The Events tab: its accessible name gains " , N new" while entries arrived since it was last visible. */
function eventsTab(page: Page): Locator {
	return page.getByRole('tab', { name: /^Events( , \d+ new)?$/ })
}

const entries = (page: Page): Locator => page.getByTestId('event-entry')

/** Waits until the log holds `count` entries: the Event crossed the iframe boundary over the Inspector protocol. */
async function expectEntries(page: Page, count: number): Promise<void> {
	await expect(entries(page))
		.toHaveCount(count)
}

test.describe('declared Events', () => {
	test('the Catalog lists the Events each plugin declares, with the plugin\'s description verbatim', async ({ page }) => {
		await openLab(page, 'showcase=survey')
		await page.getByRole('tab', { name: 'Catalog' })
			.click()
		const survey = page.getByTestId('author-catalog-Survey')
		const events = survey.getByTestId('declared-event')
		await expect(events)
			.toHaveCount(1)
		await expect(events)
			.toHaveAttribute('data-event', 'submitted')
		await expect(events)
			.toHaveText(`submitted: ${SUBMITTED_DESCRIPTION}`)
		// A plugin without the capability has no Events section.
		await expect(page.getByTestId('author-catalog-SingleChoice')
			.getByTestId('declared-event'))
			.toHaveCount(0)
	})

	test('the Selected widget declaration and Blueprint list them for the widget that declares them', async ({ page }) => {
		await openLab(page, 'showcase=survey')
		await page.getByRole('tab', { name: 'Blueprint', exact: true })
			.click()
		await page.getByRole('button', { name: /open-day : Survey/ })
			.first()
			.click()
		await expect(page.getByTestId('blueprint-node-events'))
			.toContainText('Events (1)')
		await expect(page.getByTestId('blueprint-node-events')
			.getByTestId('declared-event'))
			.toHaveText(`submitted: ${SUBMITTED_DESCRIPTION}`)

		await page.getByRole('tab', { name: 'Selected widget', exact: true })
			.click()
		await expect(page.getByTestId('selected-widget-declaration')
			.getByTestId('declared-event'))
			.toHaveText(`submitted: ${SUBMITTED_DESCRIPTION}`)

		// A widget whose plugin declares no Events says so.
		await page.getByRole('tab', { name: 'Blueprint', exact: true })
			.click()
		await page.getByRole('button', { name: /mode : SingleChoice/ })
			.first()
			.click()
		await page.getByRole('tab', { name: 'Selected widget', exact: true })
			.click()
		await expect(page.getByTestId('selected-widget-declaration')
			.getByTestId('declared-events-none'))
			.toHaveText('No Events capability.')
	})
})

test.describe('events log', () => {
	test('lists the survey\'s submitted Event with its widget, revision and an expandable payload', async ({ page }) => {
		await openLab(page)
		const panel = await openEvents(page)
		await expect(panel.getByTestId('events-empty'))
			.toContainText('No Events yet.')

		// A blocked Submit emits nothing.
		await submit(page)
		await expect(previewFrame(page)
			.getByTestId('survey-submit-diagnostic'))
			.toContainText('Some answers have errors')
		await expectEntries(page, 0)

		await answerSurvey(page)
		await submit(page)
		await expectEntries(page, 1)
		const entry = entries(page)
			.first()
		await expect(entry.getByTestId('event-name'))
			.toHaveText('submitted')
		await expect(entry.getByTestId('event-widget'))
			.toHaveText('open-day : Survey')
		await expect(entry.getByTestId('event-revision'))
			.toHaveText('Preview r0')
		await expect(entry.getByTestId('event-time'))
			.toHaveText(/^\d{2}:\d{2}:\d{2}\.\d{3}$/)
		await expect(entry.getByTestId('event-summary'))
			.toContainText('"mode"')

		await entry.getByTestId('event-expand')
			.click()
		const payload = entry.getByTestId('event-payload')
		await expect(payload)
			.toBeVisible()
		// The payload is the survey's response: the question ids with their answers.
		await expect(payload)
			.toContainText('mode')
		await expect(payload)
			.toContainText('"onsite"')
		// The blocked Submit above is listed too, as a Method failure (see method-failures.spec.ts), so the log now counts entries.
		await expect(panel.getByTestId('events-count'))
			.toHaveText('2 recorded entries')
	})

	test('pauses without recording, resumes, and clears', async ({ page }) => {
		await openLab(page)
		const panel = await openEvents(page)
		await answerSurvey(page)
		await submit(page)
		await expectEntries(page, 1)

		const pause = panel.getByTestId('events-pause')
		await expect(pause)
			.toHaveText('Pause')
		await pause.click()
		// One control: its label says what a click does now, and there is no pressed state to contradict it.
		await expect(pause)
			.toHaveText('Resume')
		await expect(pause)
			.not
			.toHaveAttribute('aria-pressed', /.*/)
		await submit(page)
		await expect(panel.getByTestId('events-paused-note'))
			.toHaveText('Paused: 1 Event was not recorded.')
		await expectEntries(page, 1)

		await pause.click()
		await expect(pause)
			.toHaveText('Pause')
		await submit(page)
		await expectEntries(page, 2)

		await panel.getByTestId('events-clear')
			.click()
		await expectEntries(page, 0)
		await expect(panel.getByTestId('events-live'))
			.toHaveText('Events log cleared')
	})

	test('filters by widget, by Event and by the selected widget, and selecting an entry\'s widget inspects it', async ({ page }) => {
		await openLab(page)
		const panel = await openEvents(page)
		await answerSurvey(page)
		await submit(page)
		await expectEntries(page, 1)

		await panel.getByTestId('events-filter-widget')
			.selectOption('open-day')
		await expectEntries(page, 1)
		await expect(panel.getByTestId('events-filter-event')
			.locator('option'))
			.toHaveText(['All Events', 'submitted'])
		await panel.getByTestId('events-filter-event')
			.selectOption('submitted')
		await expectEntries(page, 1)
		await expect(panel.getByTestId('events-count'))
			.toHaveText('1 of 1 recorded Event shown')
		await panel.getByTestId('events-filter-widget')
			.selectOption('')
		await panel.getByTestId('events-filter-event')
			.selectOption('')

		// Another widget selected in the Preview: its (empty) Events only.
		await page.getByRole('tab', { name: 'Blueprint', exact: true })
			.click()
		await page.getByRole('button', { name: /mode : SingleChoice/ })
			.first()
			.click()
		await eventsTab(page)
			.click()
		await panel.getByTestId('events-only-selected')
			.check()
		await expectEntries(page, 0)
		await expect(panel.getByTestId('events-empty'))
			.toHaveText('No recorded Event matches the filters.')
		await panel.getByTestId('events-only-selected')
			.uncheck()
		await expectEntries(page, 1)

		// Clicking the entry's widget selects it, and "only the selected widget" then shows it again.
		await entries(page)
			.first()
			.getByTestId('event-widget')
			.click()
		await panel.getByTestId('events-only-selected')
			.check()
		await expectEntries(page, 1)
		await page.getByRole('tab', { name: 'Selected widget', exact: true })
			.click()
		await expect(page.getByTestId('selected-widget-declaration')
			.getByRole('heading', { name: 'open-day : Survey' }))
			.toBeVisible()
	})

	test('records while its tab is hidden, counts what arrived on the tab, and has it all when the tab is opened', async ({ page }) => {
		await openLab(page)
		// The Events tab was never opened. The panel is mounted and listening all the same (its DOM is not in the page
		// while hidden, so the tab says whether the log is recording).
		await expect(eventsTab(page)
			.locator('[data-recording]'))
			.toHaveAttribute('data-recording', 'true')
		await answerSurvey(page)
		await submit(page)
		await expect(previewFrame(page)
			.getByTestId('survey-submitted'))
			.toBeVisible()
		await expect(page.getByTestId('events-unseen'))
			.toHaveText('1')
		await expect(eventsTab(page))
			.toHaveAccessibleName('Events , 1 new')

		await eventsTab(page)
			.click()
		await expectEntries(page, 1)
		await expect(page.getByTestId('events-unseen'))
			.toHaveCount(0)
		await expect(eventsTab(page))
			.toHaveAccessibleName('Events')

		// Seen while the tab is open: no count.
		await submit(page)
		await expectEntries(page, 2)
		await expect(page.getByTestId('events-unseen'))
			.toHaveCount(0)

		// Hidden again: recorded, and counted on the tab; the log was not announced Event by Event.
		await page.getByRole('tab', { name: 'Author', exact: true })
			.click()
		await submit(page)
		await expect(page.getByTestId('events-unseen'))
			.toHaveText('1')
		await eventsTab(page)
			.click()
		await expectEntries(page, 3)
		await expect(page.getByTestId('events-unseen'))
			.toHaveCount(0)
	})

	test('listens to the new Preview after Apply, and tags each entry with the revision that emitted it', async ({ page }) => {
		await openLab(page)
		await openEvents(page)
		await answerSurvey(page)
		await submit(page)
		await expectEntries(page, 1)

		const changed = JSON.parse(defaultSurveyPreset.sourceText)
		changed.config.title.en = 'Maker Space open day: sign-up (v2)'
		await page.evaluate((source) => {
			(window as unknown as LabTestWindow).__WIDGET_LAB_TEST__?.setDraftSourceText(source)
		}, JSON.stringify(changed, null, 2))
		await page.getByRole('button', { name: 'Apply', exact: true })
			.click()
		await expectPreviewStatus(page, 'current')
		await expect(previewFrame(page)
			.getByRole('heading', { name: 'Maker Space open day: sign-up (v2)' }))
			.toBeVisible()
		await expect(page.getByTestId('events-listening'))
			.toHaveText('Listening to 1 declared Event on 1 widget.')

		await answerSurvey(page)
		await submit(page)
		await expectEntries(page, 2)
		await expect(entries(page)
			.nth(0)
			.getByTestId('event-revision'))
			.toHaveText('Preview r1')
		await expect(entries(page)
			.nth(1)
			.getByTestId('event-revision'))
			.toHaveText('Preview r0')
	})

	test('says when a Preview declares no Events, and listens to the survey after a showcase switch', async ({ page }) => {
		// The Sandbox (a hidden fixture, opened by URL) declares no Events (it has Methods, whose failures are still recorded); the Examples menu switches to the survey.
		await page.goto('/?showcase=sandbox')
		await expect(eventsTab(page))
			.toBeVisible()
		await eventsTab(page)
			.click()
		const panel = page.getByTestId('events-panel')
		await expect(panel.getByTestId('events-listening'))
			.toHaveText('The widgets in this preview declare no Events. Failed Method calls are still recorded.')
		await expectEntries(page, 0)

		await selectShowcase(page, 'survey')
		await expect(previewFrame(page)
			.getByRole('heading', { name: 'Maker Space open day: sign-up' }))
			.toBeVisible()
		await expect(panel.getByTestId('events-listening'))
			.toHaveText('Listening to 1 declared Event on 1 widget.')
		await answerSurvey(page)
		await submit(page)
		await expectEntries(page, 1)
	})

	test('keeps the Lab chrome out of the Preview and speaks Taiwan Chinese', async ({ page }) => {
		await openLab(page)
		const panel = await openEvents(page)
		await answerSurvey(page)
		await submit(page)
		await expectEntries(page, 1)

		// Nothing of the log is in the Preview document.
		await expect(previewFrame(page)
			.getByTestId('events-panel'))
			.toHaveCount(0)
		await expect(previewFrame(page)
			.getByTestId('event-entry'))
			.toHaveCount(0)

		await setLocale(page, 'zh-TW')
		await expect(panel.getByTestId('events-pause'))
			.toHaveText('暫停')
		await expect(panel.getByTestId('events-count'))
			.toHaveText('已記錄 1 筆 Events')
		// Runtime data is verbatim.
		await expect(entries(page)
			.first()
			.getByTestId('event-name'))
			.toHaveText('submitted')
	})
})
