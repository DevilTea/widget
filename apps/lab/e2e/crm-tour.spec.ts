import type { Page } from '@playwright/test'
import { expect, test } from './fixtures'

/**
 * Issue #25 P4 CRM tour contract — a new file (rather than extending `tutorial.spec.ts`) for suite
 * hygiene: this file's fixtures/entry helpers are CRM-tour-specific (the deterministic-start seam, the
 * "mark Survey completed" seam), separate from `tutorial.spec.ts`'s Survey-only helpers.
 *
 * `fixtures.ts` pre-dismisses the Welcome card for every test here (same mechanism `tutorial.spec.ts`
 * relies on) — the CRM tour is never reachable from Welcome anyway (locked policy: Welcome only ever
 * offers Survey), so none of these tests need to opt out of that.
 */

const RAIL_LABEL = 'Tutorial'

/**
 * Seeds the exact session flag `session-flags.ts`'s `markTourCompleted('survey')` writes — the same
 * technique `tutorial.spec.ts`'s `welcomeDismissed` fixture option uses (seed the real flag the app
 * itself reads, via `page.addInitScript()`), so these tests can exercise "the header tour-picker after
 * Survey completion" and the CRM tour itself directly, without re-running Survey's own 9-step walkthrough
 * (already covered end-to-end by `tutorial.spec.ts`) just to reach the unlocked state.
 */
async function markSurveyCompletedThisSession(page: Page): Promise<void> {
	await page.addInitScript(() => {
		sessionStorage.setItem('widget-lab:tutorial:completed:survey', '1')
	})
}

async function startCrmTourFromHeader(page: Page): Promise<void> {
	await markSurveyCompletedThisSession(page)
	await page.goto('/')
	await page.getByLabel('Choose tutorial')
		.selectOption('crm')
	await page.getByRole('button', { name: 'Tutorial', exact: true })
		.click()
	await expect(page.getByRole('complementary', { name: RAIL_LABEL }))
		.toBeVisible()
}

test.describe('CRM tour entry', () => {
	test('the header tour-picker does not appear before Survey has ever been completed this session', async ({ page }) => {
		await page.goto('/')
		await expect(page.getByLabel('Choose tutorial'))
			.toHaveCount(0)
		await expect(page.getByRole('button', { name: 'Tutorial', exact: true }))
			.toBeVisible()
	})

	test('once Survey has been completed this session, the header tour-picker offers both tours and starts CRM through the deterministic-start pipeline', async ({ page }) => {
		await markSurveyCompletedThisSession(page)
		await page.goto('/')

		const picker = page.getByLabel('Choose tutorial')
		await expect(picker)
			.toBeVisible()
		await expect(picker)
			.toHaveValue('survey')

		await picker.selectOption('crm')
		await page.getByRole('button', { name: 'Tutorial', exact: true })
			.click()

		const rail = page.getByRole('complementary', { name: RAIL_LABEL })
		await expect(rail)
			.toBeVisible()
		// The deterministic-start pipeline switched showcase to CRM and applied `crm-default`, same as
		// Survey's own start does for `survey-default` (issue #25 OWNER decision, extended to CRM).
		await expect(page.getByLabel('Switch showcase'))
			.toHaveValue('crm')
		// `{ exact: true }`: the step's own `<h3>` title is ALSO "This is the Sales Pipeline CRM" (a
		// shorter string) — the full sentence (with the trailing clause) is the reveal `<p>` specifically.
		await expect(rail.getByText('This is the Sales Pipeline CRM — a deal-tracking dashboard over a shared set of deals.'))
			.toBeVisible()
		await expect(rail.getByText('Step 1 of 6'))
			.toBeVisible()
	})

	test('"Take the CRM tour" from Survey\'s hand-back step marks Survey completed and starts the CRM tour', async ({ page }) => {
		await page.goto('/')
		await page.getByRole('button', { name: 'Tutorial', exact: true })
			.click()

		const rail = page.getByRole('complementary', { name: RAIL_LABEL })
		await expect(rail)
			.toBeVisible()
		const nextButton = page.getByRole('button', { name: 'Next', exact: true })

		// A condensed real walkthrough to reach Survey's hand-back step — the full step-by-step
		// walkthrough (every observation asserted) is `tutorial.spec.ts`'s job; this only needs to get
		// there via genuine interactions to prove the NEW "Take the CRM tour" link (issue #25 P4).
		await nextButton.click() // step 1 -> 2
		const adults = page.getByLabel('Adults', { exact: true })
		await adults.fill('5')
		await adults.press('Tab')
		await nextButton.click() // -> 3
		await nextButton.click() // -> 4
		const returnDate = page.getByLabel('Return date')
		await returnDate.fill('2027-04-01')
		await returnDate.press('Tab')
		await returnDate.fill('2027-04-20')
		await returnDate.press('Tab')
		await nextButton.click() // -> 5
		const children = page.getByLabel('Children', { exact: true })
		await children.fill('2')
		await children.press('Tab')
		await children.fill('0')
		await children.press('Tab')
		await nextButton.click() // -> 6
		await page.getByRole('button', { name: 'Submit', exact: true })
			.click()
		await page.getByRole('button', { name: 'Generate result', exact: true })
			.click()
		await nextButton.click() // -> 7
		await adults.fill('6')
		await adults.press('Tab')
		await nextButton.click() // -> 8
		await nextButton.click() // -> 9 (hand-back)

		await expect(rail.getByRole('button', { name: 'Finish', exact: true }))
			.toBeEnabled()
		await rail.getByRole('button', { name: 'Take the CRM tour' })
			.click()

		// Reads as completing Survey, not abandoning it mid-teaching (issue #25 P4 Scope B).
		const surveyCompletedFlag = await page.evaluate(() => sessionStorage.getItem('widget-lab:tutorial:completed:survey'))
		expect(surveyCompletedFlag)
			.toBe('1')

		await expect(page.getByLabel('Switch showcase'))
			.toHaveValue('crm')
		await expect(rail)
			.toBeVisible()
		await expect(rail.getByText('This is the Sales Pipeline CRM — a deal-tracking dashboard over a shared set of deals.'))
			.toBeVisible()
		await expect(rail.getByText('Step 1 of 6'))
			.toBeVisible()
	})
})

