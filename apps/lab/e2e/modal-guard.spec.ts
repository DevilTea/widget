import type { Page } from '@playwright/test'
import { editJson, expect, previewFrame, test, waitForLabTestSeam } from './fixtures'

/**
 * Lab UX phase 3B renders the Preview through Dockview's `always` renderer: its iframe lives in Dockview's overlay container, which
 * is positioned over the Preview group with its own z-index. The Lab's modal dialogs are native `<dialog>.showModal()` (the top
 * layer), so they must still cover the Preview: nothing under their backdrop, the iframe included, is hit or focused while one is
 * open. These specs pin that for the Catalog slide-over and the draft guard.
 */

/** What the top document hits at the centre of the Preview frame. */
async function hitAtPreviewCentre(page: Page): Promise<{ x: number, y: number, hit: string | null }> {
	const box = (await page.getByTestId('preview-frame')
		.boundingBox())!
	const x = box.x + box.width / 2
	const y = box.y + box.height / 2
	const hit = await page.evaluate(([px, py]) => {
		const element = document.elementFromPoint(px!, py!)
		return element === null ? null : element.getAttribute('data-testid') ?? element.tagName.toLowerCase()
	}, [x, y])
	return { x, y, hit }
}

/**
 * The mean brightness (0-255) of an area of the Preview frame as drawn on screen, decoded by the browser from a screenshot: its
 * middle half, or its right quarter (clear of a dialog card centred on the page).
 */
async function previewBrightness(page: Page, area: 'middle' | 'right' = 'middle'): Promise<number> {
	const box = (await page.getByTestId('preview-frame')
		.boundingBox())!
	const clip = area === 'middle'
		? { x: box.x + box.width / 4, y: box.y + box.height / 4, width: box.width / 2, height: box.height / 2 }
		: { x: box.x + box.width * 0.72, y: box.y + box.height / 4, width: box.width * 0.25, height: box.height / 2 }
	const png = await page.screenshot({ clip })
	return page.evaluate(async (data) => {
		const image = new Image()
		image.src = data
		await image.decode()
		const canvas = document.createElement('canvas')
		canvas.width = image.width
		canvas.height = image.height
		const context = canvas.getContext('2d')!
		context.drawImage(image, 0, 0)
		const pixels = context.getImageData(0, 0, image.width, image.height).data
		let sum = 0
		for (let index = 0; index < pixels.length; index += 4)
			sum += (pixels[index]! + pixels[index + 1]! + pixels[index + 2]!) / 3
		return sum / (pixels.length / 4)
	}, `data:image/png;base64,${png.toString('base64')}`)
}

/** Counts the clicks the Preview frame's document receives from now on. */
async function countFrameClicks(page: Page): Promise<() => Promise<number>> {
	const frame = page.frames()
		.find(candidate => candidate.url()
			.includes('preview-frame'))!
	await frame.evaluate(() => {
		const counter = window as unknown as { previewClicks: number }
		counter.previewClicks = 0
		document.addEventListener('pointerdown', () => counter.previewClicks++, true)
		document.addEventListener('click', () => counter.previewClicks++, true)
	})
	return () => frame.evaluate(() => (window as unknown as { previewClicks: number }).previewClicks)
}

test('the Catalog slide-over covers the Preview: the frame is not hit, gets no click and cannot take focus', async ({ page }) => {
	await page.setViewportSize({ width: 1440, height: 900 })
	await page.goto('/?showcase=survey')
	await expect(previewFrame(page)
		.getByRole('heading', { name: 'Maker Space open day: sign-up' }))
		.toBeVisible()
	const clicks = await countFrameClicks(page)
	const before = await previewBrightness(page)

	await page.getByTestId('browse-widget-types')
		.click()
	const dialog = page.getByTestId('catalog-dialog')
	await expect(dialog)
		.toBeVisible()
	// The backdrop dims the Preview like the rest of the page (40% black: about 0.6 of the brightness, measured 246 -> 147).
	const dimmed = await previewBrightness(page)
	expect(dimmed / before, `brightness ${Math.round(before)} -> ${Math.round(dimmed)}`)
		.toBeLessThan(0.75)
	expect(await dialog.evaluate(element => element.matches(':modal')))
		.toBe(true)
	const { x, y, hit } = await hitAtPreviewCentre(page)
	// The backdrop belongs to the dialog: the top document finds the dialog there, not the iframe.
	expect(hit)
		.toBe('catalog-dialog')
	await page.mouse.click(x, y)
	expect(await clicks())
		.toBe(0)
	await expect(dialog)
		.toBeVisible()
	expect(await dialog.evaluate(element => element.contains(document.activeElement)))
		.toBe(true)
	// The iframe cannot be focused programmatically either (the page behind a modal dialog is inert).
	await page.getByTestId('preview-frame')
		.evaluate(element => (element as HTMLIFrameElement).focus())
	expect(await dialog.evaluate(element => element.contains(document.activeElement)))
		.toBe(true)

	// Closed, the Preview answers again.
	await page.keyboard.press('Escape')
	await previewFrame(page)
		.getByLabel('On site', { exact: true })
		.check()
	expect(await clicks())
		.toBeGreaterThan(0)
})

test('the draft guard covers the Preview too', async ({ page }) => {
	await page.setViewportSize({ width: 1440, height: 900 })
	await page.goto('/?showcase=survey&lab-test')
	await waitForLabTestSeam(page)
	await expect(previewFrame(page)
		.getByRole('heading', { name: 'Maker Space open day: sign-up' }))
		.toBeVisible()
	const clicks = await countFrameClicks(page)
	await editJson(page, '{ "id": ')
	// Measured before the Examples menu opens: the guard follows the menu item at once.
	const before = await previewBrightness(page, 'right')
	await page.getByTestId('examples-menu')
		.click()
	await page.getByRole('menuitemcheckbox', { name: /AI draft/ })
		.click()
	const guard = page.getByTestId('draft-guard-dialog')
	await expect(guard)
		.toBeVisible()
	// Measured on the Preview's right quarter, clear of the dialog card: the 55% black backdrop dims it.
	const dimmed = await previewBrightness(page, 'right')
	expect(dimmed / before, `brightness ${Math.round(before)} -> ${Math.round(dimmed)}`)
		.toBeLessThan(0.75)
	const { x, y, hit } = await hitAtPreviewCentre(page)
	expect(hit)
		.toBe('draft-guard-dialog')
	await page.mouse.click(x, y)
	expect(await clicks())
		.toBe(0)
	await expect(guard)
		.toBeVisible()
	await page.getByTestId('draft-guard-keep')
		.click()
})
