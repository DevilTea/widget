import type { Page } from '@playwright/test'
import { expect, test } from './fixtures'

/**
 * Issue #25 P2 "Preview -> semantic inspector bridge" (Inspect mode) contract.
 *
 * Fixtures used:
 *  - CRM showcase (`crm-default` preset): `reset-data` (`Button`, "Reset data") nested inside
 *    `crm-toolbar` (`Toolbar`) nested inside `crm-app` (`AppShell`) — the nested-anchor case; and
 *    `change-stage` (`Button`, "Change stage") inside the Deal details panel — its press opens the
 *    "Change deal stage" modal, a clearly observable underlying action to prove suppressed/not-suppressed.
 *  - Survey showcase (`survey-default` preset): `adults` (`SurveyNumberQuestion`, label "Adults") — a
 *    plain hover/badge target.
 */

const INSPECT_TOGGLE = { name: 'Inspect' }
const CHANGE_STAGE_DIALOG = { name: 'Change deal stage' }

function inspectToggle(page: Page) {
	return page.getByRole('button', INSPECT_TOGGLE)
}

async function selectAuroraDeal(page: Page): Promise<void> {
	// Selecting a row is itself a normal (non-Inspect) interaction — done before Inspect mode is ever
	// turned on, since an Inspect-mode click on the table row would resolve to `deal-table` (the whole
	// `Table` widget is the innermost anchor for a data row) and suppress `selectRow` entirely.
	await page.getByRole('row')
		.filter({ hasText: 'Aurora Systems' })
		.click()
	await expect(page.getByRole('button', { name: 'Change stage' }))
		.toBeVisible()
}

test.describe('Inspect mode (issue #25 P2)', () => {
	test.beforeEach(async ({ page }) => {
		await page.goto('/')
	})

	test('is off by default: CRM rows/buttons behave normally', async ({ page }) => {
		await page.getByLabel('Switch showcase')
			.selectOption('crm')

		await expect(inspectToggle(page))
			.toHaveAttribute('aria-pressed', 'false')

		await selectAuroraDeal(page)

		await page.getByRole('button', { name: 'Change stage' })
			.click()
		await expect(page.getByRole('dialog', CHANGE_STAGE_DIALOG))
			.toBeVisible()
		await page.keyboard.press('Escape')
		await expect(page.getByRole('dialog', CHANGE_STAGE_DIALOG))
			.toBeHidden()
	})

	test('toggling on: hovering a Survey question outlines it and shows the type#id badge', async ({ page }) => {
		await page.getByLabel('Switch showcase')
			.selectOption('survey')

		await inspectToggle(page)
			.click()
		await expect(inspectToggle(page))
			.toHaveAttribute('aria-pressed', 'true')

		const adultsLabel = page.getByText('Adults', { exact: true })
		const adultsAnchor = adultsLabel.locator('..')

		await adultsLabel.hover()

		await expect(adultsAnchor)
			.toHaveClass(/lab-inspect-anchor--highlighted/)
		await expect(page.getByText('SurveyNumberQuestion#adults'))
			.toBeVisible()
	})

	test('inspect-click on a CRM Button suppresses its action but drives shared focus into Blueprint and Runtime', async ({ page }) => {
		await page.getByLabel('Switch showcase')
			.selectOption('crm')
		await selectAuroraDeal(page)

		await inspectToggle(page)
			.click()

		await page.getByRole('button', { name: 'Change stage' })
			.click()

		// Suppressed: no modal, no store mutation.
		await expect(page.getByRole('dialog', CHANGE_STAGE_DIALOG))
			.toHaveCount(0)

		// Drives the existing shared focus + activates Blueprint for immediate visible feedback.
		await expect(page.getByRole('tab', { name: 'Blueprint' }))
			.toHaveAttribute('aria-selected', 'true')
		await expect(page.getByRole('heading', { name: 'change-stage : Button' }))
			.toBeVisible()

		// Runtime reflects the exact same shared focus once opened: the same tree row is the selected
		// (highlighted) one there too — relative to a sibling row's own background, rather than any
		// specific color value.
		await page.getByRole('tab', { name: 'Runtime' })
			.click()
		const changeStageRow = page.getByRole('button', { name: 'change-stage : Button' })
		const resetDataRow = page.getByRole('button', { name: 'reset-data : Button' })
		const [selectedBackground, otherBackground] = await Promise.all([
			changeStageRow.evaluate(el => getComputedStyle(el).backgroundColor),
			resetDataRow.evaluate(el => getComputedStyle(el).backgroundColor),
		])
		expect(selectedBackground)
			.not.toBe(otherBackground)
	})

	test('innermost inspect anchor wins: a Button nested inside the CRM toolbar/AppShell selects itself, not its container', async ({ page }) => {
		await page.getByLabel('Switch showcase')
			.selectOption('crm')

		await inspectToggle(page)
			.click()

		// `reset-data` (Button) is nested inside `crm-toolbar` (Toolbar) inside `crm-app` (AppShell) —
		// all three are stamped Inspect anchors.
		await page.getByRole('button', { name: 'Reset data' })
			.click()

		await expect(page.getByRole('tab', { name: 'Blueprint' }))
			.toHaveAttribute('aria-selected', 'true')
		await expect(page.getByRole('heading', { name: 'reset-data : Button' }))
			.toBeVisible()
		await expect(page.getByRole('heading', { name: 'crm-toolbar : Toolbar' }))
			.toHaveCount(0)
		await expect(page.getByRole('heading', { name: 'crm-app : AppShell' }))
			.toHaveCount(0)
	})

	test('Escape exits Inspect mode: badge disappears and subsequent clicks act normally', async ({ page }) => {
		await page.getByLabel('Switch showcase')
			.selectOption('survey')

		await inspectToggle(page)
			.click()
		const adultsLabel = page.getByText('Adults', { exact: true })
		await adultsLabel.hover()
		await expect(page.getByText('SurveyNumberQuestion#adults'))
			.toBeVisible()

		await page.keyboard.press('Escape')

		await expect(inspectToggle(page))
			.toHaveAttribute('aria-pressed', 'false')
		await expect(page.getByText('SurveyNumberQuestion#adults'))
			.toHaveCount(0)

		// A subsequent click now behaves normally again: writing `Adults` actually reaches the widget's
		// State (as it would with Inspect never having been turned on).
		const adultsInput = page.getByLabel('Adults', { exact: true })
		await adultsInput.fill('5')
		await adultsInput.press('Tab')
		await expect(adultsInput)
			.toHaveValue('5')
	})

	test('toggling off restores normal Preview behavior immediately', async ({ page }) => {
		await page.getByLabel('Switch showcase')
			.selectOption('crm')
		await selectAuroraDeal(page)

		await inspectToggle(page)
			.click()
		await expect(inspectToggle(page))
			.toHaveAttribute('aria-pressed', 'true')

		// Toggle off explicitly (not Escape).
		await inspectToggle(page)
			.click()
		await expect(inspectToggle(page))
			.toHaveAttribute('aria-pressed', 'false')

		await page.getByRole('button', { name: 'Change stage' })
			.click()
		await expect(page.getByRole('dialog', CHANGE_STAGE_DIALOG))
			.toBeVisible()
	})
})
