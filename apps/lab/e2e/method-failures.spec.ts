import type { Locator, Page } from '@playwright/test'
import { expect, previewFrame, test } from './fixtures'

/**
 * Issue #230 (audit U08): a Method failure is visible in the Lab. The survey's `submit()` reports `invalid-method-result`
 * with `reason: 'answer-errors'` while any answer has errors; nothing is emitted, and until Inspector protocol 0.5 the
 * reason existed only inside the Preview. These specs drive the real Preview: the failure is listed in the Events log
 * (labelled as a Method failure, not an Event), shown on the `submit()` row of the Selected widget pane and of the Runtime
 * panel, and cleared there by the next successful Submit.
 *
 * Nothing waits a fixed time: every assertion is a web-first expectation on what the Inspector protocol delivered.
 */

const BLOCKED_EN = 'Some answers have errors. Fix them before submitting.'
const BLOCKED_ZH = '部分答案有錯誤，請修正後再送出。'

async function openLab(page: Page): Promise<void> {
	await page.goto('/?showcase=survey')
	await expect(previewFrame(page)
		.getByRole('heading', { name: 'Maker Space open day: sign-up' }))
		.toBeVisible()
}

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

async function submit(page: Page, name = 'Submit'): Promise<void> {
	await previewFrame(page)
		.getByRole('button', { name, exact: true })
		.click()
}

/** The Events tab is mounted from the start and records while another tab is open; this opens it. */
async function openEvents(page: Page): Promise<void> {
	await page.getByRole('tab', { name: /^Events( , \d+ new)?$/ })
		.click()
	await expect(page.getByTestId('events-listening'))
		.toHaveText('Listening to 1 declared Event on 1 widget.')
	await expect(page.getByTestId('events-methods-listening'))
		.toHaveText(/^Watching \d+ Methods for failed calls\.$/)
}

/** Selects the survey root in the Blueprint tree, then opens the pane that shows its Methods. */
async function selectRoot(page: Page, tab: 'Selected widget' | 'Runtime'): Promise<void> {
	await page.getByRole('tab', { name: 'Blueprint', exact: true })
		.click()
	await page.getByRole('button', { name: /open-day : Survey/ })
		.first()
		.click()
	await page.getByRole('tab', { name: tab, exact: true })
		.click()
}

function submitRow(page: Page, scope: 'selected-widget-runtime' | 'runtime-panel'): Locator {
	// The Runtime panel has no test id of its own: the visible row is the one of the panel whose tab is open.
	const container = scope === 'selected-widget-runtime' ? page.getByTestId(scope) : page
	return container.locator('[data-testid="runtime-method-row"][data-member="submit"]')
		.filter({ visible: true })
}

const failureEntries = (page: Page): Locator => page.getByTestId('method-failure-entry')

