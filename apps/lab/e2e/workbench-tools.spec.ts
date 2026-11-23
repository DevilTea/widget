import type { Locator, Page } from '@playwright/test'
import type { ToolId } from './fixtures'
import { chooseTutorialMenuItem, expect, openEditStructure, openExplain, openTool, previewFrame, setLocale, test, toolsMenu, toolTab, workbenchTab } from './fixtures'

/**
 * Lab UX phase 3B (design "information architecture"): the tool group is Edit / Explain / Tools. Tools is a menu of the expert
 * views, each of which opens as its own closable, named tab in a Tools group beside the Preview, never inside the Edit/Explain
 * group; the Catalog is a slide-over of Edit; toggling Edit to JSON reveals the selected widget. Geometry is read from the DOM.
 */

const LAYOUT_KEY = 'widget-lab:layout'

async function openLab(page: Page, query = 'showcase=survey'): Promise<void> {
	await page.goto(`/?${query}`)
	await expect(workbenchTab(page, 'edit'))
		.toBeVisible()
	await expect(previewFrame(page)
		.getByRole('heading', { name: 'Maker Space open day: sign-up' }))
		.toBeVisible()
}

/** The Dockview group that holds `tab`. */
function groupOf(page: Page, tab: Locator): Locator {
	return page.locator('.dv-groupview')
		.filter({ has: tab })
}

const previewTab = (page: Page): Locator => page.getByRole('tab', { name: 'Preview', exact: true })

type Box = NonNullable<Awaited<ReturnType<Locator['boundingBox']>>>
function intersects(a: Box, b: Box): boolean {
	return a.x < b.x + b.width - 1 && a.x + a.width > b.x + 1 && a.y < b.y + b.height - 1 && a.y + a.height > b.y + 1
}

test.describe('the tool group: Edit, Explain, Tools', () => {
	test('the default layout shows exactly three tool tabs and the Preview, with no Tools group', async ({ page }) => {
		await openLab(page)
		const toolGroupTabs = groupOf(page, workbenchTab(page, 'edit'))
			.locator('.dv-tab')
		await expect(toolGroupTabs)
			.toHaveText(['Edit', 'Explain', 'Tools'])
		await expect(workbenchTab(page, 'edit'))
			.toHaveAttribute('aria-selected', 'true')
		// Every Dockview tab of the page: the three, and the Preview. No expert view is open yet.
		await expect(page.locator('.dv-tab'))
			.toHaveText(['Edit', 'Explain', 'Tools', 'Preview'])
		await expect(page.locator('.dv-groupview'))
			.toHaveCount(2)
		// Edit opens on Structure, with JSON as its in-panel toggle and the Catalog behind "Browse widget types".
		await expect(page.getByRole('tablist', { name: 'Edit views' })
			.getByRole('tab'))
			.toHaveText(['Structure', 'JSON'])
		await expect(page.getByTestId('browse-widget-types'))
			.toHaveAccessibleName('Browse widget types')
	})

	test('the Tools menu lists every expert view with a one-line description and is operated from the keyboard', async ({ page }) => {
		await openLab(page)
		await workbenchTab(page, 'tools')
			.click()
		const entries = toolsMenu(page)
			.getByRole('button')
		await expect(entries)
			.toHaveCount(7)
		await expect(toolsMenu(page)
			.getByRole('list'))
			.toHaveAccessibleName('Expert views')
		const names = ['Blueprint tree', 'Runtime tree', 'Events log', 'Dependency graph and Relations', 'Selected widget', 'Document Tools', 'Implementation']
		for (const [index, name] of names.entries()) {
			await expect(entries.nth(index))
				.toHaveAccessibleName(name)
			await expect(entries.nth(index))
				.toHaveAccessibleDescription(/\S.+\./)
		}

		// Arrow keys move between the entries; Enter opens the focused one.
		await entries.first()
			.focus()
		await page.keyboard.press('ArrowDown')
		await expect(entries.nth(1))
			.toBeFocused()
		await page.keyboard.press('End')
		await expect(entries.nth(6))
			.toBeFocused()
		await page.keyboard.press('Home')
		await page.keyboard.press('ArrowDown')
		await page.keyboard.press('Enter')
		await expect(toolTab(page, 'runtime'))
			.toBeFocused()
		// An open view is marked in the menu.
		await expect(toolsMenu(page)
			.getByTestId('tools-entry-runtime'))
			.toHaveAttribute('data-open', 'true')
		await expect(toolsMenu(page)
			.getByTestId('tools-entry-runtime'))
			.toHaveAccessibleDescription(/Open$/)
	})
})

