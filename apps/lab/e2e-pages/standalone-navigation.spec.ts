import { expect, test } from '@playwright/test'

const DOCUMENT_LOAD_COUNT_KEY = 'widget-lab:e2e:document-load-count'
const LOCALE_STORAGE_KEY = 'widget-lab:locale'

test.beforeEach(async ({ page }) => {
	// A VitePress SPA-router transition changes `location` without creating a new Document. Count only
	// top-level initialization: Playwright init scripts also run in child frames, and same-origin Preview
	// frames share this sessionStorage area with the parent tab.
	await page.addInitScript((key) => {
		if (window !== window.top)
			return
		const current = Number(sessionStorage.getItem(key) ?? '0')
		sessionStorage.setItem(key, String(current + 1))
	}, DOCUMENT_LOAD_COUNT_KEY)
})

test('document load counter ignores same-origin child-frame documents', async ({ page }) => {
	await page.goto('/widget/')
	const before = Number(await page.evaluate(key => sessionStorage.getItem(key), DOCUMENT_LOAD_COUNT_KEY))

	await page.evaluate(async () => {
		await new Promise<void>((resolve, reject) => {
			const iframe = document.createElement('iframe')
			iframe.addEventListener('load', () => resolve(), { once: true })
			iframe.addEventListener('error', () => reject(new Error('child frame failed to load')), { once: true })
			iframe.src = '/widget/packages/widget-vue'
			document.body.append(iframe)
		})
	})

	const after = Number(await page.evaluate(key => sessionStorage.getItem(key), DOCUMENT_LOAD_COUNT_KEY))
	expect(after)
		.toBe(before)
})

test('VitePress opens Widget Lab as a standalone document and preserves the persisted Lab locale', async ({ page }) => {
	await page.goto('/widget/packages/widget-vue')

	// #47 + #43 integration: the generic English docs link must not force `?lang=en`. Seed the Lab's
	// persisted preference on the shared Pages origin before navigation; the standalone Lab document must
	// resolve that preference itself and then canonicalize the URL.
	await page.evaluate(key => localStorage.setItem(key, 'zh-TW'), LOCALE_STORAGE_KEY)

	const link = page.locator('#VPContent')
		.getByRole('link', { name: 'Widget Lab', exact: true })
	await expect(link)
		.toHaveAttribute('target', '_self')
	await expect(link)
		.not.toHaveAttribute('href', /[?&]lang=/)

	// The built docs page itself must resolve the entry to the deployment base before any navigation
	// occurs. This catches regressions where `_self` is correct but the href accidentally drops the
	// configured `/widget/` base (or remains coupled to an unrelated route depth).
	const resolvedHref = await link.evaluate((element) => {
		if (!(element instanceof HTMLAnchorElement))
			throw new TypeError('expected the Widget Lab entry to be an anchor')
		return new URL(element.href).pathname
	})
	expect(resolvedHref)
		.toBe('/widget/lab/')

	const documentLoadsBeforeClick = Number(await page.evaluate(key => sessionStorage.getItem(key), DOCUMENT_LOAD_COUNT_KEY))

	await link.click()
	await page.waitForURL('**/widget/lab/?lang=zh-TW')

	await expect(page.getByText('Widget Lab', { exact: true })
		.first())
		.toBeVisible()
	await expect(page.getByText('404', { exact: true }))
		.toHaveCount(0)
	expect(await page.evaluate(() => location.pathname))
		.toBe('/widget/lab/')
	await expect(page.locator('html'))
		.toHaveAttribute('lang', 'zh-TW')
	await expect(page.locator('select:has(option[value="zh-TW"])'))
		.toHaveValue('zh-TW')
	const documentLoadsAfterClick = Number(await page.evaluate(key => sessionStorage.getItem(key), DOCUMENT_LOAD_COUNT_KEY))
	expect(documentLoadsAfterClick)
		.toBe(documentLoadsBeforeClick + 1)

	// Direct reload must stay in the separately-built Lab instead of falling back to VitePress routing.
	await page.reload()
	await expect(page.getByText('Widget Lab', { exact: true })
		.first())
		.toBeVisible()
	await expect(page)
		.toHaveURL(/\/widget\/lab\/\?lang=zh-TW$/)
})

test('Home page hero action opens Widget Lab as a standalone document navigation', async ({ page }) => {
	await page.goto('/widget/')

	const heroLink = page.locator('.VPHero')
		.getByRole('link', { name: 'Open Widget Lab', exact: true })
	await expect(heroLink)
		.toHaveAttribute('target', '_self')

	const resolvedHref = await heroLink.evaluate((element) => {
		if (!(element instanceof HTMLAnchorElement))
			throw new TypeError('expected the hero action to be an anchor')
		return new URL(element.href).pathname
	})
	expect(resolvedHref)
		.toBe('/widget/lab/')

	const documentLoadsBeforeClick = Number(await page.evaluate(key => sessionStorage.getItem(key), DOCUMENT_LOAD_COUNT_KEY))

	await heroLink.click()
	await page.waitForURL('**/widget/lab/**')

	await expect(page.getByText('Widget Lab', { exact: true })
		.first())
		.toBeVisible()
	await expect(page.getByText('404', { exact: true }))
		.toHaveCount(0)
	expect(await page.evaluate(() => location.pathname))
		.toBe('/widget/lab/')

	const documentLoadsAfterClick = Number(await page.evaluate(key => sessionStorage.getItem(key), DOCUMENT_LOAD_COUNT_KEY))
	expect(documentLoadsAfterClick)
		.toBe(documentLoadsBeforeClick + 1)
})

