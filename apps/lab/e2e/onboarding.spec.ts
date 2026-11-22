import type { Locator, Page } from '@playwright/test'
import { chooseTutorialMenuItem, expect, expectDocumentStatus, expectPreviewStatus, expectShowcase, loadPreset, openAuthorJson, previewFrame, selectShowcase, setLocale, setTheme, test } from './fixtures'

/**
 * Onboarding acceptance contract (issue #230, showcase 3): the Tidepool Makers wizard
 * (`showcases/onboarding/presets.ts`, preset `onboarding-default`) in the Examples menu after the quote rules.
 *
 * Covers selecting it (menu and `?showcase=`); declared Events listed live in the Lab's Events log with their payloads
 * while the page, as the host, listens to the same Events; refused moves as Method failures (not Events) in the Events log
 * and on the Method's row of Selected widget, cleared by a successful call; `validateArgs` (invalid-method-arguments)
 * against `execute` (invalid-method-result); read-only and writing Methods in Relations; the async booking that the
 * host waits for (a simulated office, held by the page's own switch so no spec waits for a timer) and a late answer
 * that is ignored; config diagnostics; theme, accessibility minimums, the guided tour and zh-TW.
 *
 * Nothing here retries an action or waits a fixed time: every wait is for a state the page reaches. The one spec that
 * lets the office answer by itself waits for the answer with a web-first assertion.
 */

async function openOnboarding(page: Page, query = ''): Promise<void> {
	await page.goto(`/?showcase=onboarding${query}`)
	await expect(previewFrame(page)
		.getByRole('heading', { name: 'Welcome to Tidepool Makers', level: 1 }))
		.toBeVisible()
}

/** Opens the wizard on the induction with the first three steps done (preset `onboarding-ready-to-book`). */
async function openReady(page: Page, query = ''): Promise<void> {
	await openOnboarding(page, query)
	await loadPreset(page, 'onboarding-ready-to-book')
	await expect(previewFrame(page)
		.getByRole('heading', { name: 'Book your induction', level: 2 }))
		.toBeVisible()
}

/** The Events tab: its accessible name gains ", N new" while entries arrived since it was last visible. */
async function openEvents(page: Page): Promise<Locator> {
	await page.getByRole('tab', { name: /^Events(, \d+ new)?$/ })
		.click()
	await expect(page.getByTestId('events-listening'))
		.toContainText('declared Events on 2 widgets.')
	await expect(page.getByTestId('events-methods-listening'))
		.toHaveText('Watching 8 Methods for failed calls.')
	return page.getByTestId('events-panel')
}

const eventEntries = (page: Page): Locator => page.getByTestId('event-entry')
const failureEntries = (page: Page): Locator => page.getByTestId('method-failure-entry')

/** Selects a widget in the Blueprint tree and opens the Selected widget pane (or another tab) on it. */
async function selectWidget(page: Page, label: RegExp, tab: 'Selected widget' | 'Runtime' = 'Selected widget'): Promise<void> {
	await page.getByRole('tab', { name: 'Blueprint', exact: true })
		.click()
	await page.getByRole('button', { name: label })
		.first()
		.click()
	await page.getByRole('tab', { name: tab, exact: true })
		.click()
}

function methodRow(page: Page, scope: 'selected-widget-runtime' | 'runtime-panel', member: string): Locator {
	// The Runtime panel has no test id of its own: the visible row is the one of the panel whose tab is open.
	const container = scope === 'selected-widget-runtime' ? page.getByTestId(scope) : page
	return container.locator(`[data-testid="runtime-method-row"][data-member="${member}"]`)
		.filter({ visible: true })
}

async function fillAccount(page: Page): Promise<void> {
	const preview = previewFrame(page)
	await preview.getByLabel('Full name')
		.fill('Sam Rivera')
	await preview.getByLabel('E-mail address')
		.fill('sam@example.org')
}

async function requestSlot(page: Page, date: string, time?: string): Promise<void> {
	const preview = previewFrame(page)
	await preview.getByTestId('induction-date')
		.fill(date)
	if (time !== undefined) {
		await preview.getByTestId('induction-time')
			.selectOption(time)
	}
	await preview.getByTestId('induction-request')
		.click()
}

/** Everything that went wrong on the page, in the Lab and in the Preview frame, that nobody caught. */
function trackUncaughtErrors(page: Page): string[] {
	const errors: string[] = []
	page.on('pageerror', error => errors.push(error.message))
	return errors
}