test.describe('the Tools group beside the Preview', () => {
	const NAMES: Readonly<Record<ToolId, string>> = {
		'blueprint': 'Blueprint tree',
		'runtime': 'Runtime tree',
		'events': 'Events log',
		'dependencies': 'Dependencies',
		'widget': 'Selected widget',
		'document-tools': 'Document Tools',
		// Nothing was chosen, so the focus is the root: Implementation names it.
		'implementation': 'Implementation — open-day (Survey)',
	}

	test('each entry opens a named, closable tab in one Tools group below the Preview, and opening it again focuses it', async ({ page }) => {
		await page.setViewportSize({ width: 1440, height: 900 })
		await openLab(page)
		const toolGroup = groupOf(page, workbenchTab(page, 'edit'))
		const previewGroup = groupOf(page, previewTab(page))

		for (const tool of Object.keys(NAMES) as ToolId[]) {
			const tab = await openTool(page, tool)
			await expect(tab)
				.toHaveAccessibleName(NAMES[tool])
			// Closable, unlike the three tool tabs.
			await expect(tab.locator('.dv-default-tab-action'))
				.toHaveCount(1)
			// Never in the Edit/Explain group.
			await expect(toolGroup.locator('.dv-tab')
				.filter({ hasText: NAMES[tool] }))
				.toHaveCount(0)
		}
		// One Tools group, below the Preview and as wide as it: the right column is split, the left one is not touched.
		const tools = groupOf(page, toolTab(page, 'blueprint'))
		await expect(tools.locator('.dv-tab'))
			.toHaveText(Object.values(NAMES))
		const [toolsBox, previewBox, leftBox] = await Promise.all([tools.boundingBox(), previewGroup.boundingBox(), toolGroup.boundingBox()])
		expect(toolsBox!.y, 'below the Preview')
			.toBeGreaterThanOrEqual(previewBox!.y + previewBox!.height - 1)
		expect(toolsBox!.x)
			.toBeCloseTo(previewBox!.x, 0)
		expect(toolsBox!.width)
			.toBeCloseTo(previewBox!.width, 0)
		expect(toolsBox!.height, 'about half the column')
			.toBeGreaterThan(300)
		expect(leftBox!.height, 'the tool group keeps its full height')
			.toBeGreaterThan(previewBox!.height + toolsBox!.height - 2)
		// The Preview is still the same running page (its frame was not reloaded by the split) and usable.
		await previewFrame(page)
			.getByLabel('On site', { exact: true })
			.check()
		await expect(previewFrame(page)
			.getByLabel('On site', { exact: true }))
			.toBeChecked()

		// Asking again for an open view focuses its tab and adds nothing.
		await openTool(page, 'runtime')
		await expect(toolTab(page, 'runtime'))
			.toHaveCount(1)
		await expect(tools.locator('.dv-tab'))
			.toHaveCount(7)

		// Closing every view gives the Preview its column back (the selected tab's close button, which a hidden tab does not show).
		for (let open = 7; open > 0; open--) {
			await tools.locator('.dv-tab[aria-selected="true"] .dv-default-tab-action')
				.click()
		}
		await expect(page.locator('.dv-groupview'))
			.toHaveCount(2)
	})

	test('opening a view keeps Edit or Explain on screen', async ({ page }) => {
		await openLab(page)
		await openEditStructure(page)
		await page.getByRole('button', { name: 'sessions : MultipleChoice' })
			.click()
		// From Edit, through the Preview's "View implementation": the view opens beside the Preview and takes focus, and Edit stays.
		await page.getByTestId('preview-view-implementation')
			.click()
		await expect(toolTab(page, 'implementation'))
			.toBeFocused()
		await expect(toolTab(page, 'implementation'))
			.toHaveAccessibleName('Implementation — sessions (MultipleChoice)')
		await expect(workbenchTab(page, 'edit'))
			.toHaveAttribute('aria-selected', 'true')
		await expect(page.getByTestId('structure-editor')
			.getByRole('heading', { name: 'sessions : MultipleChoice' }))
			.toBeVisible()

		// From Explain, through a link inside it: the Graph opens beside the Preview and Explain stays.
		await openExplain(page)
		await expect(page.getByTestId('explain-identity'))
			.toContainText('#sessions')
		await page.getByTestId('explain-open-graph')
			.click()
		await expect(toolTab(page, 'dependencies'))
			.toBeFocused()
		await expect(workbenchTab(page, 'explain'))
			.toHaveAttribute('aria-selected', 'true')
		await expect(page.getByTestId('explain-identity'))
			.toBeVisible()
	})
})

