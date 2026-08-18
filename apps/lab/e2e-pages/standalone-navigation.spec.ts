import { expect, test } from '@playwright/test'

const DOCUMENT_LOAD_COUNT_KEY = 'widget-lab:e2e:document-load-count'

test.beforeEach(async ({ page }) => {
	// A VitePress SPA-router transition changes `location` without creating a new Document. Incrementing
	// sessionStorage from an init script gives this contract a direct, same-tab proof that the Widget Lab
	// link caused real document navigation instead of merely reaching the same URL through pushState.
	await page.addInitScript((key) => {
		const current = Number(sessionStorage.getItem(key) ?? '0')
		sessionStorage.setItem(key, String(current + 1))
	}, DOCUMENT_LOAD_COUNT_KEY)
})

test('VitePress opens Widget Lab as a standalone document with no intermediate SPA 404', async ({ page }) => {
	await page.goto('/deviltea-labs/packages/widget-vue')

	const link = page.getByRole('link', { name: 'Widget Lab', exact: true })
	await expect(link)
		.toHaveAttribute('target', '_self')
	const documentLoadsBeforeClick = Number(await page.evaluate(key => sessionStorage.getItem(key), DOCUMENT_LOAD_COUNT_KEY))

	await link.click()
	await page.waitForURL('**/deviltea-labs/widget-lab/')

	await expect(page.getByText('Widget Lab', { exact: true }).first())
		.toBeVisible()
	await expect(page.getByText('404', { exact: true }))
		.toHaveCount(0)
	const documentLoadsAfterClick = Number(await page.evaluate(key => sessionStorage.getItem(key), DOCUMENT_LOAD_COUNT_KEY))
	expect(documentLoadsAfterClick)
		.toBeGreaterThan(documentLoadsBeforeClick)

	// Direct reload must stay in the separately-built Lab instead of falling back to VitePress routing.
	await page.reload()
	await expect(page.getByText('Widget Lab', { exact: true }).first())
		.toBeVisible()
	await expect(page)
		.toHaveURL(/\/deviltea-labs\/widget-lab\/$/)
})

test('direct Widget Lab entry preserves query parameters under the GitHub Pages base', async ({ page }) => {
	await page.goto('/deviltea-labs/widget-lab/?lang=zh-TW&probe=pages#entry')
	await expect(page.getByText('Widget Lab', { exact: true }).first())
		.toBeVisible()
	await expect(page)
		.toHaveURL(/\/deviltea-labs\/widget-lab\/\?lang=zh-TW&probe=pages#entry$/)
})