test.describe('selecting the showcase', () => {
	test('is listed in the Examples menu after the quote rules, and selecting it shows the wizard', async ({ page }) => {
		await page.goto('/')
		await expectShowcase(page, 'survey')

		await page.getByTestId('examples-menu')
			.click()
		const items = page.getByRole('menuitemcheckbox')
		await expect(items.filter({ hasText: 'Onboarding wizard with an Events log' }))
			.toBeVisible()
		await page.keyboard.press('Escape')

		await selectShowcase(page, 'onboarding')
		await expectShowcase(page, 'onboarding')
		await expect(previewFrame(page)
			.getByRole('heading', { name: 'Welcome to Tidepool Makers', level: 1 }))
			.toBeVisible()
		await expect(page.getByTestId('examples-menu'))
			.toHaveAttribute('data-preset-id', 'onboarding-default')
		await expectDocumentStatus(page, { valid: true })
		await expectPreviewStatus(page, 'current')
	})

	test('?showcase=onboarding opens it directly, a reload restores it, and the survey is still the default', async ({ page }) => {
		await openOnboarding(page)
		await expectShowcase(page, 'onboarding')
		await page.reload()
		await expect(previewFrame(page)
			.getByRole('heading', { name: 'Welcome to Tidepool Makers', level: 1 }))
			.toBeVisible()
		await expectShowcase(page, 'onboarding')

		await selectShowcase(page, 'survey')
		await expectShowcase(page, 'survey')
		await expect(previewFrame(page)
			.getByRole('heading', { name: 'Maker Space open day: sign-up' }))
			.toBeVisible()
		await page.goto('/')
		await expectShowcase(page, 'survey')
	})
})

test.describe('Events with a host listener', () => {
	test('a move emits stepChanged: the Events log lists it with its payload, and the page, as the host, heard it and moved focus', async ({ page }) => {
		await openOnboarding(page)
		const panel = await openEvents(page)
		await expect(panel.getByTestId('events-empty'))
			.toBeVisible()
		const preview = previewFrame(page)
		await fillAccount(page)
		await preview.getByTestId('onboarding-next')
			.click()

		// The host heard the same Event, and focus moved to the heading of the step that was entered (checked before
		// the next click, which is in the Lab and would take the focus).
		await expect(preview.getByRole('heading', { name: 'What do you want to make?', level: 2 }))
			.toBeFocused()
		await expect(preview.getByTestId('host-activity-line'))
			.toHaveText('Heard stepChanged: account to interests (next). Moved focus to the step.')

		await expect(eventEntries(page))
			.toHaveCount(1)
		const entry = eventEntries(page)
			.first()
		await expect(entry.getByTestId('event-name'))
			.toHaveText('stepChanged')
		await expect(entry.getByTestId('event-widget'))
			.toHaveText('onboarding : Onboarding')
		await expect(entry.getByTestId('event-summary'))
			.toContainText('interests')
		await entry.getByTestId('event-expand')
			.click()
		const payload = entry.getByTestId('event-payload')
		for (const text of ['from', 'account', 'to', 'interests', 'toIndex', 'by', 'next']) {
			await expect(payload)
				.toContainText(text)
		}
	})

	test('every Event of the wizard is listed with its widget, in order, newest first, and finishing emits completed with every step\'s answers', async ({ page }) => {
		await openReady(page)
		const preview = previewFrame(page)
		await openEvents(page)
		await preview.getByTestId('office-hold')
			.check()
		await requestSlot(page, '2026-12-05', '10:00')
		await expect(eventEntries(page))
			.toHaveCount(1)
		await expect(eventEntries(page)
			.first()
			.getByTestId('event-name'))
			.toHaveText('slotRequested')
		await preview.getByTestId('office-answer-now')
			.click()
		await expect(preview.getByTestId('induction-status'))
			.toHaveAttribute('data-status', 'confirmed')
		await preview.getByTestId('onboarding-finish')
			.click()
		await expect(preview.getByTestId('onboarding-finished'))
			.toBeVisible()

		await expect(eventEntries(page)
			.getByTestId('event-name'))
			.toHaveText(['completed', 'slotConfirmed', 'slotRequested'])
		const completed = eventEntries(page)
			.first()
		await expect(completed.getByTestId('event-widget'))
			.toHaveText('onboarding : Onboarding')
		await completed.getByTestId('event-expand')
			.click()
		for (const text of ['answers', 'Sam Rivera', 'sam@example.org', 'woodwork', 'TM-20261205-1000']) {
			await expect(completed.getByTestId('event-payload'))
				.toContainText(text)
		}
		await expect(preview.getByTestId('host-activity-line')
			.last())
			.toHaveText('Heard completed. Queued a welcome message to sam@example.org.')
	})

	test('after Finish focus is on the finished card\'s heading, and after Start over on the step\'s heading (no stepChanged is emitted for either)', async ({ page }) => {
		await openReady(page)
		const preview = previewFrame(page)
		await preview.getByTestId('office-hold')
			.check()
		await requestSlot(page, '2026-12-05', '10:00')
		await preview.getByTestId('office-answer-now')
			.click()
		await expect(preview.getByTestId('induction-status'))
			.toHaveAttribute('data-status', 'confirmed')
		await preview.getByTestId('onboarding-finish')
			.click()
		await expect(preview.getByRole('heading', { name: /^You are on the list/, level: 2 }))
			.toBeFocused()
		await preview.getByTestId('onboarding-start-over')
			.click()
		await expect(preview.getByRole('heading', { name: 'Book your induction', level: 2 }))
			.toBeFocused()
	})

	test('the declared Events are listed in Selected widget, with the plugin\'s own description', async ({ page }) => {
		await openOnboarding(page)
		await selectWidget(page, /induction : InductionStep/)
		const events = page.getByTestId('selected-widget-declaration')
			.getByTestId('declared-event')
		await expect(events)
			.toHaveCount(4)
		await expect(events)
			.toHaveText([
				'slotRequested: The visitor asked for an induction slot. Carries the request, with the ticket the host must hand back with its answer.',
				'slotConfirmed: The booking office confirmed the slot of the newest request. Carries the request and the booking reference.',
				'slotDeclined: The booking office declined the slot of the newest request. Carries the request and the reason.',
				'slotCancelled: The visitor cancelled a request that was waiting, or a booking that was confirmed. Carries the request and whether it had been confirmed.',
			])
	})
})

