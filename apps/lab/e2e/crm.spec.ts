import type { Locator, Page } from '@playwright/test'
import { expect, test } from './fixtures'

/**
 * Issue #28 Sales Pipeline CRM contract, against the default preset (`crm-default` —
 * `showcases/crm/presets.ts`, `showcases/crm/domain.ts`'s eight-deal seed set).
 */

/**
 * `BarChartRenderer.vue`'s "Deals by stage" — each row renders as two separate rendered lines
 * (a capitalized stage label, then its count), so `innerText()` (layout-aware, unlike `textContent`)
 * parses cleanly into a label -> count map.
 */
async function stageChartCounts(page: Page): Promise<Record<string, string>> {
	const container = page.locator('h3', { hasText: 'Deals by stage' })
		.locator('..')
	// `innerText()` (not `textContent()`) is required here: it is layout-aware, so each grid-cell
	// `<span>` renders on its own line — `textContent()` would concatenate every label/count with no
	// separator at all. This is Playwright's `Locator.innerText()`, not the DOM node API
	// `unicorn/prefer-dom-node-text-content` assumes.
	// eslint-disable-next-line unicorn/prefer-dom-node-text-content
	const lines = (await container.innerText()).split('\n')
		.map(line => line.trim())
		.filter(line => line.length > 0)
	const counts: Record<string, string> = {}
	for (let i = 1; i + 1 < lines.length; i += 2) counts[lines[i]!.toLowerCase()] = lines[i + 1]!
	return counts
}

/** `MetricCardRenderer.vue` renders `<span>{label}</span><strong>{value}</strong>` as siblings. */
function metricValue(page: Page, label: string): Locator {
	return page.locator('span', { hasText: label })
		.locator('..')
		.locator('strong')
}

function dealRow(page: Page, company: string): Locator {
	return page.getByRole('row')
		.filter({ hasText: company })
}

test.beforeEach(async ({ page }) => {
	await page.goto('/')
	await page.getByLabel('Switch showcase')
		.selectOption('crm')
})

test('search filters the table and the Visible deals KPI coherently', async ({ page }) => {
	await expect(metricValue(page, 'Visible deals'))
		.toHaveText('8')

	await page.getByLabel('Search', { exact: true })
		.fill('Aurora')
	await expect(dealRow(page, 'Aurora Systems'))
		.toBeVisible()
	await expect(page.locator('tbody tr'))
		.toHaveCount(1)
	await expect(metricValue(page, 'Visible deals'))
		.toHaveText('1')
})

test('stage filter updates the table and the Visible deals KPI coherently', async ({ page }) => {
	// Exactly one seed deal is `won` (Fjord Robotics) — showcases/crm/domain.ts.
	await page.getByLabel('Stage', { exact: true })
		.selectOption('won')
	await expect(dealRow(page, 'Fjord Robotics'))
		.toBeVisible()
	await expect(page.locator('tbody tr'))
		.toHaveCount(1)
	await expect(metricValue(page, 'Visible deals'))
		.toHaveText('1')
})

test('keyboard-selecting a row shows its detail and reflects aria-selected', async ({ page }) => {
	const row = dealRow(page, 'Aurora Systems')
	await expect(row)
		.toHaveAttribute('aria-selected', 'false')

	await row.focus()
	await page.keyboard.press('Enter')

	await expect(page.getByText('Deal details')
		.locator('..')
		.getByText('Aurora Systems'))
		.toBeVisible()
	await expect(row)
		.toHaveAttribute('aria-selected', 'true')
})

test('Change stage dialog: focus/Tab containment, Escape cancels without mutation, Save recomputes', async ({ page }) => {
	const row = dealRow(page, 'Aurora Systems')
	await row.focus()
	await page.keyboard.press('Enter')

	const changeStageButton = page.getByRole('button', { name: 'Change stage' })
	await changeStageButton.click()

	const dialog = page.getByRole('dialog', { name: 'Change deal stage' })
	await expect(dialog)
		.toBeVisible()
	// Opening moves focus into the dialog, to its first control ("New stage").
	await expect(page.getByLabel('New stage'))
		.toBeFocused()

	/**
	 * Verified in Chromium: a native `<dialog>` shown via `showModal()` makes the rest of the page
	 * `inert` (so no background control is ever reachable), but Tab past the dialog's last focusable
	 * control briefly rests focus on `document.body` before the next Tab cycles back to the dialog's
	 * first control — it does not literally keep `document.activeElement` inside the `<dialog>` element
	 * at every step. The real, meaningful containment contract is therefore "focus is either inside the
	 * dialog or on `document.body`, never an outside interactive element" — sampled across a few Tab/
	 * Shift+Tab presses in both directions.
	 */
	async function focusStaysWithinModalBoundary(): Promise<boolean> {
		return page.evaluate(() => {
			const active = document.activeElement
			const dialogEl = document.querySelector('dialog')
			return active === document.body || (dialogEl !== null && dialogEl.contains(active))
		})
	}

	for (let i = 0; i < 5; i++) {
		await page.keyboard.press('Tab')
		expect(await focusStaysWithinModalBoundary())
			.toBe(true)
	}
	for (let i = 0; i < 5; i++) {
		await page.keyboard.press('Shift+Tab')
		expect(await focusStaysWithinModalBoundary())
			.toBe(true)
	}

	// Escape cancels: no mutation, dialog closes, focus returns to the button that opened it.
	await page.keyboard.press('Escape')
	await expect(dialog)
		.toBeHidden()
	await expect(changeStageButton)
		.toBeFocused()
	await expect(dealRow(page, 'Aurora Systems')
		.locator('td')
		.nth(3))
		.toHaveText('lead')

	// Reopen, change the stage, and Save through the semantic Method flow.
	const weightedValueBefore = await metricValue(page, 'Weighted value')
		// eslint-disable-next-line unicorn/prefer-dom-node-text-content -- Playwright's `Locator.innerText()`, not the DOM node API this rule assumes.
		.innerText()
	const wonCountBefore = (await stageChartCounts(page)).won

	await changeStageButton.click()
	await page.getByLabel('New stage')
		.selectOption('won')
	await page.getByRole('button', { name: 'Save' })
		.click()

	await expect(dialog)
		.toBeHidden()
	await expect(dealRow(page, 'Aurora Systems')
		.locator('td')
		.nth(3))
		.toHaveText('won')
	await expect(dealRow(page, 'Aurora Systems'))
		.toHaveAttribute('aria-selected', 'true')

	// KPI/chart recompute through the same DealQuery/BarChart read models — never a renderer-local total.
	await expect(metricValue(page, 'Weighted value')).not.toHaveText(weightedValueBefore)
	await expect.poll(async () => (await stageChartCounts(page)).won).not.toBe(wonCountBefore)
})
