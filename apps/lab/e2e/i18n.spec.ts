import { expect, test } from './fixtures'

const LOCALE_STORAGE_KEY = 'widget-lab:locale'

function localeSelect(page: import('@playwright/test').Page) {
	return page.locator('select:has(option[value="zh-TW"])')
}

test.describe('lab localization (issue #43)', () => {
	test('explicit query overrides storage and locale switching preserves unrelated query/hash', async ({ context, page }) => {
		await context.addInitScript(key => localStorage.setItem(key, 'en'), LOCALE_STORAGE_KEY)
		await page.goto('/?lang=zh-TW&probe=keep#anchor')

		await expect(localeSelect(page))
			.toHaveValue('zh-TW')
		await expect(page.locator('html'))
			.toHaveAttribute('lang', 'zh-TW')
		await expect(page.getByRole('button', { name: '套用', exact: true }))
			.toBeVisible()
		expect(await page.evaluate(key => localStorage.getItem(key), LOCALE_STORAGE_KEY))
			.toBe('zh-TW')
		await expect(page)
			.toHaveURL(/\?lang=zh-TW&probe=keep#anchor$/)

		await localeSelect(page)
			.selectOption('en')
		await expect(page.locator('html'))
			.toHaveAttribute('lang', 'en')
		await expect(page.getByRole('button', { name: 'Apply', exact: true }))
			.toBeVisible()
		expect(await page.evaluate(key => localStorage.getItem(key), LOCALE_STORAGE_KEY))
			.toBe('en')
		await expect(page)
			.toHaveURL(/\?lang=en&probe=keep#anchor$/)

		await page.reload()
		await expect(localeSelect(page))
			.toHaveValue('en')
	})

	test('stored zh-TW is used when query is absent and canonicalized into the URL', async ({ context, page }) => {
		await context.addInitScript(key => localStorage.setItem(key, 'zh-TW'), LOCALE_STORAGE_KEY)
		await page.goto('/?probe=stored#state')

		await expect(localeSelect(page))
			.toHaveValue('zh-TW')
		await expect(page)
			.toHaveURL(/\?probe=stored&lang=zh-TW#state$/)
		await expect(page.locator('html'))
			.toHaveAttribute('lang', 'zh-TW')
	})

	test('changing locale preserves live Runtime state and shared inspector focus', async ({ page }) => {
		await page.goto('/?lang=en')
		await page.getByRole('button', { name: '+1', exact: true })
			.click()
		await expect(page.getByText('count: 1 · doubled: 2', { exact: true }))
			.toBeVisible()

		await page.getByRole('tab', { name: 'Blueprint' })
			.click()
		await page.getByRole('button', { name: 'title : Text' })
			.click()
		await expect(page.getByTestId('blueprint-view-implementation'))
			.toBeVisible()

		await localeSelect(page)
			.selectOption('zh-TW')

		// Locale is presentation-only: the same Runtime instance/state remains live and the same selected
		// Blueprint widget remains focused; no Apply/recompile/showcase replacement is involved.
		await page.getByRole('tab', { name: 'Preview' })
			.click()
		await expect(page.getByText('count: 1 · doubled: 2', { exact: true }))
			.toBeVisible()
		await page.getByRole('tab', { name: 'Blueprint' })
			.click()
		await expect(page.getByTestId('blueprint-view-implementation'))
			.toBeVisible()
	})

	test('changing locale translates the current tutorial step without restarting tutorial progress', async ({ page }) => {
		await page.goto('/?lang=en')
		await page.getByRole('button', { name: 'Tutorial', exact: true })
			.click()

		const rail = page.getByRole('complementary', { name: 'Tutorial' })
		await expect(rail)
			.toBeVisible()
		await expect(rail.getByText('This is the Interactive Survey', { exact: true }))
			.toBeVisible()
		await expect(rail.getByText('Step 1 of 9', { exact: true }))
			.toBeVisible()

		await localeSelect(page)
			.selectOption('zh-TW')

		const translatedRail = page.getByRole('complementary', { name: '教學' })
		await expect(translatedRail.getByText('這是互動式問卷', { exact: true }))
			.toBeVisible()
		await expect(translatedRail.getByText('第 1 步，共 9 步', { exact: true }))
			.toBeVisible()
	})
})
