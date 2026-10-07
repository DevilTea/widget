import type { Page } from '@playwright/test'
import type { LeafMode } from './inspect-anchors.browser'
import { expect, test } from './fixtures'

/**
 * DevilTea/widget#161 inspect-anchor contract, in native Chromium with real `@deviltea/widget-vue`
 * renderers stamping anchors through `@deviltea/widget-inspector/anchor` and a real `InspectorAgent`
 * reading them. See `inspect-anchors.browser.ts` for the fixed layout these coordinates refer to:
 *
 *   Shell 0,0 400x300 > Panel 20,20 360x240 > Leaf 40,40 120x40, plus Floater 120,40 80x40 on top.
 */

// Like the DevTools transport spec, this loads source modules from the Vite server on :4174.
test.use({
	additionalRequestOrigin: 'http://localhost:4174',
	expectedRequestOrigin: 'http://127.0.0.1:4174',
})

interface Box { x: number, y: number, width: number, height: number }

const LEAF_BOX: Box = { x: 40, y: 40, width: 120, height: 40 }
const PANEL_BOX: Box = { x: 20, y: 20, width: 360, height: 240 }
const SHELL_BOX: Box = { x: 0, y: 0, width: 400, height: 300 }
const REPLACED_BOX: Box = { x: 40, y: 120, width: 90, height: 30 }
const FRAGMENT_A_BOX: Box = { x: 40, y: 180, width: 50, height: 20 }
const FRAGMENT_B_BOX: Box = { x: 140, y: 210, width: 50, height: 20 }

test.beforeEach(async ({ page }) => {
	await page.goto('http://127.0.0.1:4174/e2e/fixtures/devtools-transport.html')
	const moduleUrl = await page.evaluate(() => new URL('/e2e/inspect-anchors.browser.ts', location.origin).href)
	await page.evaluate(async (url) => {
		const harness = await import(url)
		await harness.mountAnchorHarness()
	}, moduleUrl)
})

async function setLeafMode(page: Page, mode: LeafMode): Promise<void> {
	await page.evaluate(next => window.__anchorHarness!.setLeafMode(next), mode)
}

async function rectsOf(page: Page, widgetId: string): Promise<{ visibility: string, rects: Box[] }> {
	return page.evaluate(async (id) => {
		const harness = window.__anchorHarness!
		const ref = await harness.refFor(id)
		const snapshot = await harness.request('geometry.resolve', { ref })
		return { visibility: snapshot.visibility, rects: snapshot.rects.map(rect => ({ ...rect })) }
	}, widgetId)
}

async function hitTest(page: Page, x: number, y: number): Promise<string | null> {
	return page.evaluate(async ([px, py]) => {
		const result = await window.__anchorHarness!.request('inspect.hitTest', { coordinateSpace: 'preview-viewport', x: px!, y: py! })
		return result.target === null ? null : `${result.target.widgetType}#${result.target.widgetId}`
	}, [x, y])
}

async function highlight(page: Page, widgetId: string): Promise<boolean> {
	return page.evaluate(async (id) => {
		const harness = window.__anchorHarness!
		return (await harness.request('highlight.show', { ref: await harness.refFor(id) })).highlighted
	}, widgetId)
}

async function overlayBoxes(page: Page): Promise<Box[]> {
	return page.evaluate(() => {
		const host = document.querySelector('[data-widget-inspector-overlay="true"]')
		return [...host?.shadowRoot?.querySelectorAll<HTMLElement>('.rect') ?? []].map((element) => {
			const rect = element.getBoundingClientRect()
			return { x: rect.x, y: rect.y, width: rect.width, height: rect.height }
		})
	})
}

async function overlayLabel(page: Page): Promise<string | null> {
	return page.evaluate(() => document.querySelector('[data-widget-inspector-overlay="true"]')?.shadowRoot?.querySelector('.badge')?.textContent ?? null)
}

test.describe('nested anchors', () => {
	test('each nested Widget resolves its own rect and the innermost anchor wins hit-testing', async ({ page }) => {
		expect(await rectsOf(page, 'shell'))
			.toEqual({ visibility: 'visible', rects: [SHELL_BOX] })
		expect(await rectsOf(page, 'panel'))
			.toEqual({ visibility: 'visible', rects: [PANEL_BOX] })
		expect(await rectsOf(page, 'leaf'))
			.toEqual({ visibility: 'visible', rects: [LEAF_BOX] })

		// Leaf is nested in Panel, nested in Shell: the innermost resolvable anchor wins at each point.
		expect(await hitTest(page, 60, 60))
			.toBe('Leaf#leaf')
		expect(await hitTest(page, 300, 200))
			.toBe('Panel#panel')
		expect(await hitTest(page, 5, 5))
			.toBe('Shell#shell')
	})

	test('hovering with a real pointer highlights the innermost Widget in the Agent overlay', async ({ page }) => {
		await page.evaluate(() => window.__anchorHarness!.request('inspect.enable', {}))

		await page.mouse.move(60, 60)
		await expect.poll(() => overlayLabel(page))
			.toBe('Leaf#leaf')
		expect(await overlayBoxes(page))
			.toEqual([LEAF_BOX])

		await page.mouse.move(300, 200)
		await expect.poll(() => overlayLabel(page))
			.toBe('Panel#panel')
		expect(await overlayBoxes(page))
			.toEqual([PANEL_BOX])
	})
})