test.describe('method failures', () => {
	test('a blocked Submit is listed in the Events log as a Method failure, not as an Event', async ({ page }) => {
		await openLab(page)
		await openEvents(page)
		await submit(page)

		await expect(failureEntries(page))
			.toHaveCount(1)
		const entry = failureEntries(page)
			.first()
		await expect(entry.getByTestId('method-failure-badge'))
			.toHaveText('Method failure')
		await expect(entry.getByTestId('event-widget'))
			.toHaveText('open-day : Survey')
		await expect(entry.getByTestId('method-failure-name'))
			.toHaveText('submit()')
		await expect(entry.getByTestId('method-failure-summary'))
			.toHaveText(`invalid-method-result · answer-errors · ${BLOCKED_EN}`)
		// Not an Event: the submitted Event is not emitted and the Events-only filter hides the entry.
		await expect(page.getByTestId('event-entry'))
			.toHaveCount(0)
		await page.getByTestId('events-filter-kind')
			.selectOption('events')
		await expect(failureEntries(page))
			.toHaveCount(0)
		await page.getByTestId('events-filter-kind')
			.selectOption('method-failures')
		await expect(failureEntries(page))
			.toHaveCount(1)

		await entry.getByTestId('method-failure-expand')
			.click()
		const detail = entry.getByTestId('method-failure-detail')
		await expect(detail.getByTestId('method-diagnostic-code'))
			.toHaveText('invalid-method-result')
		await expect(detail.getByTestId('method-diagnostic-reason'))
			.toHaveText('answer-errors')
		await expect(detail.getByTestId('method-diagnostic-message'))
			.toHaveText(BLOCKED_EN)
		// The returned response is the failure's `result`, as a value tree.
		await expect(detail.getByTestId('method-diagnostic-result'))
			.toBeVisible()
	})

	test('the Selected widget pane and the Runtime panel show the latest failure of submit() and clear it after a successful Submit', async ({ page }) => {
		await openLab(page)
		await submit(page)

		await selectRoot(page, 'Selected widget')
		const selected = submitRow(page, 'selected-widget-runtime')
		await expect(selected.getByTestId('method-status'))
			.toHaveText('Last call failed')
		await expect(selected.getByTestId('method-diagnostic-code'))
			.toHaveText('invalid-method-result')
		await expect(selected.getByTestId('method-diagnostic-reason'))
			.toHaveText('answer-errors')
		await expect(selected.getByTestId('method-diagnostic-message'))
			.toHaveText(BLOCKED_EN)

		await page.getByRole('tab', { name: 'Runtime', exact: true })
			.click()
		const runtime = submitRow(page, 'runtime-panel')
		await expect(runtime.getByTestId('method-status'))
			.toHaveText('Last call failed')
		await expect(runtime.getByTestId('method-diagnostic-message'))
			.toHaveText(BLOCKED_EN)

		// A successful Submit replaces the snapshot: the failure is gone, and the Submitted Event happened.
		await answerSurvey(page)
		await submit(page)
		await expect(previewFrame(page)
			.getByTestId('survey-submitted'))
			.toBeVisible()
		await expect(runtime.getByTestId('method-status'))
			.toHaveText('No failure recorded')
		await expect(runtime.getByTestId('method-diagnostic-message'))
			.toHaveCount(0)
		await page.getByRole('tab', { name: 'Selected widget', exact: true })
			.click()
		await expect(selected.getByTestId('method-status'))
			.toHaveText('No failure recorded')
	})

	test('a failure in the survey language is shown verbatim, and the Events log keeps the earlier one', async ({ page }) => {
		await openLab(page)
		await openEvents(page)
		await submit(page)
		await expect(failureEntries(page))
			.toHaveCount(1)

		await previewFrame(page)
			.getByLabel('Language')
			.selectOption('zh-TW')
		await submit(page, '送出')
		await expect(failureEntries(page))
			.toHaveCount(2)
		// Newest first; the message is Core's text in the survey language, not translated by the Lab.
		await expect(failureEntries(page)
			.first()
			.getByTestId('method-failure-summary'))
			.toHaveText(`invalid-method-result · answer-errors · ${BLOCKED_ZH}`)
		await expect(failureEntries(page)
			.nth(1)
			.getByTestId('method-failure-summary'))
			.toHaveText(`invalid-method-result · answer-errors · ${BLOCKED_EN}`)
		await expect(page.getByTestId('events-count'))
			.toHaveText('2 recorded entries')
	})

	test('a successful Submit after a failure adds the submitted Event next to the failure', async ({ page }) => {
		await openLab(page)
		await openEvents(page)
		await submit(page)
		await expect(failureEntries(page))
			.toHaveCount(1)
		await answerSurvey(page)
		await submit(page)
		await expect(page.getByTestId('event-entry'))
			.toHaveCount(1)
		await expect(failureEntries(page))
			.toHaveCount(1)
		await expect(page.getByTestId('events-count'))
			.toHaveText('2 recorded entries')
	})
})
