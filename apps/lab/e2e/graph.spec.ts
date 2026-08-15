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

/**
 * Bounding-box intersection between two DOMRect-shaped boxes (client coordinates).
 */
function intersects(a: { x: number, y: number, width: number, height: number }, b: { x: number, y: number, width: number, height: number }): boolean {
	return a.x < b.x + b.width
		&& a.x + a.width > b.x
		&& a.y < b.y + b.height
		&& a.y + a.height > b.y
}

test('graph nodes intersect the visible viewport on first open (issue #27)', async ({ page }) => {
	await page.goto('/')
	await page.getByLabel('Switch showcase')
		.selectOption('survey')
	await page.getByRole('tab', { name: 'Graph' })
		.click()

	const canvas = page.locator('.vue-flow')
	const nodes = page.locator('.vue-flow__node')
	await expect(nodes.first())
		.toBeVisible({ timeout: 15_000 })

	// `GraphCanvas.vue`'s fit runs off `onNodesInitialized`, an async step after nodes first render —
	// poll rather than asserting immediately after the node locator resolves.
	await expect(async () => {
		const canvasBox = await canvas.boundingBox()
		expect(canvasBox)
			.not.toBeNull()
		const count = await nodes.count()
		let intersecting = 0
		for (let i = 0; i < count; i++) {
			const box = await nodes.nth(i)
				.boundingBox()
			if (box !== null && intersects(box, canvasBox!))
				intersecting++
		}
		expect(intersecting)
			.toBeGreaterThan(0)
	})
		.toPass({ timeout: 10_000 })
})

test('"Fit graph" affordance restores a useful viewport (issue #27)', async ({ page }) => {
	await page.goto('/')
	await page.getByLabel('Switch showcase')
		.selectOption('survey')
	await page.getByRole('tab', { name: 'Graph' })
		.click()

	const canvas = page.locator('.vue-flow')
	const nodes = page.locator('.vue-flow__node')
	await expect(nodes.first())
		.toBeVisible({ timeout: 15_000 })

	// Let the automatic first-open fit (issue #27 Finding 1) settle before deliberately panning away.
	await expect(async () => {
		const canvasBox = await canvas.boundingBox()
		const box = await nodes.first()
			.boundingBox()
		expect(box)
			.not.toBeNull()
		expect(intersects(box!, canvasBox!))
			.toBe(true)
	})
		.toPass({ timeout: 10_000 })

	const viewport = page.locator('.vue-flow__transformationpane')
	const transformBeforePan = await viewport.getAttribute('style')

	// Zoom in hard, pivoted on one corner of the canvas (`zoomOnScroll` is on by default and needs no
	// modifier key) — this pushes most of the laid-out graph outside the visible viewport, the same
	// "pan/zoom away" a user's scroll wheel would produce.
	const canvasBox = (await canvas.boundingBox())!
	await page.mouse.move(canvasBox.x + canvasBox.width * 0.15, canvasBox.y + canvasBox.height * 0.15)
	for (let i = 0; i < 12; i++)
		await page.mouse.wheel(0, -300)

	// Confirm the interaction actually changed the viewport transform before relying on "Fit graph" to
	// recover it.
	await expect(async () => {
		expect(await viewport.getAttribute('style'))
			.not.toBe(transformBeforePan)
	})
		.toPass({ timeout: 5_000 })

	await page.getByRole('button', { name: 'Fit graph' })
		.click()

	await expect(async () => {
		const canvasBoxAfterFit = await canvas.boundingBox()
		const count = await nodes.count()
		let intersecting = 0
		for (let i = 0; i < count; i++) {
			const box = await nodes.nth(i)
				.boundingBox()
			if (box !== null && intersects(box, canvasBoxAfterFit!))
				intersecting++
		}
		expect(intersecting)
			.toBeGreaterThan(0)
	})
		.toPass({ timeout: 10_000 })
})