test.describe('refused moves are Method failures', () => {
	test('Next on an empty form is refused: one alert on the page, a Method failure (not an Event) in the Events log, and a successful Next clears them', async ({ page }) => {
		await openOnboarding(page)
		await openEvents(page)
		const preview = previewFrame(page)
		await preview.getByTestId('onboarding-next')
			.click()

		await expect(preview.getByRole('alert'))
			.toHaveCount(1)
		await expect(preview.getByTestId('onboarding-problem'))
			.toContainText('next() was refused')
		await expect(preview.getByTestId('onboarding-problem-code'))
			.toHaveText('invalid-method-result · step-incomplete')

		await expect(failureEntries(page))
			.toHaveCount(1)
		const entry = failureEntries(page)
			.first()
		await expect(entry.getByTestId('method-failure-badge'))
			.toHaveText('Method failure')
		await expect(entry.getByTestId('event-widget'))
			.toHaveText('onboarding : Onboarding')
		await expect(entry.getByTestId('method-failure-name'))
			.toHaveText('next()')
		await expect(entry.getByTestId('method-failure-summary'))
			.toHaveText('invalid-method-result · step-incomplete · The "account" step is not complete yet: name, email.')
		// Nothing was emitted: no Event, and the page did not move.
		await expect(eventEntries(page))
			.toHaveCount(0)
		await expect(preview.getByTestId('onboarding-progress'))
			.toHaveText('Step 1 of 4')

		await fillAccount(page)
		await preview.getByTestId('onboarding-next')
			.click()
		await expect(preview.getByRole('alert'))
			.toHaveCount(0)
		await expect(eventEntries(page))
			.toHaveCount(1)

		// The Selected widget row of next() shows the failure as long as it is the latest call, and says it is gone after.
		await selectWidget(page, /onboarding : Onboarding/)
		await expect(methodRow(page, 'selected-widget-runtime', 'next')
			.getByTestId('method-status'))
			.toHaveText('No failure recorded')
	})

	test('the Selected widget pane and the Runtime panel show the latest failure of a Method, with its code, reason and message', async ({ page }) => {
		await openOnboarding(page)
		await previewFrame(page)
			.getByTestId('onboarding-next')
			.click()
		await expect(previewFrame(page)
			.getByTestId('onboarding-problem'))
			.toBeVisible()

		await selectWidget(page, /onboarding : Onboarding/)
		const selected = methodRow(page, 'selected-widget-runtime', 'next')
		await expect(selected.getByTestId('method-status'))
			.toHaveText('Last call failed')
		await expect(selected.getByTestId('method-diagnostic-code'))
			.toHaveText('invalid-method-result')
		await expect(selected.getByTestId('method-diagnostic-reason'))
			.toHaveText('step-incomplete')
		await expect(selected.getByTestId('method-diagnostic-message'))
			.toHaveText('The "account" step is not complete yet: name, email.')
		// A Method that has not failed says so.
		await expect(methodRow(page, 'selected-widget-runtime', 'back')
			.getByTestId('method-status'))
			.toHaveText('No failure recorded')

		await page.getByRole('tab', { name: 'Runtime', exact: true })
			.click()
		await expect(methodRow(page, 'runtime-panel', 'next')
			.getByTestId('method-diagnostic-message'))
			.toHaveText('The "account" step is not complete yet: name, email.')
	})

	test('the deep-link preset opens on the last step: Finish is refused, going back works, and a locked step is refused', async ({ page }) => {
		await openOnboarding(page)
		await loadPreset(page, 'onboarding-deep-link')
		const preview = previewFrame(page)
		await expect(preview.getByRole('heading', { name: 'Book your induction', level: 2 }))
			.toBeVisible()
		await openEvents(page)
		await preview.getByTestId('onboarding-finish')
			.click()
		await expect(preview.getByTestId('onboarding-problem-code'))
			.toHaveText('invalid-method-result · steps-incomplete')
		await expect(failureEntries(page)
			.first()
			.getByTestId('method-failure-name'))
			.toHaveText('finish()')

		await preview.getByTestId('onboarding-step-interests')
			.click()
		await expect(preview.getByTestId('onboarding-problem-code'))
			.toHaveText('invalid-method-result · step-locked')
		await expect(preview.getByRole('alert'))
			.toHaveCount(1)

		await preview.getByTestId('onboarding-step-account')
			.click()
		await expect(preview.getByRole('heading', { name: 'Your details', level: 2 }))
			.toBeFocused()
		await expect(preview.getByRole('alert'))
			.toHaveCount(0)
		await expect(eventEntries(page))
			.toHaveCount(1)
		await expect(eventEntries(page)
			.first()
			.getByTestId('event-name'))
			.toHaveText('stepChanged')
	})
})

