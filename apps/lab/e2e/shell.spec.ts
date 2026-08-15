import { expect, test } from './fixtures'

/**
 * Issue #28 Lab shell / workbench contract: the app loads with the header's showcase/preset/Apply
 * controls and all five workbench panel tabs (`Workbench.vue`'s Source/Blueprint/Runtime/Graph/Preview)
 * available.
 *
 * Loaded against the network-blocked BUILT app (see `fixtures.ts`/`playwright.config.ts`) — Source is
 * the initially active tab, so this also exercises `modern-monaco` failing to load with external
 * network blocked. Verified (issue #30 evidence): `use-monaco-editor.ts`'s `ensureMonaco()` calls
 * `modern-monaco`'s `init()`, which internally fetches its editor core AND, unexpectedly, even the
 * locally-supplied theme JSON (`https://esm.sh/tm-themes@.../themes/one-dark-pro.json`) from esm.sh at
 * runtime — contradicting this app's own "no CDN dependency" comment in `use-monaco-editor.ts`. With
 * that host blocked the fetch rejects (`TypeError: Failed to fetch`), which surfaces only as a
 * `console.error` from Vue's async-lifecycle error handling (`onMounted(async () => ...)`), never an
 * uncaught `pageerror` — the Source tab's Monaco container simply never mounts an editor, and every
 * other panel/header control is unaffected. This suite treats that as the current, acceptable baseline;
 * self-hosting `modern-monaco` instead is tracked separately in issue #30.
 */

test('app loads with header controls and all five panel tabs', async ({ page }) => {
	await page.goto('/')

	await expect(page.getByLabel('Switch showcase'))
		.toBeVisible()
	await expect(page.getByLabel('Load a preset'))
		.toBeVisible()
	await expect(page.getByRole('button', { name: 'Apply' }))
		.toBeVisible()

	for (const name of ['Source', 'Blueprint', 'Runtime', 'Graph', 'Preview']) {
		await expect(page.getByRole('tab', { name }))
			.toBeVisible()
	}
})

test('shell survives modern-monaco failing to load from its (blocked) CDN', async ({ page }) => {
	const pageErrors: Error[] = []
	page.on('pageerror', error => pageErrors.push(error))

	await page.goto('/')
	// Give the Source tab's `ensureMonaco()` promise time to settle (reject) before asserting the rest
	// of the shell is unaffected.
	await page.waitForTimeout(1000)

	await expect(page.getByText('Blueprint: valid'))
		.toBeVisible()
	await expect(page.getByText('Runtime: active'))
		.toBeVisible()

	// Every other panel still works — Monaco's failure is isolated to the Source tab.
	await page.getByRole('tab', { name: 'Blueprint' })
		.click()
	await expect(page.getByRole('tab', { name: 'Blueprint' }))
		.toHaveAttribute('aria-selected', 'true')

	expect(pageErrors)
		.toEqual([])
})

test('panel close/recovery policy is enforced (issue #27)', async ({ page }) => {
	await page.goto('/')

	const panelNames = ['Source', 'Blueprint', 'Runtime', 'Graph', 'Preview']

	// The five canonical panels use a custom Dockview tab renderer (`NonClosableTab.vue`) that never
	// renders a close control — so there is no in-tab button affordance to find at all.
	for (const name of panelNames) {
		const tab = page.getByRole('tab', { name })
		await expect(tab)
			.toBeVisible()
		await expect(tab.getByRole('button'))
			.toHaveCount(0)
	}

	// Attempt the interaction that used to close a panel — clicking where a close "x" used to sit, at
	// the tab's trailing edge — and confirm it is a no-op: every canonical tab remains present.
	const graphTab = page.getByRole('tab', { name: 'Graph' })
	const box = (await graphTab.boundingBox())!
	await page.mouse.click(box.x + box.width - 4, box.y + box.height / 2)

	for (const name of panelNames) {
		await expect(page.getByRole('tab', { name }))
			.toBeVisible()
	}
})

test('narrow-viewport behavior is intentional (issue #27)', async ({ page }) => {
	await page.setViewportSize({ width: 375, height: 667 })
	await page.goto('/')

	const gateMessage = page.getByText('Widget Lab is designed for a desktop-sized viewport. Widen the window to continue.')
	await expect(gateMessage)
		.toBeVisible()

	const hasHorizontalOverflow = await page.evaluate(
		() => document.documentElement.scrollWidth > document.documentElement.clientWidth,
	)
	expect(hasHorizontalOverflow)
		.toBe(false)

	await page.setViewportSize({ width: 1280, height: 800 })
	await expect(gateMessage)
		.toBeHidden()
	await expect(page.getByRole('tab', { name: 'Source' }))
		.toBeVisible()
})
