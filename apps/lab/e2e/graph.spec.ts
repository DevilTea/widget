import { expect, test } from './fixtures'

/**
 * Issue #28 Dependency Graph contract. Uses the Survey showcase (a richer topology than the default
 * Sandbox, and the one issue #28 names explicitly) — switching to it goes through the same Apply
 * pipeline `switchShowcase()` always uses (see AGENTS.md "Apply lifecycle").
 *
 * Layout is asynchronous (ELK Layered, run inside a persistent Worker — see AGENTS.md "Layout worker
 * boundary"), so this waits for Vue Flow to actually render node elements rather than asserting
 * immediately after opening the tab.
 */

test('Survey Dependency Graph lays out and renders nodes', async ({ page }) => {
	await page.goto('/')
	await page.getByLabel('Switch showcase')
		.selectOption('survey')
	await page.getByRole('tab', { name: 'Graph' })
		.click()

	const nodes = page.locator('.vue-flow__node')
	await expect(nodes.first())
		.toBeVisible({ timeout: 15_000 })
	expect(await nodes.count())
		.toBeGreaterThan(0)

	// Layout completed: `GraphPanel.vue`'s `statusLabel` only renders "Laying out…"/"Layout failed."
	// while the async ELK request is in flight or rejected — neither is shown once Vue Flow has real
	// node elements to render.
	await expect(page.getByText('Laying out…'))
		.toHaveCount(0)
	await expect(page.getByText('Layout failed.'))
		.toHaveCount(0)
})

test.fixme('graph nodes intersect the visible viewport on first open (issue #27)', async () => {
	// Known defect: the initial Vue Flow viewport does not fit the laid-out graph on first open.
})

test.fixme('"Fit graph" affordance restores a useful viewport (issue #27)', async () => {
	// No "Fit graph" control exists yet in the Graph panel — tracked in issue #27.
})
