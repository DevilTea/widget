import type { Locator, Page } from '@playwright/test'
import { chooseTutorialMenuItem, expect, loadPreset, openDeveloperTool, previewFrame, test } from './fixtures'

/**
 * Issue #230 PR 3b (audit U12, U13): the workbench's default width, the layout that survives a reload (and what
 * happens when the saved data is old, corrupt or unusable), "Reset layout", and the tutorial rail as a docked
 * column. Geometry is read from the real DOM; nothing here retries an action until it passes.
 */

const LAYOUT_KEY = 'widget-lab:layout'
const CANONICAL_PANELS = ['author', 'explain', 'widget', 'blueprint', 'runtime', 'dependencies', 'preview']

/** The Dockview group (tool area or Preview) that holds the tab with this name. */
function group(page: Page, tabName: string): Locator {
	return page.locator('.dv-groupview')
		.filter({ has: page.getByRole('tab', { name: tabName, exact: true }) })
}

async function width(locator: Locator): Promise<number> {
	return (await locator.boundingBox())!.width
}

async function toolWidth(page: Page): Promise<number> {
	return width(group(page, 'Author'))
}

/** The saved layout's first group size, i.e. the tool area width Dockview last reported. */
async function savedToolSize(page: Page): Promise<number | null> {
	return page.evaluate((key) => {
		const raw = localStorage.getItem(key)
		if (raw === null)
			return null
		return JSON.parse(raw).layout.grid.root.data[0].size as number
	}, LAYOUT_KEY)
}

/** Drags the divider between the tool area and the Preview by `dx` pixels, with the real mouse. */
async function dragDivider(page: Page, dx: number): Promise<void> {
	const box = (await page.locator('.dv-sash')
		.first()
		.boundingBox())!
	const x = box.x + box.width / 2
	const y = box.y + 120
	await page.mouse.move(x, y)
	await page.mouse.down()
	await page.mouse.move(x + dx, y, { steps: 6 })
	await page.mouse.up()
}

async function openLab(page: Page, query = 'showcase=survey'): Promise<void> {
	await page.goto(`/?${query}`)
	await expect(page.getByRole('tab', { name: 'Author', exact: true }))
		.toBeVisible()
	await expect(previewFrame(page)
		.getByRole('heading', { name: 'Maker Space open day: sign-up' }))
		.toBeVisible()
}

test.describe('default layout (U12)', () => {
	for (const [vw, vh] of [[1280, 800], [1440, 900], [1920, 1080]] as const) {
		test(`gives the tool area about half the width at ${vw}x${vh}`, async ({ page }) => {
			await page.setViewportSize({ width: vw, height: vh })
			await openLab(page)

			const tool = await toolWidth(page)
			const preview = await width(group(page, 'Preview'))
			// Was about 29% (546px at 1440), which clipped Relations and the Implementation source.
			expect(tool / vw, 'tool area share of the window')
				.toBeGreaterThan(0.44)
			expect(tool / vw)
				.toBeLessThan(0.52)
			expect(tool, 'capped')
				.toBeLessThanOrEqual(940)
			expect(preview, 'Preview keeps the larger or equal share')
				.toBeGreaterThanOrEqual(tool - 2)
			expect(tool + preview, 'the two groups fill the workbench')
				.toBeCloseTo(vw, 0)
		})
	}

	test('Relations is readable at the default width: its three columns are not clipped', async ({ page }) => {
		await page.setViewportSize({ width: 1440, height: 900 })
		await openLab(page)
		await page.getByRole('tab', { name: 'Blueprint', exact: true })
			.click()
		await page.getByRole('button', { name: /sessions : MultipleChoice/ })
			.click()
		await page.getByRole('tab', { name: 'Dependencies', exact: true })
			.click()

		const surface = page.locator('.relations-view-surface')
		await expect(surface)
			.toBeVisible()
		const clipped = await surface.evaluate(element => element.scrollWidth > element.clientWidth + 1)
		expect(clipped, 'horizontal clipping of Relations')
			.toBe(false)
		const tool = (await group(page, 'Author')
			.boundingBox())!
		for (const heading of ['Used by', 'Focused widget', 'Depends on']) {
			// Within Relations: the Graph stays mounted (hidden) and tags the edges of the focused widget with the same two words.
			const box = (await surface.getByText(heading, { exact: true })
				.first()
				.boundingBox())!
			expect(box.x + box.width, `${heading} inside the tool area`)
				.toBeLessThanOrEqual(tool.x + tool.width)
		}
	})
})