test('full CRM tour end-to-end via real interactions, each observation appearing only after its action', async ({ page }) => {
	await startCrmTourFromHeader(page)

	const rail = page.getByRole('complementary', { name: RAIL_LABEL })
	const nextButton = page.getByRole('button', { name: 'Next', exact: true })
	const finishButton = page.getByRole('button', { name: 'Finish', exact: true })

	// Step 1 — orient: no action needed, reveals immediately.
	await expect(rail.getByText('This is the Sales Pipeline CRM — a deal-tracking dashboard over a shared set of deals.'))
		.toBeVisible()
	await expect(nextButton)
		.toBeEnabled()
	await nextButton.click()

	// Step 2 — search/filter State + derived Properties.
	const searchObservation = rail.getByText('The table narrowed and the Visible deals KPI updated together.', { exact: false })
	await expect(searchObservation)
		.toHaveCount(0)
	await expect(nextButton)
		.toBeDisabled()
	await expect(page.locator('[data-tutorial-target="crm-search"]'))
		.toHaveClass(/tutorial-spotlight/)

	await page.getByLabel('Search', { exact: true })
		.fill('Aurora')
	await expect(page.locator('tbody tr'))
		.toHaveCount(1)
	await expect(searchObservation)
		.toBeVisible()
	await expect(nextButton)
		.toBeEnabled()

	await rail.getByRole('button', { name: 'See it in Runtime' })
		.click()
	await expect(page.getByRole('tab', { name: 'Runtime' }))
		.toHaveAttribute('aria-selected', 'true')
	await nextButton.click()

	// Step 3 — row selection -> detail coordination via Table.selectedRowId.
	const detailPanelCompany = page.getByText('Deal details')
		.locator('..')
		.locator('dd')
		.first()
	const selectObservation = rail.getByText('The detail panel now shows Aurora Systems.', { exact: false })
	await expect(selectObservation)
		.toHaveCount(0)
	await expect(page.locator('[data-tutorial-target="crm-table"]'))
		.toHaveClass(/tutorial-spotlight/)

	await page.getByRole('row')
		.filter({ hasText: 'Aurora Systems' })
		.click()
	await expect(detailPanelCompany)
		.toHaveText('Aurora Systems')
	await expect(selectObservation)
		.toBeVisible()
	await expect(nextButton)
		.toBeEnabled()
	await nextButton.click()

	// Step 4 — a Method opens a dialog; another mutates and everything recomputes. Kept as ONE step with
	// TWO stages (never split into two separate steps): `ModalRenderer.vue`'s dialog is a real native
	// `showModal()` dialog, which makes the rest of the document — including this rail — `inert` while
	// open, so Next can only ever be clicked once the visitor has closed it (via Save here).
	const openObservation = rail.getByText('The dialog opened.', { exact: false })
	const saveObservation = rail.getByText('Aurora Systems\' stage changed', { exact: false })
	await expect(openObservation)
		.toHaveCount(0)
	await expect(page.locator('[data-tutorial-target="crm-change-stage-button"]'))
		.toHaveClass(/tutorial-spotlight/)

	const changeStageButton = page.getByRole('button', { name: 'Change stage' })
	await changeStageButton.click()
	const dialog = page.getByRole('dialog', { name: 'Change deal stage' })
	await expect(dialog)
		.toBeVisible()
	// Stage 1 revealed via passive Runtime observation while the (native, `inert`-making) dialog is
	// still open — Next stays disabled; only stage 2's completion (Save) enables it.
	await expect(openObservation)
		.toBeVisible()
	await expect(nextButton)
		.toBeDisabled()
	await expect(saveObservation)
		.toHaveCount(0)

	await page.getByLabel('New stage')
		.selectOption('won')
	// `exact: true`: the Runtime tab (activated via step 2's "See it in Runtime" link, and still
	// mounted though inactive) has its own "save-stage : Button"/"save() writes ..." rows, which a
	// non-exact substring match on "Save" would ambiguously also match.
	await page.getByRole('button', { name: 'Save', exact: true })
		.click()
	await expect(dialog)
		.toBeHidden()
	await expect(page.getByRole('row')
		.filter({ hasText: 'Aurora Systems' })
		.locator('td')
		.nth(3))
		.toHaveText('won')
	await expect(saveObservation)
		.toBeVisible()
	await expect(nextButton)
		.toBeEnabled()
	await nextButton.click()

	// Step 5 — optional deep dive: semantic-only widgets, reveals immediately, links to Graph/Implementation.
	await expect(rail.getByText('DealStore and DealQuery own the search/filter/aggregation rules', { exact: false }))
		.toBeVisible()
	await rail.getByRole('button', { name: 'Graph', exact: true })
		.click()
	await expect(page.getByRole('tab', { name: 'Graph' }))
		.toHaveAttribute('aria-selected', 'true')
	await nextButton.click()

	// Step 6 — hand-back: condensed reminder, "Finish" replaces "Next" on the last step.
	await expect(rail.getByText('State, Properties, row-selection coordination, and a Method-driven mutation', { exact: false }))
		.toBeVisible()
	await expect(finishButton)
		.toBeEnabled()
	await finishButton.click()

	await expect(rail)
		.toHaveCount(0)
	await expect(page.getByRole('button', { name: 'Restart tutorial' }))
		.toBeVisible()
})

