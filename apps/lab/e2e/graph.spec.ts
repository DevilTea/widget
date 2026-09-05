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
	await page.getByRole('tab', { name: 'Dependencies' })
		.click()

	const nodes = page.locator('.vue-flow__node')
	await expect(nodes.first())
		.toBeVisible({ timeout: 15_000 })
	expect(await nodes.count())
		.toBeGreaterThan(0)

	// Layout completed: `DependenciesPanel.vue`'s Graph-view `statusLabel` only renders "Laying out…"/"Layout failed."
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

// issue #27's acceptance criterion names all showcases explicitly ("Opening Graph on Survey and CRM
// reliably displays the graph without requiring a filter toggle or manual browser resize") — this is
// exactly the async layout/render behavior #27 asks to pin at the browser level per showcase rather than
// infer from one case. Includes sandbox default on direct first-open without switching.
for (const showcaseId of ['sandbox', 'survey', 'crm'] as const) {
	test(`${showcaseId} graph nodes intersect the visible viewport on first open (issue #27)`, async ({ page }) => {
		await page.goto('/')
		if (showcaseId !== 'sandbox') {
			await page.getByLabel('Switch showcase')
				.selectOption(showcaseId)
		}
		await page.getByRole('tab', { name: 'Dependencies' })
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
}

test('"Fit graph" affordance restores a useful viewport (issue #27)', async ({ page }) => {
	await page.goto('/')
	await page.getByLabel('Switch showcase')
		.selectOption('survey')
	await page.getByRole('tab', { name: 'Dependencies' })
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
	const transformBeforeDistortion = await viewport.getAttribute('style')

	// Zoom in hard, pivoted on one corner of the canvas (`zoomOnScroll` is on by default and needs no
	// modifier key) — this pushes most of the laid-out graph outside the visible viewport, the same
	// "pan/zoom away" a user's scroll wheel would produce.
	const canvasBox = (await canvas.boundingBox())!
	await page.mouse.move(canvasBox.x + canvasBox.width * 0.15, canvasBox.y + canvasBox.height * 0.15)
	for (let i = 0; i < 12; i++)
		await page.mouse.wheel(0, -300)

	// Confirm the interaction actually distorted the viewport, and capture that distorted transform —
	// this is the exact state "Fit graph" must be proven to recover from below, not merely a starting
	// point to diff against a stale earlier reading.
	let transformDistorted = ''
	await expect(async () => {
		transformDistorted = (await viewport.getAttribute('style')) ?? ''
		expect(transformDistorted)
			.not.toBe(transformBeforeDistortion)
	})
		.toPass({ timeout: 5_000 })

	await page.getByRole('button', { name: 'Fit graph' })
		.click()

	// A no-op `fitGraph()` could still leave one node technically intersecting the canvas after a hard
	// zoom, so intersection alone does not prove the button did anything (issue #27 review). Assert BOTH
	// that the transform materially moved away from the captured distorted one — proving the click
	// actually changed the viewport, not that some unrelated later reading merely differs from it — AND
	// that the resulting viewport is useful (nodes intersecting again). Deliberately not asserting exact
	// equality with the original pre-distortion transform: two independent fit computations can differ
	// slightly in measurement/animation timing, which would make that brittle; the invariant that matters
	// is "Fit recovers a distorted viewport into a useful one", not "byte-identical transform". `toPass`
	// also covers a `fitView()` that animates rather than snapping instantly.
	await expect(async () => {
		const transformAfterFit = await viewport.getAttribute('style')
		expect(transformAfterFit)
			.not.toBe(transformDistorted)

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

test('progressive disclosure collapses clusters initially, expands on click, and supports Expand/Collapse all', async ({ page }) => {
	await page.goto('/')
	await page.getByLabel('Switch showcase')
		.selectOption('survey')
	await page.getByRole('tab', { name: 'Dependencies' })
		.click()

	const canvas = page.locator('.vue-flow')
	await expect(canvas.locator('.graph-node--cluster')
		.first())
		.toBeVisible({ timeout: 15_000 })

	// Initially, clusters are collapsed, so member nodes are not rendered
	await expect(canvas.locator('.graph-node--member'))
		.toHaveCount(0)

	// Expand all
	await page.getByRole('button', { name: 'Expand all' })
		.click()

	const members = canvas.locator('.graph-node--member')
	await expect(members.first())
		.toBeVisible({ timeout: 15_000 })
	expect(await members.count())
		.toBeGreaterThan(0)

	// Expansion triggers a fresh ELK layout. Automatic fit must recover only after the new generation's
	// nodes have all been measured; this assertion intentionally does not use the manual Fit button.
	await expect(async () => {
		const canvasBox = await canvas.boundingBox()
		expect(canvasBox)
			.not.toBeNull()
		const count = await members.count()
		let intersecting = 0
		for (let i = 0; i < count; i++) {
			const box = await members.nth(i)
				.boundingBox()
			if (box !== null && intersects(box, canvasBox!))
				intersecting++
		}
		expect(intersecting)
			.toBeGreaterThan(0)
	})
		.toPass({ timeout: 10_000 })

	// Collapse all
	await page.getByRole('button', { name: 'Collapse all' })
		.click()

	await expect(canvas.locator('.graph-node--member'))
		.toHaveCount(0)

	const clusters = canvas.locator('.graph-node--cluster')
	await expect(async () => {
		const canvasBox = await canvas.boundingBox()
		expect(canvasBox)
			.not.toBeNull()
		const count = await clusters.count()
		let intersecting = 0
		for (let i = 0; i < count; i++) {
			const box = await clusters.nth(i)
				.boundingBox()
			if (box !== null && intersects(box, canvasBox!))
				intersecting++
		}
		expect(intersecting)
			.toBeGreaterThan(0)
	})
		.toPass({ timeout: 10_000 })

	// Expand individual cluster by clicking its toggle button
	const toggleBtn = canvas.locator('.graph-node--cluster button')
		.first()
	await toggleBtn.click()

	await expect(canvas.locator('.graph-node--member')
		.first())
		.toBeVisible({ timeout: 15_000 })
})

test('focusing a member highlights subgraph and dims unrelated nodes', async ({ page }) => {
	await page.goto('/')
	await page.getByLabel('Switch showcase')
		.selectOption('survey')
	await page.getByRole('tab', { name: 'Dependencies' })
		.click()

	// Expand all so members are visible
	await page.getByRole('button', { name: 'Expand all' })
		.click()

	const member = page.locator('.graph-node--member')
		.first()
	await expect(member)
		.toBeVisible({ timeout: 15_000 })

	// Click member to focus it
	await member.click()

	// Focused member has focused class
	await expect(page.locator('.graph-node--focused'))
		.toBeVisible({ timeout: 5_000 })

	// Unrelated nodes have dimmed class
	await expect(page.locator('.graph-node--dimmed')
		.first())
		.toBeVisible({ timeout: 5_000 })
})