test.describe('argument validation', () => {
	test('goTo(index) is validated before it runs: invalid-method-arguments for what is not a whole number, invalid-method-result for the rest', async ({ page }) => {
		await openOnboarding(page)
		await openEvents(page)
		const preview = previewFrame(page)
		const code = preview.getByTestId('onboarding-problem-code')

		async function jump(typed: string): Promise<void> {
			await preview.getByTestId('onboarding-jump-input')
				.fill(typed)
			await preview.getByTestId('onboarding-jump-go')
				.click()
		}

		await jump('1.5')
		await expect(code)
			.toHaveText('invalid-method-arguments · not-a-whole-number')
		await expect(preview.getByTestId('onboarding-problem'))
			.toContainText('The step number must be a whole number.')
		await jump('9')
		await expect(code)
			.toHaveText('invalid-method-result · no-such-step')
		await jump('2')
		await expect(code)
			.toHaveText('invalid-method-result · step-locked')
		await expect(preview.getByRole('alert'))
			.toHaveCount(1)

		// Each failure replaced the one before in the Method's snapshot, and the log lists them in order, newest first.
		await expect(failureEntries(page))
			.toHaveCount(3)
		await expect(failureEntries(page)
			.getByTestId('method-failure-summary'))
			.toHaveText([
				'invalid-method-result · step-locked · Step 2 ("safety") is locked: finish the steps before it first.',
				'invalid-method-result · no-such-step · There is no step 9: the wizard has 4 steps (0 to 3).',
				'invalid-method-arguments · not-a-whole-number · goTo(index): index must be a whole number, got 1.5.',
			])
		await failureEntries(page)
			.last()
			.getByTestId('method-failure-expand')
			.click()
		await expect(failureEntries(page)
			.last()
			.getByTestId('method-diagnostic-code'))
			.toHaveText('invalid-method-arguments')

		// A call that works clears the failure on the Method's row.
		await jump('0')
		await expect(preview.getByRole('alert'))
			.toHaveCount(0)
		await selectWidget(page, /onboarding : Onboarding/)
		await expect(methodRow(page, 'selected-widget-runtime', 'goTo')
			.getByTestId('method-status'))
			.toHaveText('No failure recorded')
	})

	test('requestSlot validates the date against the config: an empty and an unoffered date are invalid-method-arguments, and nothing is requested', async ({ page }) => {
		await openReady(page)
		const preview = previewFrame(page)
		await openEvents(page)
		await preview.getByTestId('induction-request')
			.click()
		await expect(preview.getByTestId('onboarding-problem-code'))
			.toHaveText('invalid-method-arguments · invalid-date')
		await requestSlot(page, '2026-12-06')
		await expect(preview.getByTestId('onboarding-problem-code'))
			.toHaveText('invalid-method-arguments · date-not-offered')
		await expect(preview.getByTestId('onboarding-problem'))
			.toContainText('Inductions are not offered on that date.')
		await expect(failureEntries(page))
			.toHaveCount(2)
		await expect(failureEntries(page)
			.first()
			.getByTestId('method-failure-summary'))
			.toHaveText('invalid-method-arguments · date-not-offered · requestSlot: 2026-12-06 is not a day inductions are offered. Offered: 2026-12-05, 2026-12-12, 2026-12-19.')
		await expect(eventEntries(page))
			.toHaveCount(0)
		await expect(preview.getByTestId('induction-status'))
			.toHaveAttribute('data-status', 'idle')

		await requestSlot(page, '2026-12-05')
		await expect(preview.getByRole('alert'))
			.toHaveCount(0)
		await expect(eventEntries(page))
			.toHaveCount(1)
	})
})

test.describe('read-only and writing Methods in Relations', () => {
	test('canEnter is read-only (no W, no E) while the Methods that write State and emit Events carry both', async ({ page }) => {
		await openOnboarding(page)
		await selectWidget(page, /onboarding : Onboarding/, 'Runtime')
		// Focus the Property the Methods read: Relations then lists them as its consumers.
		await page.locator('[data-testid="runtime-value-row"]')
			.filter({ visible: true })
			.filter({ hasText: 'progress' })
			.first()
			.click()
		await page.getByRole('tab', { name: 'Dependencies', exact: true })
			.click()
		const relations = page.locator('.dependencies-relations-view')
		const writes = relations.getByTitle('Writes State directly or through the Methods it invokes')
		const emits = relations.getByTitle('Emits an Event directly or through the Methods it invokes')

		await relations.getByTitle('Focus method canEnter in Onboarding #onboarding')
			.click()
		await expect(relations.getByText('Focused member'))
			.toBeVisible()
		await expect(writes)
			.toHaveCount(0)
		await expect(emits)
			.toHaveCount(0)

		for (const name of ['next', 'goTo', 'finish']) {
			// Back to the Property, then to the Method: Relations shows the focused member's own flags.
			await page.getByRole('tab', { name: 'Runtime', exact: true })
				.click()
			await page.locator('[data-testid="runtime-value-row"]')
				.filter({ visible: true })
				.filter({ hasText: 'progress' })
				.first()
				.click()
			await page.getByRole('tab', { name: 'Dependencies', exact: true })
				.click()
			await relations.getByTitle(`Focus method ${name} in Onboarding #onboarding`)
				.click()
			await expect(writes, name)
				.toHaveText('W writes')
			await expect(emits, name)
				.toHaveText('E emits')
		}
	})
})

