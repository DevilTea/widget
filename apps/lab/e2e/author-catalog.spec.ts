import { expect, test } from './fixtures'

/**
 * The Catalog (Lab UX phase 3B: a slide-over of the Edit tab, opened with "Browse widget types", no longer a view of its own):
 * its content is unchanged. The dialog behaviour (focus, Escape, focus return) is in `e2e/workbench-tools.spec.ts`.
 */

test('the Catalog copies the catalog JSON and shows no schema block for schema-less entries', async ({ page }) => {
	await page.goto('/?showcase=sandbox')
	await page.getByTestId('browse-widget-types')
		.click()
	await expect(page.getByTestId('author-catalog-Stack'))
		.toBeVisible()

	// The Sandbox declares no config JSON Schema (Text has a config capability with `schema: null`).
	await expect(page.getByTestId('author-catalog-Text'))
		.toBeVisible()
	await expect(page.locator('[data-testid^="author-catalog-schema-"]'))
		.toHaveCount(0)

	await page.evaluate(() => {
		Object.defineProperty(navigator, 'clipboard', {
			configurable: true,
			value: { writeText: async (text: string) => { (window as unknown as { copiedCatalog?: string }).copiedCatalog = text } },
		})
	})
	await page.getByTestId('author-catalog-copy')
		.click()
	await expect(page.getByTestId('author-catalog-copy'))
		.toHaveText('Copied')
	const copied = await page.evaluate(() => (window as unknown as { copiedCatalog?: string }).copiedCatalog)
	const parsed = JSON.parse(copied ?? 'null') as { widgets: { type: string, config: unknown, slots: Record<string, string> | null }[] }
	const stack = parsed.widgets.find(widget => widget.type === 'Stack')
	expect(stack?.config)
		.toBeNull()
	expect(Object.keys(stack?.slots ?? {}))
		.toEqual(['items'])
	await expect(page.getByTestId('author-catalog-copy'))
		.toHaveText('Copy catalog JSON')
})

test('the Catalog shows a failure state when the clipboard rejects', async ({ page }) => {
	await page.goto('/')
	await page.getByTestId('browse-widget-types')
		.click()
	await page.evaluate(() => {
		Object.defineProperty(navigator, 'clipboard', {
			configurable: true,
			value: { writeText: async () => { throw new Error('denied') } },
		})
	})
	await page.getByTestId('author-catalog-copy')
		.click()
	await expect(page.getByTestId('author-catalog-copy'))
		.toHaveText('Copy failed')
})
