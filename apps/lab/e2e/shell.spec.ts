import { expect, test } from './fixtures'

/**
 * Issue #28 Lab shell / workbench contract: the app loads with the header's showcase/preset/Apply
 * controls and all five workbench panel tabs (`Workbench.vue`'s Source/Blueprint/Runtime/Graph/Preview)
 * available.
 *
 * Loaded against the network-blocked BUILT app (see `fixtures.ts`/`playwright.config.ts`) — Source is
 * the initially active tab, so this also exercises the Source editor initializing under that block.
 */

test('app loads with header controls and all five panel tabs', async ({ page }) => {
	await page.goto('/')

	await expect(page.getByLabel('Switch showcase'))
		.toBeVisible()
	await expect(page.getByLabel('Load a preset'))
		.toBeVisible()
	await expect(page.getByRole('button', { name: 'Apply' }))
		.toBeVisible()

	for (const name of ['Author', 'Blueprint', 'Runtime', 'Graph', 'Preview']) {
		await expect(page.getByRole('tab', { name }))
			.toBeVisible()
	}
})

test('Blueprint and Runtime keep separate outer inspector surfaces', async ({ page }) => {
	await page.goto('/')

	for (const name of ['Blueprint', 'Runtime']) {
		await page.getByRole('tab', { name })
			.click()
		const panel = page.getByRole('tabpanel', { name })
		await expect(panel.getByTestId('inspector-panel-shell'))
			.toHaveCount(1)
		await expect(panel.getByTestId('inspector-split-layout'))
			.toHaveCount(1)
	}
})

/**
 * Issue #30 Scope C offline/self-contained browser contract. Supersedes the previous test on this spot
 * ("shell survives modern-monaco failing to load from its (blocked) CDN"), whose premise (Monaco
 * necessarily fails to load with external network blocked, because `modern-monaco` fetches its editor
 * core AND a built-in JSON language server from esm.sh) is obsolete now that Scope A self-hosts both:
 * the editor engine via the vendored `modern-monaco/editor-core` importmap entry
 * (`vite-plugin-vendor-modern-monaco-editor-core.ts`), and the built-in-LSP CDN fetch is avoided
 * entirely by importing `modern-monaco/core` rather than the package's main entry
 * (`use-monaco-editor.ts`'s `ensureMonaco()`) — this app never used or wanted Monaco/LSP diagnostics in
 * the first place (`JSON.parse` at Apply time is the sole authoritative syntax boundary).
 *
 * This proves a POSITIVE contract instead: the Source editor actually initializes from local assets
 * with external network blocked — a real Monaco surface (`.monaco-editor`) mounts and renders the
 * active preset's draft text (`.view-lines`, Sandbox's default preset text) — AND that this happens
 * without a single attempted request to esm.sh (or anywhere else off-origin): `fixtures.ts`'s
 * `blockedRequestUrls` fixture records every URL the route handler had to abort, and the assertion
 * below is that none of them contain `esm.sh` — not merely that a blocked one failed silently.
 */
test('Source editor initializes from local assets with no attempted esm.sh request (issue #30)', async ({ page, blockedRequestUrls }) => {
	const pageErrors: Error[] = []
	page.on('pageerror', error => pageErrors.push(error))

	await page.goto('/')

	const editor = page.locator('.monaco-editor')
	await expect(editor)
		.toBeVisible({ timeout: 10_000 })

	// Real content rendered, not just an empty shell — the Sandbox showcase's default preset text
	// (`src/sandbox/presets.ts`'s `defaultSandboxPreset`) is visible through Monaco's own tokenized
	// view, proving the model/tokenizer/theme pipeline actually ran, not merely that a container div
	// exists.
	await expect(page.locator('.view-lines'))
		.toContainText('Widget Lab sandbox')

	// Every other panel/header control is unaffected (unchanged from before self-hosting).
	await expect(page.getByText('Blueprint: valid'))
		.toBeVisible()
	await expect(page.getByText('Preview r0'))
		.toBeVisible()
	await page.getByRole('tab', { name: 'Blueprint' })
		.click()
	await expect(page.getByRole('tab', { name: 'Blueprint' }))
		.toHaveAttribute('aria-selected', 'true')

	expect(pageErrors)
		.toEqual([])
	expect(blockedRequestUrls.some(url => url.includes('esm.sh')))
		.toBe(false)
})

test('panel close/recovery policy is enforced (issue #27)', async ({ page }) => {
	await page.goto('/')

	const panelNames = ['Author', 'Blueprint', 'Runtime', 'Graph', 'Preview']

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
	await expect(page.getByRole('tab', { name: 'Author' }))
		.toBeVisible()
})