test.describe('async work kept at the host', () => {
	test('requesting returns at once with a ticket; the host waits for the office and settles through the Method, so Events and State follow', async ({ page }) => {
		await openReady(page)
		const preview = previewFrame(page)
		await openEvents(page)
		await preview.getByTestId('office-hold')
			.check()
		await requestSlot(page, '2026-12-12', '14:00')

		// The widget does not wait: the request is in State and with the office, and the host's list says what it did.
		await expect(preview.getByTestId('induction-status'))
			.toHaveAttribute('data-status', 'requesting')
		await expect(preview.getByTestId('induction-status'))
			.toContainText('Request #1')
		await expect(preview.getByTestId('office-request'))
			.toHaveCount(1)
		await expect(eventEntries(page))
			.toHaveCount(1)
		const requested = eventEntries(page)
			.first()
		await expect(requested.getByTestId('event-name'))
			.toHaveText('slotRequested')
		await expect(requested.getByTestId('event-widget'))
			.toHaveText('induction : InductionStep')
		await requested.getByTestId('event-expand')
			.click()
		for (const text of ['ticket', '2026-12-12', '14:00']) {
			await expect(requested.getByTestId('event-payload'))
				.toContainText(text)
		}

		// A second request while one waits is refused by the Method.
		await requestSlot(page, '2026-12-12', '10:00')
		await expect(preview.getByTestId('onboarding-problem-code'))
			.toHaveText('invalid-method-result · booking-in-progress')

		await preview.getByTestId('office-answer-now')
			.click()
		await expect(preview.getByTestId('induction-status'))
			.toHaveAttribute('data-status', 'confirmed')
		await expect(preview.getByTestId('induction-status'))
			.toContainText('Reference TM-20261212-1400')
		await expect(eventEntries(page)
			.first()
			.getByTestId('event-name'))
			.toHaveText('slotConfirmed')
		await expect(preview.getByTestId('host-activity-line')
			.last())
			.toHaveText('settleBooking(1) applied the answer.')

		await selectWidget(page, /induction : InductionStep/, 'Runtime')
		await expect(page.locator('[data-testid="runtime-value-row"][data-member="reference"]')
			.filter({ visible: true }))
			.toContainText('TM-20261212-1400')
	})

	test('left alone, the office answers by itself and the page shows the result (the host\'s own wait)', async ({ page }) => {
		await openReady(page)
		const preview = previewFrame(page)
		await requestSlot(page, '2026-12-05', '10:00')
		await expect(preview.getByTestId('induction-status'))
			.toHaveAttribute('data-status', 'confirmed')
		await expect(preview.getByTestId('induction-status'))
			.toContainText('Reference TM-20261205-1000')
	})

	test('the office declines 17:00: slotDeclined is emitted, the reason is shown, and another slot can be asked for', async ({ page }) => {
		await openReady(page)
		const preview = previewFrame(page)
		await openEvents(page)
		await preview.getByTestId('office-hold')
			.check()
		await requestSlot(page, '2026-12-05', '17:00')
		await preview.getByTestId('office-answer-now')
			.click()
		await expect(preview.getByTestId('induction-status'))
			.toHaveAttribute('data-status', 'declined')
		await expect(preview.getByTestId('induction-status'))
			.toContainText('it is fully booked')
		await expect(eventEntries(page)
			.getByTestId('event-name'))
			.toHaveText(['slotDeclined', 'slotRequested'])
		await expect(preview.getByTestId('onboarding-finish'))
			.toBeVisible()
		await preview.getByTestId('onboarding-finish')
			.click()
		await expect(preview.getByTestId('onboarding-problem-code'))
			.toHaveText('invalid-method-result · steps-incomplete')

		await requestSlot(page, '2026-12-05', '10:00')
		await preview.getByTestId('office-answer-now')
			.click()
		await expect(preview.getByTestId('induction-status'))
			.toHaveAttribute('data-status', 'confirmed')
	})

	test('cancelling emits slotCancelled and the host recalls the request: no answer is ever written', async ({ page }) => {
		await openReady(page)
		const preview = previewFrame(page)
		await openEvents(page)
		await preview.getByTestId('office-hold')
			.check()
		await requestSlot(page, '2026-12-05', '10:00')
		await preview.getByTestId('induction-cancel')
			.click()
		await expect(preview.getByTestId('induction-status'))
			.toHaveAttribute('data-status', 'idle')
		await expect(preview.getByTestId('office-request'))
			.toHaveCount(0)
		await expect(eventEntries(page)
			.getByTestId('event-name'))
			.toHaveText(['slotCancelled', 'slotRequested'])
		await expect(preview.getByTestId('host-activity-line')
			.last())
			.toHaveText('Heard slotCancelled for #1. Recalled the request: no answer will come.')
	})

	test('an office that cannot recall answers late, and the ticket makes the Method ignore that answer', async ({ page }) => {
		await openReady(page)
		const preview = previewFrame(page)
		await openEvents(page)
		await preview.getByTestId('office-hold')
			.check()
		await preview.getByTestId('office-recall')
			.uncheck()
		await requestSlot(page, '2026-12-05', '10:00')
		await preview.getByTestId('induction-cancel')
			.click()
		await requestSlot(page, '2026-12-12', '14:00')
		await expect(preview.getByTestId('office-request'))
			.toHaveCount(2)

		// The answer to the first, cancelled request arrives while the second is the one that matters.
		await preview.getByTestId('office-answer-now')
			.first()
			.click()
		await expect(preview.getByTestId('host-activity-line')
			.last())
			.toHaveText('settleBooking(1) ignored the answer: ticket #1 is no longer the newest.')
		await expect(preview.getByTestId('induction-status'))
			.toHaveAttribute('data-status', 'requesting')
		// Nothing was emitted for it: the newest entries are still the second request and the cancellation.
		await expect(eventEntries(page)
			.getByTestId('event-name'))
			.toHaveText(['slotRequested', 'slotCancelled', 'slotRequested'])

		await preview.getByTestId('office-answer-now')
			.click()
		await expect(preview.getByTestId('induction-status'))
			.toContainText('Reference TM-20261212-1400')
		await expect(eventEntries(page)
			.first()
			.getByTestId('event-name'))
			.toHaveText('slotConfirmed')
	})

	test('switching showcase with a request pending cancels it: nothing is written to the disposed Runtime and nothing is thrown', async ({ page }) => {
		const errors = trackUncaughtErrors(page)
		await openReady(page)
		const preview = previewFrame(page)
		await preview.getByTestId('office-hold')
			.check()
		await requestSlot(page, '2026-12-05', '10:00')
		await expect(preview.getByTestId('office-request'))
			.toHaveCount(1)

		await selectShowcase(page, 'survey')
		await expect(previewFrame(page)
			.getByRole('heading', { name: 'Maker Space open day: sign-up' }))
			.toBeVisible()
		await selectShowcase(page, 'onboarding')
		await expect(previewFrame(page)
			.getByRole('heading', { name: 'Welcome to Tidepool Makers', level: 1 }))
			.toBeVisible()
		// A fresh wizard: nothing of the old request is left.
		await expect(previewFrame(page)
			.getByTestId('office-request'))
			.toHaveCount(0)
		expect(errors)
			.toEqual([])
	})
})

