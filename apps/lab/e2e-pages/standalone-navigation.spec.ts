import { expect, test } from '@playwright/test'

const DOCUMENT_LOAD_COUNT_KEY = 'widget-lab:e2e:document-load-count'
const LOCALE_STORAGE_KEY = 'widget-lab:locale'

test.beforeEach(async ({ page }) => {
	// A VitePress SPA-router transition changes `location` without creating a new Document. Incrementing
	// sessionStorage from an init script gives this contract a direct, same-tab proof that the Widget Lab
	// link caused real document navigation instead of merely reaching the same URL through pushState.
	await page.addInitScript((key) => {
		const current = Number(sessionStorage.getItem(key) ?? '0')
		sessionStorage.setItem(key, String(current + 1))
	}, DOCUMENT_LOAD_COUNT_KEY)
})

test('VitePress opens Widget Lab as a standalone document and preserves the persisted Lab locale', async ({ page }) => {
	await page.goto('/deviltea-labs/packages/widget-vue')

	// #47 + #43 integration: the generic English docs link must not force `?lang=en`. Seed the Lab's
	// persisted preference on the shared Pages origin before navigation; the standalone Lab document must
	// resolve that preference itself and then canonicalize the URL.
	await page.evaluate(key => localStorage.setItem(key, 'zh-TW'), LOCALE_STORAGE_KEY)

	const link = page.getByRole('link', { name: 'Widget Lab', exact: true })
	await expect(link)
		.toHaveAttribute('target', '_self')
	await expect(link)
		.not.toHaveAttribute('href', /[?&]lang=/)

	// The built docs page itself must resolve the entry to the deployment base before any navigation
	// occurs. This catches regressions where `_self` is correct but the href accidentally drops the
	// configured `/deviltea-labs/` base (or remains coupled to an unrelated route depth).
	const resolvedHref = await link.evaluate((element) => {
		if (!(element instanceof HTMLAnchorElement))
			throw new TypeError('expected the Widget Lab entry to be an anchor')
		return new URL(element.href).pathname
	})
	expect(resolvedHref)
		.toBe('/deviltea-labs/widget-lab/')

	const documentLoadsBeforeClick = Number(await page.evaluate(key => sessionStorage.getItem(key), DOCUMENT_LOAD_COUNT_KEY))

	await link.click()
	await page.waitForURL('**/deviltea-labs/widget-lab/?lang=zh-TW')

	await expect(page.getByText('Widget Lab', { exact: true })
		.first())
		.toBeVisible()
	await expect(page.getByText('404', { exact: true }))
		.toHaveCount(0)
	await expect(page.locator('html'))
		.toHaveAttribute('lang', 'zh-TW')
	await expect(page.locator('select:has(option[value="zh-TW"])'))
		.toHaveValue('zh-TW')
	const documentLoadsAfterClick = Number(await page.evaluate(key => sessionStorage.getItem(key), DOCUMENT_LOAD_COUNT_KEY))
	expect(documentLoadsAfterClick)
		.toBeGreaterThan(documentLoadsBeforeClick)

	// Direct reload must stay in the separately-built Lab instead of falling back to VitePress routing.
	await page.reload()
	await expect(page.getByText('Widget Lab', { exact: true })
		.first())
		.toBeVisible()
	await expect(page)
		.toHaveURL(/\/deviltea-labs\/widget-lab\/\?lang=zh-TW$/)
})

for (const [explicitLocale, storedLocale] of [['en', 'zh-TW'], ['zh-TW', 'en']] as const) {
	test(`direct Widget Lab ?lang=${explicitLocale} remains authoritative over stored ${storedLocale}`, async ({ page }) => {
		await page.goto('/deviltea-labs/packages/widget-vue')
		await page.evaluate(
			({ key, value }) => localStorage.setItem(key, value),
			{ key: LOCALE_STORAGE_KEY, value: storedLocale },
		)

		await page.goto(`/deviltea-labs/widget-lab/?lang=${explicitLocale}&probe=pages#entry`)
		await expect(page.getByText('Widget Lab', { exact: true })
			.first())
			.toBeVisible()
		await expect(page.locator('html'))
			.toHaveAttribute('lang', explicitLocale)
		await expect(page.locator('select:has(option[value="zh-TW"])'))
			.toHaveValue(explicitLocale)
		expect(await page.evaluate(key => localStorage.getItem(key), LOCALE_STORAGE_KEY))
			.toBe(explicitLocale)
		await expect(page)
			.toHaveURL(new RegExp(`/deviltea-labs/widget-lab/\\?lang=${explicitLocale}&probe=pages#entry$`))
	})
}