test.describe('the Catalog slide-over (Browse widget types)', () => {
	test('opens as a modal dialog over Edit, keeps focus inside, closes with Escape or its button, and gives focus back', async ({ page }) => {
		await openLab(page)
		const browse = page.getByTestId('browse-widget-types')
		await browse.click()
		const dialog = page.getByRole('dialog', { name: 'Widget types' })
		await expect(dialog)
			.toBeVisible()
		// Focus starts on its first control, the close button.
		await expect(dialog.getByRole('button', { name: 'Close widget types' }))
			.toBeFocused()
		// The content is the Catalog as it was: the types with their documentation, the schemas, Copy catalog JSON.
		await expect(dialog.getByTestId('author-catalog-Numeric'))
			.toBeVisible()
		await expect(dialog.getByTestId('author-catalog-schema-Numeric'))
			.toBeVisible()
		// The page behind is inert: Tab never leaves the dialog.
		for (let step = 0; step < 6; step++) {
			await page.keyboard.press('Tab')
			expect(await dialog.evaluate(element => element.contains(document.activeElement)), `Tab ${step + 1}`)
				.toBe(true)
		}

		// Copy still works from inside the dialog.
		await page.evaluate(() => {
			Object.defineProperty(navigator, 'clipboard', {
				configurable: true,
				value: { writeText: async (text: string) => { (window as unknown as { copiedCatalog?: string }).copiedCatalog = text } },
			})
		})
		await dialog.getByTestId('author-catalog-copy')
			.click()
		await expect(dialog.getByTestId('author-catalog-copy'))
			.toHaveText('Copied')
		const copied = await page.evaluate(() => (window as unknown as { copiedCatalog?: string }).copiedCatalog)
		expect((JSON.parse(copied!) as { widgets: { type: string }[] }).widgets.map(widget => widget.type))
			.toContain('Numeric')

		await page.keyboard.press('Escape')
		await expect(dialog)
			.toBeHidden()
		await expect(browse)
			.toBeFocused()
		// Edit is where it was.
		await expect(page.getByTestId('structure-editor'))
			.toBeVisible()

		await browse.click()
		await dialog.getByRole('button', { name: 'Close widget types' })
			.click()
		await expect(dialog)
			.toBeHidden()
		await expect(browse)
			.toBeFocused()
	})
})

test.describe('the JSON toggle reveals the selected widget', () => {
	test('switching Edit to JSON selects and scrolls to the selected widget\'s lines, and leaves focus on the toggle', async ({ page }) => {
		await page.setViewportSize({ width: 1280, height: 800 })
		await openLab(page)
		await openEditStructure(page)
		// The last question: far down the document.
		await page.getByRole('button', { name: 'phone : ShortAnswer' })
			.click()
		const jsonTab = page.getByTestId('author-view-json')
		await jsonTab.click()
		const editor = page.getByTestId('json-editor')
		await expect(editor.locator('.monaco-editor'))
			.toBeVisible()
		// Its lines are on screen and highlighted as the selection.
		await expect(editor.locator('.view-line')
			.filter({ hasText: '"id": "phone"' }))
			.toBeVisible()
		await expect(editor.locator('.selected-text')
			.first())
			.toBeAttached()
		await expect(jsonTab)
			.toBeFocused()
		// The document starts far above: its first line is scrolled out of view.
		await expect(editor.locator('.view-line')
			.filter({ hasText: '"type": "Survey"' }))
			.toHaveCount(0)
	})

	test('with nothing chosen, the JSON view opens at the top and selects nothing', async ({ page }) => {
		await openLab(page)
		await page.getByTestId('author-view-json')
			.click()
		const editor = page.getByTestId('json-editor')
		await expect(editor.locator('.view-line')
			.filter({ hasText: '"type": "Survey"' }))
			.toBeVisible()
		await expect(editor.locator('.selected-text'))
			.toHaveCount(0)
	})
})