test.describe('config diagnostics', () => {
	test('the invalid preset has four located problems, and the preview keeps the last working wizard', async ({ page }) => {
		await openOnboarding(page)
		await loadPreset(page, 'onboarding-invalid')
		await expectDocumentStatus(page, { problems: 4 })
		await expectPreviewStatus(page, 'stale')
		await expect(previewFrame(page)
			.getByRole('heading', { name: 'Welcome to Tidepool Makers', level: 1 }))
			.toBeVisible()
		// Author opens on Structure: the Problems list is under the JSON editor.
		await openAuthorJson(page)
		const problems = page.getByTestId('author-problems')
		await expect(problems)
			.toHaveAttribute('data-problem-count', '4')
		await expect(problems)
			.toContainText('config.minimum is 9, but only 5 options exist: nobody could complete this step.')
		await expect(problems)
			.toContainText('config.acknowledged.0 names "helmet", which is not one of: shoes, machines, exits.')
		await expect(problems)
			.toContainText('config.days.1 must be a real date written YYYY-MM-DD, got "2026-02-30".')
		await expect(problems)
			.toContainText('startStep is 7, but the wizard has 4 steps (0 to 3).')
	})
})

test.describe('theme', () => {
	test('paints from its own tokens and follows the Lab theme, light and dark', async ({ page }) => {
		await openOnboarding(page)
		const root = previewFrame(page)
			.locator('.onboarding')
		const background = (): Promise<string> => root.evaluate(element => getComputedStyle(element).backgroundColor)

		await setTheme(page, 'light')
		await expect(root)
			.toHaveAttribute('data-onboarding-theme', 'light')
		expect(await background())
			.toBe('rgb(246, 247, 249)')

		await setTheme(page, 'dark')
		await expect(root)
			.toHaveAttribute('data-onboarding-theme', 'dark')
		expect(await background())
			.toBe('rgb(20, 22, 26)')
	})
})

