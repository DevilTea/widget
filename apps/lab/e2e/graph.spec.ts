import type { Page } from '@playwright/test'
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

/** Opens Dependencies and asserts the Graph renders nodes and that some intersect the visible canvas. */
async function expectGraphNodesIntersectViewportOnFirstOpen(page: Page): Promise<void> {
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
}

// issue #27's acceptance criterion names the showcases explicitly ("Opening Graph ... reliably displays the
// graph without requiring a filter toggle or manual browser resize") — this is exactly the async
// layout/render behavior #27 asks to pin at the browser level per showcase rather than infer from one
// case. Opens each showcase directly through `?showcase=<id>` (the hidden Sandbox fixture has no UI entry).
for (const showcaseId of ['sandbox', 'survey'] as const) {
	test(`${showcaseId} graph nodes intersect the visible viewport on first open (issue #27)`, async ({ page }) => {
		await page.goto(`/?showcase=${showcaseId}`)
		await expectGraphNodesIntersectViewportOnFirstOpen(page)
	})
}

// The same contract after a runtime showcase switch (the original #27 loop did this for every showcase
// but the default): start on the hidden Sandbox, switch to Survey with the selector, then open Graph.
test('survey graph nodes intersect the visible viewport on first open after switching showcase from the Sandbox (issue #27)', async ({ page }) => {
	await page.goto('/?showcase=sandbox')
	await page.getByLabel('Switch showcase')
		.selectOption('survey')
	await expect(page.getByLabel('Switch showcase'))
		.toHaveValue('survey')
	await expectGraphNodesIntersectViewportOnFirstOpen(page)
})

test('"Fit graph" contains every expected Survey node (issues #27, #104)', async ({ page }) => {
	const expectedSurveyNodeIds = [
		'cluster:0',
		'cluster:1',
		'cluster:2',
		'cluster:3',
		'cluster:4',
	] as const
	// Playwright reports fractional CSS pixels; 2 px allows subpixel/edge rounding only.
	const fitTolerancePx = 2

	await page.goto('/')
	await page.getByRole('tab', { name: 'Dependencies' })
		.click()

	const canvas = page.locator('.vue-flow')
	const nodes = page.locator('.vue-flow__node')
	await expect(nodes.first())
		.toBeVisible({ timeout: 15_000 })
	await expect(nodes)
		.toHaveCount(expectedSurveyNodeIds.length)
	const renderedNodeIds = await nodes.evaluateAll(elements => elements.map(element => element.getAttribute('data-id')))
	expect(renderedNodeIds.sort())
		.toEqual([...expectedSurveyNodeIds].sort())

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

		for (const id of expectedSurveyNodeIds) {
			const box = await canvas.locator(`.vue-flow__node[data-id="${id}"]`)
				.boundingBox()
			expect(box, `expected rendered Survey graph node ${id}`)
				.not.toBeNull()
			expect(box!.x)
				.toBeGreaterThanOrEqual(canvasBoxAfterFit!.x - fitTolerancePx)
			expect(box!.y)
				.toBeGreaterThanOrEqual(canvasBoxAfterFit!.y - fitTolerancePx)
			expect(box!.x + box!.width)
				.toBeLessThanOrEqual(canvasBoxAfterFit!.x + canvasBoxAfterFit!.width + fitTolerancePx)
			expect(box!.y + box!.height)
				.toBeLessThanOrEqual(canvasBoxAfterFit!.y + canvasBoxAfterFit!.height + fitTolerancePx)
		}
	})
		.toPass({ timeout: 10_000 })
})

test('progressive disclosure collapses clusters initially, expands on click, and supports Expand/Collapse all', async ({ page }) => {
	await page.goto('/')
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
	// Widget order in the default preset: 0 open-day (Survey), 1 mode (SingleChoice), 2 guests (Numeric),
	// 3 sessions (MultipleChoice), 4 phone (ShortAnswer). Every member has a relation, so all 37 show.
	const expectedMemberIds = [
		'0:method:submit',
		'0:property:canSubmit',
		'0:property:changedSinceSubmit',
		'0:property:response',
		'0:property:text',
		'0:state:language',
		'0:state:submitted',
		'1:method:clear',
		'1:property:errors',
		'1:property:options',
		'1:property:required',
		'1:property:text',
		'1:property:value',
		'1:property:visible',
		'1:state:answer',
		'2:method:clear',
		'2:property:errors',
		'2:property:required',
		'2:property:text',
		'2:property:value',
		'2:property:visible',
		'2:state:answer',
		'3:method:clear',
		'3:property:errors',
		'3:property:options',
		'3:property:required',
		'3:property:text',
		'3:property:value',
		'3:property:visible',
		'3:state:answer',
		'4:method:clear',
		'4:property:errors',
		'4:property:required',
		'4:property:text',
		'4:property:value',
		'4:property:visible',
		'4:state:answer',
	]
	await expect(members)
		.toHaveCount(expectedMemberIds.length)
	const memberIds = await members.evaluateAll(elements => elements
		.map(element => element.closest<HTMLElement>('[data-id]')?.dataset.id ?? '')
		.sort())
	expect(memberIds)
		.toEqual(expectedMemberIds)
	await expect(canvas.getByRole('button', { name: 'Expand', exact: true }))
		.toHaveCount(0)

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
	const toggleBtn = canvas.locator('.graph-node--cluster .graph-cluster-toggle')
		.first()
	await toggleBtn.click()

	await expect(canvas.locator('.graph-node--member')
		.first())
		.toBeVisible({ timeout: 15_000 })
})