test.describe('layout version 2', () => {
	test('a layout saved by the six-tab workbench (version 1) is reset once to Edit, Explain, Tools', async ({ page }) => {
		const panel = (id: string, title: string) => [id, { id, contentComponent: id, tabComponent: 'nonClosable', title }] as const
		const oldLayout = {
			version: 1,
			layout: {
				grid: {
					root: {
						type: 'branch',
						size: 859,
						data: [
							{ type: 'leaf', data: { views: ['author', 'explain', 'widget', 'blueprint', 'runtime', 'events', 'dependencies'], activeView: 'runtime', id: '1' }, size: 900 },
							{ type: 'leaf', data: { views: ['preview'], activeView: 'preview', id: '2' }, size: 540 },
						],
					},
					width: 1440,
					height: 859,
					orientation: 'HORIZONTAL',
				},
				panels: Object.fromEntries([['author', 'Author'], ['explain', 'Explain'], ['widget', 'Selected widget'], ['blueprint', 'Blueprint'], ['runtime', 'Runtime'], ['events', 'Events'], ['dependencies', 'Dependencies'], ['preview', 'Preview']].map(([id, title]) => panel(id!, title!))),
				activeGroup: '1',
			},
		}
		await page.setViewportSize({ width: 1440, height: 900 })
		// Top frame only, and once: the reload below must read what the Lab saved itself.
		await page.addInitScript(([key, value]) => {
			if (window === window.top && sessionStorage.getItem('old-layout-written') === null) {
				localStorage.setItem(key!, value!)
				sessionStorage.setItem('old-layout-written', '1')
			}
		}, [LAYOUT_KEY, JSON.stringify(oldLayout)])
		await openLab(page)

		await expect(page.locator('.dv-tab'))
			.toHaveText(['Edit', 'Explain', 'Tools', 'Preview'])
		await expect(workbenchTab(page, 'edit'))
			.toHaveAttribute('aria-selected', 'true')
		// The old layout is gone from storage (the default is saved on its first change, below).
		await expect.poll(() => page.evaluate(key => JSON.parse(localStorage.getItem(key) ?? 'null')?.version ?? null, LAYOUT_KEY))
			.not
			.toBe(1)
		// The default width, not the 900px of the old layout.
		const width = (await groupOf(page, workbenchTab(page, 'edit'))
			.boundingBox())!.width
		expect(width / 1440)
			.toBeCloseTo(0.48, 1)
		// A change saves a layout of the current version, which a reload then keeps.
		await openExplain(page)
		await expect.poll(() => page.evaluate(key => JSON.parse(localStorage.getItem(key) ?? 'null')?.version ?? null, LAYOUT_KEY))
			.toBe(2)
		await expect.poll(() => page.evaluate(key => localStorage.getItem(key)
			?.includes('"activeView":"explain"'), LAYOUT_KEY))
			.toBe(true)
		await page.reload()
		await expect(workbenchTab(page, 'explain'))
			.toHaveAttribute('aria-selected', 'true')
	})
})

test.describe('narrow windows', () => {
	test('at 1280x800 with the tutorial rail open, a view opens beside the Preview and nothing overlaps or scrolls sideways', async ({ page }) => {
		await page.setViewportSize({ width: 1280, height: 800 })
		await openLab(page)
		await chooseTutorialMenuItem(page)
		const rail = page.getByRole('complementary', { name: 'Tutorial' })
		await expect(rail)
			.toBeVisible()
		await openTool(page, 'runtime')

		const railBox = (await rail.boundingBox())!
		const toolsBox = (await groupOf(page, toolTab(page, 'runtime'))
			.boundingBox())!
		const leftBox = (await groupOf(page, workbenchTab(page, 'edit'))
			.boundingBox())!
		const previewBox = (await groupOf(page, previewTab(page))
			.boundingBox())!
		for (const [name, box] of [['Tools group', toolsBox], ['tool group', leftBox], ['Preview', previewBox]] as const) {
			expect(intersects(railBox, box), name)
				.toBe(false)
		}
		expect(intersects(toolsBox, leftBox))
			.toBe(false)
		expect(leftBox.width, 'the tool group stays usable')
			.toBeGreaterThan(400)
		expect(toolsBox.width, 'the Tools group is as wide as the Preview')
			.toBeGreaterThan(400)
		expect(previewBox.height, 'the Preview keeps a usable height')
			.toBeGreaterThan(250)
		expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth))
			.toBe(true)
		// The tour's step is still on screen and the Preview still answers.
		await expect(rail.getByText('This is the Interactive Survey', { exact: false })
			.first())
			.toBeVisible()
		await previewFrame(page)
			.getByLabel('On site', { exact: true })
			.check()
	})
})

test.describe('zh-TW', () => {
	test('the tool tabs, the Tools menu and the expert views are named in Taiwan Chinese', async ({ page }) => {
		await openLab(page, 'showcase=survey&lang=zh-TW')
		await expect(page.locator('.dv-tab'))
			.toHaveText(['編輯', '說明', '工具', 'Preview'])
		await workbenchTab(page, 'tools')
			.click()
		await expect(toolsMenu(page)
			.getByRole('button'))
			.toHaveText([/^Blueprint 樹/, /^Runtime 樹/, /^Events 紀錄/, /^相依性：關係圖與關聯/, /^選取的 widget/, /^Document 工具/, /^實作/])
		await expect(await openTool(page, 'runtime'))
			.toHaveAccessibleName('Runtime 樹')
		await expect(await openTool(page, 'implementation'))
			.toHaveAccessibleName('實作 — open-day (Survey)')
		await workbenchTab(page, 'edit')
			.click()
		await expect(page.getByTestId('browse-widget-types'))
			.toHaveText('瀏覽 widget 類型')

		// A language switch renames the open views too.
		await setLocale(page, 'en')
		await expect(toolTab(page, 'runtime'))
			.toHaveAccessibleName('Runtime tree')
		await expect(toolTab(page, 'implementation'))
			.toHaveAccessibleName('Implementation — open-day (Survey)')
	})
})