test.describe('accessibility minimums', () => {
	test('every control is labelled and at least 24px, text is at least 11px, there is one main landmark, one alert at a time, and focus is visible', async ({ page }) => {
		await openReady(page)
		const preview = previewFrame(page)

		// Keyboard first: a focused control shows a focus ring.
		const request = preview.getByTestId('induction-request')
		await request.focus()
		const outline = await request.evaluate(element => getComputedStyle(element).outlineStyle)
		expect(outline)
			.not
			.toBe('none')

		// Two refusals from two widgets in a row never leave two alerts on the page.
		await request.click()
		await expect(preview.getByRole('alert'))
			.toHaveCount(1)
		await preview.getByTestId('onboarding-jump-input')
			.fill('1.5')
		await preview.getByTestId('onboarding-jump-go')
			.click()
		await expect(preview.getByTestId('onboarding-problem-code'))
			.toHaveText('invalid-method-arguments · not-a-whole-number')
		await expect(preview.getByRole('alert'))
			.toHaveCount(1)
		await expect(preview.locator('[aria-live]'))
			.toHaveCount(0)

		const controls = preview.locator('input, select, button')
		expect(await controls.count())
			.toBeGreaterThan(8)
		const problems = await controls.evaluateAll(elements => elements.flatMap((element) => {
			const box = element.getBoundingClientRect()
			const labelled = element.tagName === 'BUTTON'
				? (element.textContent ?? '').trim() !== ''
				: ((element as HTMLInputElement).labels?.length ?? 0) > 0
			const issues: string[] = []
			if (!labelled)
				issues.push('unlabelled')
			// A checkbox is 18px but its label is the target; the label is at least 28px tall.
			const target = element instanceof HTMLInputElement && element.type === 'checkbox' ? element.labels?.[0]?.getBoundingClientRect() ?? box : box
			if (target.height < 24 || target.width < 24)
				issues.push(`target ${Math.round(target.width)}x${Math.round(target.height)}`)
			return issues.length === 0 ? [] : [`${element.outerHTML.slice(0, 80)}: ${issues.join(', ')}`]
		}))
		expect(problems)
			.toEqual([])

		const font = await preview.locator('.onboarding')
			.evaluateAll((roots) => {
				const sizes = new Set<number>()
				for (const element of roots[0]!.querySelectorAll('*')) {
					if ((element.textContent ?? '').trim() !== '' && element.children.length === 0)
						sizes.add(Number.parseFloat(getComputedStyle(element).fontSize))
				}
				return Math.min(...sizes)
			})
		expect(font)
			.toBeGreaterThanOrEqual(11)

		await expect(preview.getByRole('main'))
			.toHaveCount(1)
		await expect(preview.getByRole('heading', { level: 1 }))
			.toHaveCount(1)
		await expect(preview.getByRole('navigation', { name: 'Steps' }))
			.toBeVisible()
	})
})

test.describe('tutorial', () => {
	const RAIL = 'Tutorial'

	test('walks Events, a refused move, argument validation and the async booking with real interactions, then restarts', async ({ page }) => {
		await openOnboarding(page)
		await chooseTutorialMenuItem(page)
		const rail = page.getByRole('complementary', { name: RAIL })
		await expect(rail)
			.toBeVisible()
		const next = page.getByRole('button', { name: 'Next', exact: true })
		const preview = previewFrame(page)

		// 1 orient, 2 declared Events
		await expect(rail.getByText('This is a new-member onboarding wizard', { exact: false }))
			.toBeVisible()
		await expect(next)
			.toBeEnabled()
		await next.click()
		await expect(rail.getByText('Two plugins declare Events', { exact: false }))
			.toBeVisible()
		await rail.getByRole('button', { name: 'See the declared Events in Selected widget' })
			.click()
		await expect(page.getByRole('tab', { name: 'Selected widget', exact: true }))
			.toHaveAttribute('aria-selected', 'true')
		await next.click()

		// 3 a move that emits an Event
		const moveObservation = rail.getByText('Next wrote State current and emitted stepChanged', { exact: false })
		await expect(moveObservation)
			.toHaveCount(0)
		await expect(next)
			.toBeDisabled()
		await expect(preview.locator('[data-tutorial-target="onboarding-actions"]'))
			.toHaveClass(/tutorial-spotlight/)
		await fillAccount(page)
		await preview.getByTestId('onboarding-next')
			.click()
		await expect(moveObservation)
			.toBeVisible()
		await rail.getByRole('button', { name: 'Open the Events tab' })
			.click()
		await expect(page.getByRole('tab', { name: /^Events/ }))
			.toHaveAttribute('aria-selected', 'true')
		await expect(eventEntries(page))
			.toHaveCount(1)
		await next.click()

		// 4 a refused move: the visitor loads the deep-link preset, then presses Finish.
		const refusedObservation = rail.getByText('The wizard opened on the last step with nothing filled in.', { exact: false })
		await expect(refusedObservation)
			.toHaveCount(0)
		await loadPreset(page, 'onboarding-deep-link')
		await expect(refusedObservation)
			.toBeVisible()
		await preview.getByTestId('onboarding-finish')
			.click()
		await expect(preview.getByTestId('onboarding-problem-code'))
			.toHaveText('invalid-method-result · steps-incomplete')
		await expect(failureEntries(page))
			.toHaveCount(1)
		await next.click()

		// 5 argument validation
		await expect(rail.getByText('Type 1.5 and press Go: invalid-method-arguments', { exact: false }))
			.toBeVisible()
		await expect(preview.locator('[data-tutorial-target="onboarding-jump"]'))
			.toHaveClass(/tutorial-spotlight/)
		// Done here, in the state the previous step left (the deep-link wizard on its last step): the three numbers the text names
		// give the three codes it names (the step the visitor is on, 3, would be no failure at all).
		for (const [typed, expected] of [
			['1.5', 'invalid-method-arguments · not-a-whole-number'],
			['9', 'invalid-method-result · no-such-step'],
			['2', 'invalid-method-result · step-locked'],
		] as const) {
			await preview.getByTestId('onboarding-jump-input')
				.fill(typed)
			await preview.getByTestId('onboarding-jump-go')
				.click()
			await expect(preview.getByTestId('onboarding-problem-code'), typed)
				.toHaveText(expected)
		}
		await expect(preview.getByRole('alert'))
			.toHaveCount(1)
		await next.click()

		// 6 booking is asynchronous work: the visitor loads the ready-to-book preset.
		const asyncObservation = rail.getByText('The first three steps are already complete', { exact: false })
		await expect(asyncObservation)
			.toHaveCount(0)
		await loadPreset(page, 'onboarding-ready-to-book')
		await expect(asyncObservation)
			.toBeVisible()
		await next.click()

		// 7 the widget asks, the host waits
		const bookingObservation = rail.getByText('requestSlot returned at once, with a ticket', { exact: false })
		await expect(bookingObservation)
			.toHaveCount(0)
		await expect(next)
			.toBeDisabled()
		await expect(preview.locator('[data-tutorial-target="onboarding-induction-status"]'))
			.toHaveClass(/tutorial-spotlight/)
		await preview.getByTestId('office-hold')
			.check()
		await requestSlot(page, '2026-12-05', '10:00')
		await expect(bookingObservation)
			.toHaveCount(0)
		await preview.getByTestId('office-answer-now')
			.click()
		await expect(bookingObservation)
			.toBeVisible()
		await next.click()

		// 8 a late answer is ignored: it opens when the booking is cancelled.
		const staleObservation = rail.getByText('Every request has a ticket, kept in State', { exact: false })
		await expect(staleObservation)
			.toHaveCount(0)
		await preview.getByTestId('induction-cancel')
			.click()
		await expect(staleObservation)
			.toBeVisible()
		await next.click()

		// 9 map the views, 10 hand back
		await expect(rail.getByText('Dependencies (Relations, Graph)', { exact: false }))
			.toBeVisible()
		await rail.getByRole('button', { name: 'Runtime', exact: true })
			.click()
		await expect(page.getByRole('tab', { name: 'Runtime', exact: true }))
			.toHaveAttribute('aria-selected', 'true')
		await next.click()
		await page.getByRole('button', { name: 'Finish', exact: true })
			.click()
		await expect(rail)
			.toHaveCount(0)

		// Completed: the header offers a restart, which reloads the teaching example.
		await chooseTutorialMenuItem(page, 'Restart tutorial')
		await expect(page.getByRole('complementary', { name: RAIL }))
			.toBeVisible()
		await expect(preview.getByTestId('onboarding-progress'))
			.toHaveText('Step 1 of 4')
		await expect(preview.getByLabel('Full name'))
			.toHaveValue('')
	})

	test('starting it from the quote runs the quote tour, and leaving the wizard ends the onboarding tour', async ({ page }) => {
		await page.goto('/?showcase=quote-rules')
		await chooseTutorialMenuItem(page)
		await expect(page.getByRole('complementary', { name: RAIL })
			.getByRole('heading', { name: 'This is the Quote rules showcase' }))
			.toBeVisible()
		await page.getByRole('button', { name: 'Skip tour', exact: true })
			.click()

		await selectShowcase(page, 'onboarding')
		await chooseTutorialMenuItem(page)
		const rail = page.getByRole('complementary', { name: RAIL })
		await expect(rail.getByRole('heading', { name: 'This is the Onboarding showcase' }))
			.toBeVisible()

		await selectShowcase(page, 'survey')
		await expect(rail)
			.toHaveCount(0)
	})
})