test.describe('multiple fragments per Widget', () => {
	test('a multi-root fragment contributes one rect per anchor element, in document order', async ({ page }) => {
		await setLeafMode(page, 'fragments')

		expect(await rectsOf(page, 'leaf'))
			.toEqual({ visibility: 'visible', rects: [FRAGMENT_A_BOX, FRAGMENT_B_BOX] })
		expect(await hitTest(page, 150, 215))
			.toBe('Leaf#leaf')

		expect(await highlight(page, 'leaf'))
			.toBe(true)
		expect(await overlayBoxes(page))
			.toEqual([FRAGMENT_A_BOX, FRAGMENT_B_BOX])
		expect(await overlayLabel(page))
			.toBe('Leaf#leaf')
	})

	test('one anchor whose inline content wraps contributes every line box', async ({ page }) => {
		await setLeafMode(page, 'wrapped')

		const { visibility, rects } = await rectsOf(page, 'leaf')
		expect(visibility)
			.toBe('visible')
		expect(rects.length)
			.toBeGreaterThanOrEqual(2)
		expect(rects.every(rect => rect.width > 0 && rect.height > 0))
			.toBe(true)

		expect(await highlight(page, 'leaf'))
			.toBe(true)
		expect(await overlayBoxes(page))
			.toHaveLength(rects.length)
	})
})

test.describe('mount, unmount and replacement cleanup', () => {
	test('anchors live and die with the renderer: hiding removes the target and showing restores it', async ({ page }) => {
		await setLeafMode(page, 'hidden')
		expect(await rectsOf(page, 'leaf'))
			.toEqual({ visibility: 'hidden', rects: [] })
		// Nothing is left at the old location: the enclosing Panel is now the innermost anchor there.
		expect(await hitTest(page, 60, 60))
			.toBe('Panel#panel')

		await setLeafMode(page, 'visible')
		expect(await rectsOf(page, 'leaf'))
			.toEqual({ visibility: 'visible', rects: [LEAF_BOX] })
		expect(await hitTest(page, 60, 60))
			.toBe('Leaf#leaf')
	})

	test('replacing the rendered element moves the target and leaves no stale anchor behind', async ({ page }) => {
		await setLeafMode(page, 'replaced')

		expect(await rectsOf(page, 'leaf'))
			.toEqual({ visibility: 'visible', rects: [REPLACED_BOX] })
		expect(await hitTest(page, 60, 60))
			.toBe('Panel#panel')
		expect(await hitTest(page, 60, 130))
			.toBe('Leaf#leaf')
		expect(await page.evaluate(() => document.querySelectorAll('[data-widget-id="leaf"]').length))
			.toBe(1)
	})

	test('the Agent overlay follows replacement and clears on unmount, then reappears on remount', async ({ page }) => {
		expect(await highlight(page, 'leaf'))
			.toBe(true)
		expect(await overlayBoxes(page))
			.toEqual([LEAF_BOX])

		await setLeafMode(page, 'replaced')
		await expect.poll(() => overlayBoxes(page))
			.toEqual([REPLACED_BOX])

		await setLeafMode(page, 'hidden')
		await expect.poll(() => page.evaluate(() => window.__anchorHarness!.overlayHostCount()))
			.toBe(0)

		await setLeafMode(page, 'visible')
		await expect.poll(() => overlayBoxes(page))
			.toEqual([LEAF_BOX])
	})

	test('unmounting the whole renderer resolves every Widget to no target, and disposing the Agent leaves no DOM', async ({ page }) => {
		expect(await highlight(page, 'leaf'))
			.toBe(true)
		await page.evaluate(() => window.__anchorHarness!.unmountApp())

		for (const id of ['shell', 'panel', 'leaf', 'floater']) {
			expect(await rectsOf(page, id))
				.toEqual({ visibility: 'hidden', rects: [] })
		}
		expect(await hitTest(page, 60, 60))
			.toBeNull()
		await expect.poll(() => page.evaluate(() => window.__anchorHarness!.overlayHostCount()))
			.toBe(0)

		await page.evaluate(() => window.__anchorHarness!.disposeAgent())
		expect(await page.evaluate(() => window.__anchorHarness!.overlayHostCount()))
			.toBe(0)
	})

	test('the Agent never adds attributes to renderer elements', async ({ page }) => {
		const before = await page.evaluate(() => window.__anchorHarness!.attributesOf('[data-widget-id="leaf"]'))
		await page.evaluate(() => window.__anchorHarness!.request('inspect.enable', {}))
		await page.mouse.move(60, 60)
		await expect.poll(() => overlayLabel(page))
			.toBe('Leaf#leaf')
		const during = await page.evaluate(() => window.__anchorHarness!.attributesOf('[data-widget-id="leaf"]'))
		expect(before)
			.toEqual(['class', 'data-widget-id', 'data-widget-type', 'type'])
		expect(during)
			.toEqual(before)
	})
})

test.describe('topmost hit-testing', () => {
	test('the topmost semantic anchor wins over an overlapped Widget that is earlier in the tree', async ({ page }) => {
		// x 120..160 is covered by Floater (z-index 5); x 40..120 shows only Leaf.
		expect(await hitTest(page, 140, 60))
			.toBe('Floater#floater')
		expect(await hitTest(page, 60, 60))
			.toBe('Leaf#leaf')
	})

	test('a topmost nonsemantic element hides the Widget beneath it instead of falling through', async ({ page }) => {
		await page.evaluate(() => window.__anchorHarness!.addCover())
		expect(await hitTest(page, 60, 60))
			.toBeNull()

		await page.evaluate(() => window.__anchorHarness!.removeCover())
		expect(await hitTest(page, 60, 60))
			.toBe('Leaf#leaf')
	})

	test('hovering the overlapped region with a real pointer selects the topmost Widget', async ({ page }) => {
		await page.evaluate(() => window.__anchorHarness!.request('inspect.enable', {}))
		await page.mouse.move(140, 60)
		await expect.poll(() => overlayLabel(page))
			.toBe('Floater#floater')
	})
})