test('Navbar link opens Widget Lab as a standalone document navigation', async ({ page }) => {
	await page.goto('/widget/')

	const navLink = page.locator('.VPNavBarMenu')
		.getByRole('link', { name: 'Widget Lab', exact: true })
	await expect(navLink)
		.toHaveAttribute('target', '_self')

	const resolvedHref = await navLink.evaluate((element) => {
		if (!(element instanceof HTMLAnchorElement))
			throw new TypeError('expected the nav link to be an anchor')
		return new URL(element.href).pathname
	})
	expect(resolvedHref)
		.toBe('/widget/lab/')

	const documentLoadsBeforeClick = Number(await page.evaluate(key => sessionStorage.getItem(key), DOCUMENT_LOAD_COUNT_KEY))

	await navLink.click()
	await page.waitForURL('**/widget/lab/**')

	await expect(page.getByText('Widget Lab', { exact: true })
		.first())
		.toBeVisible()
	await expect(page.getByText('404', { exact: true }))
		.toHaveCount(0)
	expect(await page.evaluate(() => location.pathname))
		.toBe('/widget/lab/')

	const documentLoadsAfterClick = Number(await page.evaluate(key => sessionStorage.getItem(key), DOCUMENT_LOAD_COUNT_KEY))
	expect(documentLoadsAfterClick)
		.toBe(documentLoadsBeforeClick + 1)
})

test('built Widget Lab runtime assets execute under the Pages base', async ({ page }) => {
	const requestedPaths = new Set<string>()
	const workerPaths = new Set<string>()
	page.on('request', (request) => {
		const url = new URL(request.url())
		if (url.protocol === 'http:' || url.protocol === 'https:')
			requestedPaths.add(url.pathname)
	})
	page.on('worker', (worker) => {
		const url = new URL(worker.url())
		if (url.protocol === 'http:' || url.protocol === 'https:')
			workerPaths.add(url.pathname)
	})

	await page.goto('/widget/lab/')
	await expect(page.getByText('Widget Lab', { exact: true })
		.first())
		.toBeVisible()

	const previewFrame = page.locator('[data-testid="preview-frame"]')
	await expect(previewFrame)
		.toBeVisible()
	await expect.poll(async () => previewFrame.evaluate((element) => {
		if (!(element instanceof HTMLIFrameElement))
			throw new TypeError('expected Preview to be an iframe')
		return new URL(element.src).pathname
	}))
		.toBe('/widget/lab/preview-frame.html')
	await expect(page.frameLocator('[data-testid="preview-frame"]')
		.getByText('Widget Lab sandbox', { exact: true }))
		.toBeVisible({ timeout: 15_000 })

	await expect(page.locator('.monaco-editor'))
		.toBeVisible({ timeout: 15_000 })
	await expect.poll(() => requestedPaths.has('/widget/lab/vendor/modern-monaco/editor-core.mjs'))
		.toBe(true)

	await page.getByRole('button', { name: 'Explore on my own' })
		.click()
	await page.getByRole('tab', { name: 'Dependencies' })
		.click()
	const graphNodes = page.locator('.vue-flow__node')
	await expect(graphNodes.first())
		.toBeVisible({ timeout: 15_000 })
	expect(await graphNodes.count())
		.toBeGreaterThan(0)
	await expect.poll(() => [...requestedPaths, ...workerPaths]
		.some(path => /^\/widget\/lab\/assets\/layout\.worker-[^/]+\.js$/.test(path)))
		.toBe(true)
})

for (const [explicitLocale, storedLocale] of [['en', 'zh-TW'], ['zh-TW', 'en']] as const) {
	test(`direct Widget Lab ?lang=${explicitLocale} remains authoritative over stored ${storedLocale}`, async ({ page }) => {
		await page.goto('/widget/packages/widget-vue')
		await page.evaluate(
			({ key, value }) => localStorage.setItem(key, value),
			{ key: LOCALE_STORAGE_KEY, value: storedLocale },
		)

		await page.goto(`/widget/lab/?lang=${explicitLocale}&probe=pages#entry`)
		await expect(page.getByText('Widget Lab', { exact: true })
			.first())
			.toBeVisible()
		expect(await page.evaluate(() => location.pathname))
			.toBe('/widget/lab/')
		await expect(page.locator('html'))
			.toHaveAttribute('lang', explicitLocale)
		await expect(page.locator('select:has(option[value="zh-TW"])'))
			.toHaveValue(explicitLocale)
		expect(await page.evaluate(key => localStorage.getItem(key), LOCALE_STORAGE_KEY))
			.toBe(explicitLocale)
		await expect(page)
			.toHaveURL(new RegExp(`/widget/lab/\\?lang=${explicitLocale}&probe=pages#entry$`))
	})
}