test.describe('zh-TW', () => {
	test('translates the Examples menu entries, the tutorial and the Preview, while the wizard\'s own texts follow the Lab language', async ({ page }) => {
		await page.goto('/?showcase=onboarding&lang=zh-TW')
		const preview = previewFrame(page)
		await expect(preview.getByRole('heading', { name: '歡迎加入潮池工坊', level: 1 }))
			.toBeVisible()
		await expect(page.getByTestId('examples-showcase'))
			.toHaveText('新成員引導精靈：Events 與 Method 診斷')
		await expect(preview.getByTestId('onboarding-progress'))
			.toHaveText('第 1 步，共 4 步')
		await expect(preview.getByRole('heading', { name: '你的資料', level: 2 }))
			.toBeVisible()
		await preview.getByTestId('onboarding-next')
			.click()
		await expect(preview.getByTestId('onboarding-problem'))
			.toContainText('這一步還沒完成')
		// The Core code and reason are not translated.
		await expect(preview.getByTestId('onboarding-problem-code'))
			.toHaveText('invalid-method-result · step-incomplete')

		await page.getByTestId('examples-menu')
			.click()
		for (const name of ['預設——潮池工坊新成員引導', '準備預約——只剩新手導覽', '深層連結——直接開在第 4 步，什麼都還沒填', '有錯誤的草稿——四個問題']) {
			await expect(page.getByRole('menuitemcheckbox', { name }))
				.toBeVisible()
		}
		await page.keyboard.press('Escape')

		await chooseTutorialMenuItem(page, '教學')
		const rail = page.getByRole('complementary', { name: '教學' })
		await expect(rail.getByText('這是一個新成員引導精靈', { exact: false }))
			.toBeVisible()
		await page.getByRole('button', { name: '下一步', exact: true })
			.click()
		await expect(rail.getByText('有兩個 plugin 宣告了 Events', { exact: false }))
			.toBeVisible()
		await setLocale(page, 'en')
		await expect(page.getByRole('complementary', { name: 'Tutorial' })
			.getByText('Two plugins declare Events', { exact: false }))
			.toBeVisible()
		await expect(preview.getByTestId('onboarding-progress'))
			.toHaveText('Step 1 of 4')
	})
})