test('Graph legend opens, names the three edge kinds, and dismisses', async ({ page }) => {
	await page.goto('/')
	await page.getByLabel('Switch showcase')
		.selectOption('crm')
	await page.getByRole('tab', { name: 'Graph' })
		.click()

	const legendButton = page.getByRole('button', { name: 'Legend' })
	await expect(legendButton)
		.toHaveAttribute('aria-expanded', 'false')
	const legendPanel = page.getByRole('group', { name: 'Graph legend' })
	await expect(legendPanel)
		.toHaveCount(0)

	await legendButton.click()
	await expect(legendButton)
		.toHaveAttribute('aria-expanded', 'true')
	await expect(legendPanel)
		.toBeVisible()
	await expect(legendPanel.getByText('reads', { exact: true }))
		.toBeVisible()
	await expect(legendPanel.getByText('writes', { exact: true }))
		.toBeVisible()
	await expect(legendPanel.getByText('invokes', { exact: true }))
		.toBeVisible()

	await legendButton.click()
	await expect(legendButton)
		.toHaveAttribute('aria-expanded', 'false')
	await expect(legendPanel)
		.toHaveCount(0)
})

test('Runtime unavailable message explains why and what to do next (issue #25 P4 Scope D copy audit)', async ({ page }) => {
	interface LabTestWindow { __WIDGET_LAB_TEST__?: { setDraftSourceText: (text: string) => void } }

	await page.goto('/?lab-test')
	await page.waitForFunction(() => typeof (window as unknown as LabTestWindow).__WIDGET_LAB_TEST__?.setDraftSourceText === 'function')
	await page.evaluate((source) => {
		(window as unknown as LabTestWindow).__WIDGET_LAB_TEST__?.setDraftSourceText(source)
	}, '{ "id": "root", "type": "NoSuchWidgetType" }')
	await page.getByRole('button', { name: 'Apply' })
		.click()
	await expect(page.getByText('Blueprint: invalid', { exact: false }))
		.toBeVisible()

	await page.getByRole('tab', { name: 'Runtime' })
		.click()
	await expect(page.getByText('Runtime unavailable', { exact: false }))
		.toBeVisible()
	await expect(page.getByText('the applied Blueprint is invalid', { exact: false }))
		.toBeVisible()
	await expect(page.getByText('Apply again', { exact: false }))
		.toBeVisible()
})
