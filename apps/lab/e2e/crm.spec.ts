import type { FrameLocator, Locator } from '@playwright/test'
import { expect, previewFrame, test } from './fixtures'

/**
 * Issue #28 Sales Pipeline CRM contract, against the default preset (`crm-default` —
 * `showcases/crm/presets.ts`, `showcases/crm/domain.ts`'s eight-deal seed set).
 */

/**
 * `BarChartRenderer.vue`'s "Deals by stage" — each row renders as two separate rendered lines
 * (a capitalized stage label, then its count), so `innerText()` (layout-aware, unlike `textContent`)
 * parses cleanly into a label -> count map.
 */
async function stageChartCounts(preview: FrameLocator): Promise<Record<string, string>> {
	const container = preview.locator('h3', { hasText: 'Deals by stage' })
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
function metricValue(preview: FrameLocator, label: string): Locator {
	return preview.locator('span', { hasText: label })
		.locator('..')
		.locator('strong')
}

function dealRow(preview: FrameLocator, company: string): Locator {
	return preview.getByRole('row')
		.filter({ hasText: company })
}

test.beforeEach(async ({ page }) => {
	await page.goto('/')
	await page.getByLabel('Switch showcase')
		.selectOption('crm')
})

test('search filters the table and the Visible deals KPI coherently', async ({ page }) => {
	const preview = previewFrame(page)
	await expect(metricValue(preview, 'Visible deals'))
		.toHaveText('8')

	await preview.getByLabel('Search', { exact: true })
		.fill('Aurora')
	await expect(dealRow(preview, 'Aurora Systems'))
		.toBeVisible()
	await expect(preview.locator('tbody tr'))
		.toHaveCount(1)
	await expect(metricValue(preview, 'Visible deals'))
		.toHaveText('1')
})

test('stage filter updates the table and the Visible deals KPI coherently', async ({ page }) => {
	const preview = previewFrame(page)
	// Exactly one seed deal is `won` (Fjord Robotics) — showcases/crm/domain.ts.
	await preview.getByLabel('Stage', { exact: true })
		.selectOption('won')
	await expect(dealRow(preview, 'Fjord Robotics'))
		.toBeVisible()
	await expect(preview.locator('tbody tr'))
		.toHaveCount(1)
	await expect(metricValue(preview, 'Visible deals'))
		.toHaveText('1')
})

test('keyboard-selecting rows with Enter and Space both drive Table.selectedRowId, moving aria-current and the detail panel without scrolling the Preview frame', async ({ page }) => {
	const preview = previewFrame(page)
	const auroraRow = dealRow(preview, 'Aurora Systems')
	const borealisRow = dealRow(preview, 'Borealis Retail')
	const detailPanelCompany = () => preview.getByText('Deal details')
		.locator('..')
		.locator('dd')
		.first()

	// Native table semantics throughout (PR #32 review round 1: no `role="grid"` without its full
	// keyboard contract) — an unselected row carries no `aria-current` attribute at all. Per WAI-ARIA
	// 1.2 (https://www.w3.org/TR/wai-aria/#aria-current), `aria-current`'s spec-defined default value is
	// already `"false"`, and an element with no `aria-current` attribute computes to that default (not
	// exposed to assistive technology) automatically — omission relies on the documented default rather
	// than there being no `"false"` value at all (PR #32 round 2 correction).
	await expect(auroraRow)
		.not.toHaveAttribute('aria-current')
	await expect(borealisRow)
		.not.toHaveAttribute('aria-current')

	// Enter activates the focused row through the exact same `Table.selectRow(id)` Method a pointer
	// click uses.
	await auroraRow.focus()
	await page.keyboard.press('Enter')

	await expect(detailPanelCompany())
		.toHaveText('Aurora Systems')
	await expect(auroraRow)
		.toHaveAttribute('aria-current', 'true')
	await expect(borealisRow)
		.not.toHaveAttribute('aria-current')

	// Space must activate a *different* focused row through the same Method — and must not scroll the
	// page as Space's native default action would on an ordinary focused, non-form-control element.
	const scrollYBeforeSpace = await preview.locator('html')
		.evaluate(() => window.scrollY)
	await borealisRow.focus()
	await page.keyboard.press('Space')
	const scrollYAfterSpace = await preview.locator('html')
		.evaluate(() => window.scrollY)
	expect(scrollYAfterSpace)
		.toBe(scrollYBeforeSpace)

	await expect(detailPanelCompany())
		.toHaveText('Borealis Retail')
	await expect(borealisRow)
		.toHaveAttribute('aria-current', 'true')
	// Selection is single-row: activating Borealis moves `aria-current` off Aurora, driven by the same
	// Runtime-backed `Table.selectedRowId` State, never renderer-local selection.
	await expect(auroraRow)
		.not.toHaveAttribute('aria-current')
})

test('Change stage dialog: focus/Tab containment, Escape cancels without mutation, Save recomputes', async ({ page }) => {
	const preview = previewFrame(page)
	const row = dealRow(preview, 'Aurora Systems')
	await row.focus()
	await page.keyboard.press('Enter')

	const changeStageButton = preview.getByRole('button', { name: 'Change stage' })
	await changeStageButton.click()

	const dialog = preview.getByRole('dialog', { name: 'Change deal stage' })
	await expect(dialog)
		.toBeVisible()
	// Opening moves focus into the dialog, to its first control ("New stage").
	await expect(preview.getByLabel('New stage'))
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
		return preview.locator('html')
			.evaluate(() => {
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
	await preview.getByLabel('New stage')
		.focus()
	await page.keyboard.press('Escape')
	await expect(dialog)
		.toBeHidden()
	await expect(changeStageButton)
		.toBeFocused()
	await expect(dealRow(preview, 'Aurora Systems')
		.locator('td')
		.nth(3))
		.toHaveText('lead')

	// Reopen, change the stage, and Save through the semantic Method flow.
	const weightedValueBefore = await metricValue(preview, 'Weighted value')
		// eslint-disable-next-line unicorn/prefer-dom-node-text-content -- Playwright's `Locator.innerText()`, not the DOM node API this rule assumes.
		.innerText()
	const wonCountBefore = (await stageChartCounts(preview)).won

	await changeStageButton.click()
	await preview.getByLabel('New stage')
		.selectOption('won')
	await preview.getByRole('button', { name: 'Save' })
		.click()

	await expect(dialog)
		.toBeHidden()
	await expect(dealRow(preview, 'Aurora Systems')
		.locator('td')
		.nth(3))
		.toHaveText('won')
	await expect(dealRow(preview, 'Aurora Systems'))
		.toHaveAttribute('aria-current', 'true')

	// KPI/chart recompute through the same DealQuery/BarChart read models — never a renderer-local total.
	await expect(metricValue(preview, 'Weighted value')).not.toHaveText(weightedValueBefore)
	await expect.poll(async () => (await stageChartCounts(preview)).won).not.toBe(wonCountBefore)
})