test.describe('saved layout', () => {
	test('a resized divider and the active tab come back after a reload', async ({ page }) => {
		await page.setViewportSize({ width: 1440, height: 900 })
		await openLab(page)
		const before = await toolWidth(page)

		await dragDivider(page, 150)
		await page.getByRole('tab', { name: 'Runtime', exact: true })
			.click()
		const resized = await toolWidth(page)
		expect(resized)
			.toBeGreaterThan(before + 100)
		// Saved once the layout settles (debounced), not on every pixel.
		await expect.poll(() => savedToolSize(page))
			.toBeCloseTo(resized, -1)

		await page.reload()
		await expect(page.getByRole('tab', { name: 'Runtime', exact: true }))
			.toHaveAttribute('aria-selected', 'true')
		expect(await toolWidth(page))
			.toBeCloseTo(resized, -1)
		for (const name of ['Author', 'Explain', 'Selected widget', 'Blueprint', 'Dependencies', 'Preview']) {
			await expect(page.getByRole('tab', { name, exact: true }))
				.toBeVisible()
		}
	})

	test('the layout of a wide window is fitted to a narrower one on restore', async ({ page }) => {
		await page.setViewportSize({ width: 1920, height: 1080 })
		await openLab(page)
		await dragDivider(page, 200)
		const wide = await toolWidth(page)
		await expect.poll(() => savedToolSize(page))
			.toBeCloseTo(wide, -1)

		await page.setViewportSize({ width: 1280, height: 800 })
		await page.reload()
		await expect(page.getByRole('tab', { name: 'Author', exact: true }))
			.toBeVisible()
		const tool = await toolWidth(page)
		const preview = await width(group(page, 'Preview'))
		expect(tool + preview, 'the groups fill the narrower window')
			.toBeCloseTo(1280, 0)
		expect(tool, 'both groups stay usable')
			.toBeGreaterThan(400)
		expect(preview)
			.toBeGreaterThan(400)
		expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth))
			.toBe(true)
	})

	test('Reset layout in the overflow menu forgets the saved layout and restores the default', async ({ page }) => {
		await page.setViewportSize({ width: 1440, height: 900 })
		await openLab(page)
		const initial = await toolWidth(page)
		await dragDivider(page, 150)
		await page.getByRole('tab', { name: 'Blueprint', exact: true })
			.click()
		await expect.poll(() => savedToolSize(page))
			.toBeCloseTo(initial + 150, -1)

		await page.getByTestId('overflow-menu')
			.click()
		await page.getByRole('menuitem', { name: 'Reset layout', exact: true })
			.click()

		await expect(page.getByRole('tab', { name: 'Author', exact: true }))
			.toHaveAttribute('aria-selected', 'true')
		expect(await toolWidth(page))
			.toBeCloseTo(initial, -1)
		for (const name of ['Explain', 'Selected widget', 'Blueprint', 'Runtime', 'Dependencies', 'Preview']) {
			await expect(page.getByRole('tab', { name, exact: true }))
				.toBeVisible()
		}
		// The default is what is saved now: a reload keeps it.
		await expect.poll(() => savedToolSize(page))
			.toBeCloseTo(initial, -1)
		await page.reload()
		expect(await toolWidth(page))
			.toBeCloseTo(initial, -1)
	})

	test('panels opened on request (Implementation) are not restored after a reload', async ({ page }) => {
		await openLab(page)
		await openDeveloperTool(page, 'implementation')
		// Implementation is the active tab in what was saved.
		await expect.poll(() => page.evaluate(key => localStorage.getItem(key)
			?.includes('"activeView":"implementation"'), LAYOUT_KEY))
			.toBe(true)

		await page.reload()
		await expect(page.getByRole('tab', { name: 'Author', exact: true }))
			.toBeVisible()
		await expect(page.getByRole('tab', { name: 'Implementation', exact: true }))
			.toHaveCount(0)
		await expect(page.getByRole('tab', { name: 'Runtime', exact: true }))
			.toBeVisible()
		// A canonical tab is active (the first one), not whatever neighbour closing Implementation would have left.
		await expect(page.getByRole('tab', { name: 'Author', exact: true }))
			.toHaveAttribute('aria-selected', 'true')
		await expect(page.getByRole('tab', { name: 'Dependencies', exact: true }))
			.toHaveAttribute('aria-selected', 'false')
	})

	test('the restored active tab is the store\'s active tab too: a request for Author from outside Dockview still switches to it', async ({ page }) => {
		// Nothing in Dockview is clicked after the reload and no menu is opened: the Examples menu and a panel click
		// both hand focus to Dockview, which reports its own activation. Only the header's Apply (outside Dockview)
		// and the notice's button are used, so the only thing that can know Runtime is the open tab is the store.
		await page.goto('/?showcase=survey&lab-test')
		await page.waitForFunction(() => typeof (window as any).__WIDGET_LAB_TEST__?.setDraftSourceText === 'function')
		await page.getByRole('tab', { name: 'Runtime', exact: true })
			.click()
		await expect.poll(() => page.evaluate(key => localStorage.getItem(key)
			?.includes('"activeView":"runtime"'), LAYOUT_KEY))
			.toBe(true)

		await page.reload()
		await page.waitForFunction(() => typeof (window as any).__WIDGET_LAB_TEST__?.setDraftSourceText === 'function')
		await expect(page.getByRole('tab', { name: 'Runtime', exact: true }))
			.toHaveAttribute('aria-selected', 'true')
		// An invalid apply leaves the preview behind; its notice asks for the Author tab.
		await page.evaluate(() => (window as any).__WIDGET_LAB_TEST__.setDraftSourceText('{ "id": "x", "type": "NotAWidget" }'))
		await page.getByRole('button', { name: 'Apply', exact: true })
			.click()
		await page.getByRole('button', { name: 'Show problems' })
			.click()
		await expect(page.getByRole('tab', { name: 'Author', exact: true }))
			.toHaveAttribute('aria-selected', 'true')
		await expect(page.getByTestId('author-problems'))
			.toBeVisible()
	})

	test('a panel opened on request that sits alone in its own group is dropped; the rest of the layout, dividers included, is kept', async ({ page }) => {
		await page.setViewportSize({ width: 1440, height: 900 })
		await openLab(page)
		await dragDivider(page, 120)
		const dragged = await toolWidth(page)
		await expect.poll(() => savedToolSize(page))
			.toBeCloseTo(dragged, -1)

		// What the user would have saved after dragging Implementation under the tool group: a column holding the tool
		// group and Implementation in a group of its own. It is put in storage by an init script of the next document,
		// because leaving this one writes the current layout over whatever is in storage (the pagehide save).
		const crafted = await page.evaluate((key) => {
			const stored = JSON.parse(localStorage.getItem(key)!)
			const { layout } = stored
			const tools = layout.grid.root.data[0]
			const height = layout.grid.height
			layout.grid.root.data[0] = {
				type: 'branch',
				size: tools.size,
				data: [
					{ ...tools, size: Math.round(height * 0.6) },
					{ type: 'leaf', data: { views: ['implementation'], activeView: 'implementation', id: 'lazy-group' }, size: Math.round(height * 0.4) },
				],
			}
			layout.panels.implementation = { id: 'implementation', contentComponent: 'implementation', title: 'Implementation' }
			return JSON.stringify(stored)
		}, LAYOUT_KEY)
		await page.addInitScript(({ key, value }) => {
			if (sessionStorage.getItem('crafted-layout-written') === null) {
				localStorage.setItem(key, value)
				sessionStorage.setItem('crafted-layout-written', '1')
			}
		}, { key: LAYOUT_KEY, value: crafted })

		await page.goto('/?showcase=survey')
		await expect(page.getByRole('tab', { name: 'Author', exact: true }))
			.toBeVisible()
		await expect(page.getByRole('tab', { name: 'Implementation', exact: true }))
			.toHaveCount(0)
		// The divider is where the user left it, not at the default 48%.
		expect(await toolWidth(page))
			.toBeCloseTo(dragged, -1)
		expect(Math.abs(dragged / 1440 - 0.48))
			.toBeGreaterThan(0.04)
		// Both groups are still there and usable.
		await page.getByRole('tab', { name: 'Runtime', exact: true })
			.click()
		await expect(page.getByRole('tab', { name: 'Runtime', exact: true }))
			.toHaveAttribute('aria-selected', 'true')
		await expect(page.getByRole('tab', { name: 'Preview', exact: true }))
			.toBeVisible()
	})
})

