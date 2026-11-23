import type { Locator, Page } from '@playwright/test'
import { chooseTutorialMenuItem, expect, maximizeTools, openTool, previewFrame, test, toolsMaximizeButton, toolTab } from './fixtures'

/**
 * The Preview is rendered with Dockview's `always` renderer (Lab UX phase 3B): its iframe lives in Dockview's overlay container
 * and is only positioned over the Preview group, so the group can move into a new grid branch without moving (and reloading) the
 * iframe. The cost is that the position is Dockview's to keep up to date. These specs check, after each change of the workbench,
 * that the iframe lies inside the Preview group's content area (within 1px), and that it was not reloaded (a marker set in the
 * frame's window survives) where it must not be.
 */

function previewContent(page: Page): Locator {
	return page.locator('.dv-groupview')
		.filter({ has: page.getByRole('tab', { name: 'Preview', exact: true }) })
		.locator('.dv-content-container')
}

async function expectFrameInsidePreview(page: Page, when: string): Promise<void> {
	await expect(async () => {
		const [frame, content] = await Promise.all([page.getByTestId('preview-frame')
			.boundingBox(), previewContent(page)
			.boundingBox()])
		expect(frame, `${when}: the frame is laid out`)
			.not
			.toBeNull()
		expect(frame!.width * frame!.height, `${when}: the frame has room`)
			.toBeGreaterThan(10_000)
		expect(frame!.x, `${when}: left edge`)
			.toBeGreaterThanOrEqual(content!.x - 1)
		expect(frame!.y, `${when}: top edge`)
			.toBeGreaterThanOrEqual(content!.y - 1)
		expect(frame!.x + frame!.width, `${when}: right edge`)
			.toBeLessThanOrEqual(content!.x + content!.width + 1)
		expect(frame!.y + frame!.height, `${when}: bottom edge`)
			.toBeLessThanOrEqual(content!.y + content!.height + 1)
		// It fills the group's width (the Preview's toolbar and notices sit above it, not beside it).
		expect(Math.abs(frame!.width - content!.width), `${when}: full width`)
			.toBeLessThanOrEqual(1)
	})
		.toPass({ timeout: 5000 })
}

async function markFrame(page: Page): Promise<void> {
	const frame = page.frames()
		.find(candidate => candidate.url()
			.includes('preview-frame'))!
	await frame.evaluate(() => {
		(window as unknown as { geometryMarker: string }).geometryMarker = 'kept'
	})
}

async function frameMarker(page: Page): Promise<string> {
	const frame = page.frames()
		.find(candidate => candidate.url()
			.includes('preview-frame'))!
	return frame.evaluate(() => (window as unknown as { geometryMarker?: string }).geometryMarker ?? 'reloaded')
}

test('the Preview frame stays inside its group, and is not reloaded, through every change of the workbench', async ({ page }) => {
	await page.setViewportSize({ width: 1440, height: 900 })
	await page.goto('/?showcase=survey')
	await expect(previewFrame(page)
		.getByRole('heading', { name: 'Maker Space open day: sign-up' }))
		.toBeVisible()
	await expectFrameInsidePreview(page, 'first load')
	await markFrame(page)

	await openTool(page, 'runtime')
	await expectFrameInsidePreview(page, 'the first view opened (the column is split)')
	expect(await frameMarker(page))
		.toBe('kept')

	await chooseTutorialMenuItem(page)
	await expect(page.getByRole('complementary', { name: 'Tutorial' }))
		.toBeVisible()
	await expectFrameInsidePreview(page, 'the tutorial rail opened')
	expect(await frameMarker(page))
		.toBe('kept')

	await maximizeTools(page)
	// Maximized, the Preview group has no room and the frame is hidden with it, still loaded.
	await expect(page.getByTestId('preview-frame'))
		.toBeHidden()
	await toolsMaximizeButton(page)
		.click()
	await expect(toolsMaximizeButton(page))
		.toHaveAttribute('data-maximized', 'false')
	await expectFrameInsidePreview(page, 'restored')
	expect(await frameMarker(page))
		.toBe('kept')

	await page.getByRole('complementary', { name: 'Tutorial' })
		.getByRole('button', { name: 'Close tutorial' })
		.click()
	await toolTab(page, 'runtime')
		.focus()
	await page.keyboard.press('Delete')
	await expect(toolTab(page, 'runtime'))
		.toHaveCount(0)
	await expectFrameInsidePreview(page, 'every view closed (the column is whole again)')
	expect(await frameMarker(page))
		.toBe('kept')

	// Reset layout rebuilds the workbench, the Preview panel included, so the frame is a new one: it must be placed all the same.
	await openTool(page, 'events')
	await page.getByTestId('overflow-menu')
		.click()
	await page.getByRole('menuitem', { name: 'Reset layout', exact: true })
		.click()
	await expect(previewFrame(page)
		.getByRole('heading', { name: 'Maker Space open day: sign-up' }))
		.toBeVisible()
	await expectFrameInsidePreview(page, 'Reset layout')
})