test('focusing a member highlights subgraph and dims unrelated nodes', async ({ page }) => {
	await page.goto('/')
	await page.getByRole('tab', { name: 'Dependencies' })
		.click()

	// Expand all so members are visible
	await page.getByRole('button', { name: 'Expand all' })
		.click()

	// `phone.required` reads `mode.value`: a member with a known cross-widget dependency.
	const member = page.locator('.vue-flow__node[data-id="4:property:required"] .graph-node--member')
	await expect(member)
		.toBeVisible({ timeout: 15_000 })

	await member.click()

	// Focused member has focused class.
	await expect(page.locator('.graph-node--focused'))
		.toContainText('required')

	// The connected `mode` question's member lives inside an expanded cluster. Its owning
	// cluster must remain fully visible rather than inheriting unrelated-node deemphasis.
	const relatedCluster = page.locator('.graph-node--cluster')
		.filter({ hasText: 'SingleChoice' })
		.first()
	await expect(relatedCluster)
		.not.toHaveClass(/graph-node--dimmed/)

	// Unrelated nodes still have dimmed class.
	await expect(page.locator('.graph-node--dimmed')
		.first())
		.toBeVisible({ timeout: 5_000 })
})

test('expanded member nodes can be focused from the keyboard', async ({ page }) => {
	await page.goto('/')
	await page.getByRole('tab', { name: 'Dependencies' })
		.click()
	await page.getByRole('button', { name: 'Expand all' })
		.click()

	const member = page.locator('.vue-flow__node[data-id="4:property:required"] .graph-node--member')
	await expect(member)
		.toBeVisible({ timeout: 15_000 })
	await member.focus()
	await expect(member)
		.toBeFocused()
	await member.press('Enter')
	await expect(member)
		.toHaveClass(/graph-node--focused/)
})

test('Graph legend is a plain disclosure (not a menu popup), opens/closes via keyboard, and names the three edge kinds', async ({ page }) => {
	await page.goto('/')
	await page.getByRole('tab', { name: 'Dependencies' })
		.click()

	const legendButton = page.getByRole('button', { name: 'Legend' })
	await expect(legendButton)
		.toHaveAttribute('aria-expanded', 'false')
	// Merge-gate review round 2, finding 3: a plain disclosure/group, never a menu-style popup.
	await expect(legendButton)
		.not.toHaveAttribute('aria-haspopup')
	const controlledId = await legendButton.getAttribute('aria-controls')
	expect(controlledId)
		.toBeTruthy()

	const legendPanel = page.getByRole('group', { name: 'Graph legend' })
	await expect(legendPanel)
		.toHaveCount(0)

	// Opens via keyboard (focus + Enter) — the native button gives this for free, no custom key handling.
	await legendButton.focus()
	await page.keyboard.press('Enter')
	await expect(legendButton)
		.toHaveAttribute('aria-expanded', 'true')
	await expect(legendPanel)
		.toBeVisible()
	await expect(legendPanel)
		.toHaveAttribute('id', controlledId!)
	await expect(legendPanel.getByText('reads', { exact: true }))
		.toBeVisible()
	await expect(legendPanel.getByText('writes', { exact: true }))
		.toBeVisible()
	await expect(legendPanel.getByText('invokes', { exact: true }))
		.toBeVisible()

	// Closes via keyboard too (focus stays on the button after Enter activation) — Space this time.
	await page.keyboard.press('Space')
	await expect(legendButton)
		.toHaveAttribute('aria-expanded', 'false')
	await expect(legendPanel)
		.toHaveCount(0)

	// Mouse click still works (not keyboard-only).
	await legendButton.click()
	await expect(legendPanel)
		.toBeVisible()
	await legendButton.click()
	await expect(legendPanel)
		.toHaveCount(0)
})