test.describe('unusable saved layouts fall back to the default', () => {
	const goodPanels = Object.fromEntries(CANONICAL_PANELS.map(id => [id, { id, contentComponent: id, tabComponent: 'nonClosable', title: id }]))
	const grid = (views: string[]) => ({
		root: { type: 'leaf', data: { views, activeView: views[0], id: '1' }, size: 500 },
		width: 1440,
		height: 859,
		orientation: 'HORIZONTAL',
	})
	const cases: readonly { readonly name: string, readonly stored: unknown, /** The stored value must be gone or replaced by a layout of the current version. */ readonly rewritten: boolean }[] = [
		{ name: 'invalid JSON', stored: '{not json', rewritten: true },
		{ name: 'an older layout version', stored: { version: 0, layout: { grid: grid(CANONICAL_PANELS), panels: goodPanels } }, rewritten: true },
		{ name: 'a newer layout version', stored: { version: 2, layout: { grid: grid(CANONICAL_PANELS), panels: goodPanels } }, rewritten: true },
		{ name: 'a layout without the Selected widget panel (saved before it existed)', stored: { version: 1, layout: { grid: grid(['author', 'blueprint', 'runtime', 'dependencies', 'preview']), panels: Object.fromEntries(Object.entries(goodPanels)
			.filter(([id]) => id !== 'widget')) } }, rewritten: true },
		{ name: 'a layout without the Explain panel (saved before Lab UX phase 2)', stored: { version: 1, layout: { grid: grid(['author', 'widget', 'blueprint', 'runtime', 'events', 'dependencies', 'preview']), panels: { ...Object.fromEntries(Object.entries(goodPanels)
			.filter(([id]) => id !== 'explain')), events: { id: 'events', contentComponent: 'events', tabComponent: 'nonClosable', title: 'Events' } } } }, rewritten: true },
		{ name: 'a panel naming a component the Lab does not have', stored: { version: 1, layout: { grid: grid(CANONICAL_PANELS), panels: { ...goodPanels, runtime: { id: 'runtime', contentComponent: 'gone', title: 'Runtime' } } } }, rewritten: true },
		{ name: 'a layout that looks right but names a panel that does not exist', stored: { version: 1, layout: { grid: grid(['ghost']), panels: goodPanels } }, rewritten: true },
		{ name: 'a number', stored: 42, rewritten: true },
	]

	for (const { name, stored } of cases) {
		test(`${name}`, async ({ page }) => {
			const pageErrors: string[] = []
			page.on('pageerror', error => pageErrors.push(error.message))
			await page.setViewportSize({ width: 1440, height: 900 })
			// Top frame only: the same-origin Preview iframe would run the script too and put the bad data back.
			await page.addInitScript(([key, value]) => {
				if (window === window.top)
					localStorage.setItem(key!, value!)
			}, [LAYOUT_KEY, typeof stored === 'string' ? stored : JSON.stringify(stored)])
			await openLab(page)

			// The default layout, fully working.
			expect(await toolWidth(page) / 1440)
				.toBeGreaterThan(0.44)
			for (const tab of ['Author', 'Explain', 'Selected widget', 'Blueprint', 'Runtime', 'Dependencies', 'Preview']) {
				await expect(page.getByRole('tab', { name: tab, exact: true }))
					.toBeVisible()
			}
			await expect(page.getByRole('tab', { name: 'Author', exact: true }))
				.toHaveAttribute('aria-selected', 'true')
			expect(pageErrors)
				.toEqual([])

			// What is stored afterwards is nothing yet or a current, usable layout (the default, saved once it settles): never the bad data.
			await expect.poll(() => page.evaluate((key) => {
				const raw = localStorage.getItem(key)
				if (raw === null)
					return 'none'
				try {
					const parsed = JSON.parse(raw)
					return parsed.version === 1 && Object.keys(parsed.layout.panels).length === 6 && parsed.layout.panels.runtime.contentComponent === 'runtime' ? 'current' : 'stale'
				}
				catch {
					return 'corrupt'
				}
			}, LAYOUT_KEY))
				.toMatch(/^(none|current)$/)
		})
	}

	test('blocked storage (localStorage throws) still loads the default layout', async ({ page }) => {
		const pageErrors: string[] = []
		page.on('pageerror', error => pageErrors.push(error.message))
		await page.setViewportSize({ width: 1440, height: 900 })
		await page.addInitScript(() => {
			Object.defineProperty(window, 'localStorage', {
				get() {
					throw new DOMException('blocked', 'SecurityError')
				},
			})
		})
		await openLab(page)

		expect(await toolWidth(page) / 1440)
			.toBeGreaterThan(0.44)
		await dragDivider(page, 100)
		await page.getByRole('tab', { name: 'Runtime', exact: true })
			.click()
		await expect(page.getByRole('tab', { name: 'Runtime', exact: true }))
			.toHaveAttribute('aria-selected', 'true')
		expect(pageErrors)
			.toEqual([])
	})
})

