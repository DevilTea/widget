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

	await page.getByTestId('browse-widget-types')
		.click()
	const dialog = page.getByTestId('catalog-dialog')
	await expect(dialog)
		.toBeVisible()
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
	await page.getByTestId('examples-menu')
		.click()
	await page.getByRole('menuitemcheckbox', { name: /AI draft/ })
		.click()
	const guard = page.getByTestId('draft-guard-dialog')
	await expect(guard)
		.toBeVisible()
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