test.describe('tutorial rail is a docked column (U13)', () => {
	async function startTour(page: Page): Promise<Locator> {
		await openLab(page)
		await chooseTutorialMenuItem(page)
		const rail = page.getByRole('complementary', { name: 'Tutorial' })
		await expect(rail)
			.toBeVisible()
		return rail
	}

	function intersects(a: { x: number, y: number, width: number, height: number }, b: { x: number, y: number, width: number, height: number }): boolean {
		return a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y
	}

	for (const [vw, vh] of [[1280, 800], [1440, 900], [1920, 1080]] as const) {
		test(`does not cover the header, the overflow menu, the Dockview groups or the survey's Language menu at ${vw}x${vh}`, async ({ page }) => {
			await page.setViewportSize({ width: vw, height: vh })
			const rail = await startTour(page)

			const railBox = (await rail.boundingBox())!
			const headerBox = (await page.getByRole('banner')
				.boundingBox())!
			expect(railBox.y, 'starts below the header')
				.toBeGreaterThanOrEqual(headerBox.y + headerBox.height - 1)
			expect(railBox.x + railBox.width, 'flush with the right edge')
				.toBeCloseTo(vw, 0)
			expect(intersects(railBox, headerBox), 'header')
				.toBe(false)
			for (const id of ['overflow-menu', 'document-status', 'preview-status', 'apply-button']) {
				const box = (await page.getByTestId(id)
					.boundingBox())!
				expect(intersects(railBox, box), id)
					.toBe(false)
			}
			// The two Dockview groups give up the rail's width instead of sitting under it.
			for (const tab of ['Author', 'Preview']) {
				const box = (await group(page, tab)
					.boundingBox())!
				expect(intersects(railBox, box), `${tab} group`)
					.toBe(false)
			}
			const languageBox = (await previewFrame(page)
				.getByRole('combobox', { name: 'Language' })
				.boundingBox())!
			expect(intersects(railBox, languageBox), 'survey Language select')
				.toBe(false)
			// Actually reachable: a click that something else covered would be refused by Playwright.
			await previewFrame(page)
				.getByRole('combobox', { name: 'Language' })
				.click()
			await page.keyboard.press('Escape')

			// The overflow menu opens and its items are under the pointer, not under the rail.
			await page.getByTestId('overflow-menu')
				.click()
			await expect(page.getByRole('menuitem', { name: 'Pause tutorial', exact: true }))
				.toBeVisible()
			await page.keyboard.press('Escape')
		})
	}

	test('the workbench width follows the rail: it shrinks when the tour opens and recovers when it closes', async ({ page }) => {
		await page.setViewportSize({ width: 1440, height: 900 })
		await openLab(page)
		const workbench = page.locator('.workbench')
		const before = await width(workbench)
		expect(before)
			.toBeCloseTo(1440, 0)

		await chooseTutorialMenuItem(page)
		const rail = page.getByRole('complementary', { name: 'Tutorial' })
		await expect(rail)
			.toBeVisible()
		await expect.poll(() => width(workbench))
			.toBeCloseTo(1440 - 320, 0)
		const groups = (await group(page, 'Author')
			.boundingBox())!.width + (await group(page, 'Preview')
			.boundingBox())!.width
		expect(groups, 'Dockview was laid out again for the narrower workbench')
			.toBeCloseTo(1440 - 320, 0)

		await rail.getByRole('button', { name: 'Close tutorial' })
			.click()
		await expect(rail)
			.toHaveCount(0)
		await expect.poll(() => width(workbench))
			.toBeCloseTo(1440, 0)
	})

	test('the rail\'s primary button is drawn in the accent colour and its close button is a 24px target', async ({ page }) => {
		await page.setViewportSize({ width: 1440, height: 900 })
		await openLab(page)
		await chooseTutorialMenuItem(page)
		const rail = page.getByRole('complementary', { name: 'Tutorial' })
		await expect(rail)
			.toBeVisible()

		const colours = await rail.evaluate((element) => {
			const probe = document.createElement('span')
			probe.style.backgroundColor = 'var(--lab-color-accent)'
			probe.style.color = 'var(--lab-color-surface-alt)'
			element.append(probe)
			const accent = getComputedStyle(probe).backgroundColor
			const surface = getComputedStyle(probe).color
			probe.remove()
			const background = (name: string): string => getComputedStyle([...element.querySelectorAll('footer button')]
				.find(button => button.textContent?.trim() === name)!).backgroundColor
			return { accent, surface, next: background('Next'), skip: background('Skip tour') }
		})
		expect(colours.next)
			.toBe(colours.accent)
		expect(colours.skip)
			.toBe(colours.surface)

		const close = (await rail.getByRole('button', { name: 'Close tutorial' })
			.boundingBox())!
		expect(close.width)
			.toBeGreaterThanOrEqual(24)
		expect(close.height)
			.toBeGreaterThanOrEqual(24)
	})

	test('the proportions the user chose survive opening the tour', async ({ page }) => {
		await page.setViewportSize({ width: 1440, height: 900 })
		await openLab(page)
		await dragDivider(page, 120)
		const resized = await toolWidth(page)
		await expect.poll(() => savedToolSize(page))
			.toBeCloseTo(resized, -1)
		await loadPreset(page, 'survey-default')
		await chooseTutorialMenuItem(page)
		await expect(page.getByRole('complementary', { name: 'Tutorial' }))
			.toBeVisible()
		// The rail narrowed the workbench, but the proportions the user chose stay.
		const tool = await toolWidth(page)
		const preview = await width(group(page, 'Preview'))
		expect(tool / (tool + preview))
			.toBeCloseTo(resized / 1440, 1)
	})

	test('Relations is usable beside the open rail at 1280x800: its columns stack instead of scrolling sideways', async ({ page }) => {
		await page.setViewportSize({ width: 1280, height: 800 })
		await openLab(page)
		await chooseTutorialMenuItem(page)
		await expect(page.getByRole('complementary', { name: 'Tutorial' }))
			.toBeVisible()
		await page.getByRole('tab', { name: 'Blueprint', exact: true })
			.click()
		await page.getByRole('button', { name: /sessions : MultipleChoice/ })
			.click()
		await page.getByRole('tab', { name: 'Dependencies', exact: true })
			.click()

		const tool = (await group(page, 'Dependencies')
			.boundingBox())!
		expect(tool.width, 'the tool area is narrow here')
			.toBeLessThan(600)
		const surface = page.locator('.relations-view-surface')
		await expect(surface)
			.toBeVisible()
		expect(await surface.evaluate(element => element.scrollWidth > element.clientWidth + 1), 'sideways scrolling')
			.toBe(false)
		const columns = ['incoming', 'center', 'outgoing'] as const
		const boxes = []
		for (const column of columns) {
			boxes.push((await page.locator(`.relations-column--${column}`)
				.boundingBox())!)
		}
		for (const box of boxes) {
			expect(box.x, 'inside the tool area')
				.toBeGreaterThanOrEqual(tool.x - 1)
			expect(box.x + box.width, 'inside the tool area')
				.toBeLessThanOrEqual(tool.x + tool.width + 1)
		}
		// One above the other, in the order Used by, the focus, Depends on.
		expect(boxes[1]!.y)
			.toBeGreaterThanOrEqual(boxes[0]!.y + boxes[0]!.height - 1)
		expect(boxes[2]!.y)
			.toBeGreaterThanOrEqual(boxes[1]!.y + boxes[1]!.height - 1)
		for (const heading of ['Used by', 'Focused widget', 'Depends on']) {
			await expect(surface.getByText(heading, { exact: true })
				.first())
				.toBeVisible()
		}
	})

	test('Relations keeps its three columns when the pane is wide enough', async ({ page }) => {
		await page.setViewportSize({ width: 1920, height: 1080 })
		await openLab(page)
		await page.getByRole('tab', { name: 'Blueprint', exact: true })
			.click()
		await page.getByRole('button', { name: /sessions : MultipleChoice/ })
			.click()
		await page.getByRole('tab', { name: 'Dependencies', exact: true })
			.click()
		const [incoming, center, outgoing] = await Promise.all(['incoming', 'center', 'outgoing'].map(async column => (await page.locator(`.relations-column--${column}`)
			.boundingBox())!))
		expect(Math.abs(incoming!.y - center!.y))
			.toBeLessThan(2)
		expect(Math.abs(center!.y - outgoing!.y))
			.toBeLessThan(2)
		expect(center!.x)
			.toBeGreaterThan(incoming!.x + 100)
	})
})
