import { chooseTutorialMenuItem, expect, openDeveloperTool, previewFrame, setLocale, setTheme, test } from './fixtures'

const LOCALE_STORAGE_KEY = 'widget-lab:locale'
const THEME_STORAGE_KEY = 'widget-lab:theme'

test.describe('lab localization (issue #43)', () => {
	test('explicit zh-TW query overrides stored en and locale switching preserves unrelated query/hash', async ({ context, page }) => {
		await context.addInitScript(key => localStorage.setItem(key, 'en'), LOCALE_STORAGE_KEY)
		await page.goto('/?lang=zh-TW&probe=keep#anchor')

		await expect(page.locator('html'))
			.toHaveAttribute('lang', 'zh-TW')
		await expect(page.getByRole('button', { name: '套用', exact: true }))
			.toBeVisible()
		expect(await page.evaluate(key => localStorage.getItem(key), LOCALE_STORAGE_KEY))
			.toBe('zh-TW')
		await expect(page)
			.toHaveURL(/\?lang=zh-TW&probe=keep&showcase=survey#anchor$/)

		await setLocale(page, 'en')
		await expect(page.locator('html'))
			.toHaveAttribute('lang', 'en')
		await expect(page.getByRole('button', { name: 'Apply', exact: true }))
			.toBeVisible()
		expect(await page.evaluate(key => localStorage.getItem(key), LOCALE_STORAGE_KEY))
			.toBe('en')
		await expect(page)
			.toHaveURL(/\?lang=en&probe=keep&showcase=survey#anchor$/)

		await page.reload()
		await expect(page.locator('html'))
			.toHaveAttribute('lang', 'en')
	})

	test('explicit en query overrides stored zh-TW', async ({ context, page }) => {
		await context.addInitScript(key => localStorage.setItem(key, 'zh-TW'), LOCALE_STORAGE_KEY)
		await page.goto('/?lang=en')

		await expect(page.locator('html'))
			.toHaveAttribute('lang', 'en')
		await expect(page.getByRole('button', { name: 'Apply', exact: true }))
			.toBeVisible()
		expect(await page.evaluate(key => localStorage.getItem(key), LOCALE_STORAGE_KEY))
			.toBe('en')
	})

	test('stored zh-TW is used when query is absent and canonicalized into the URL', async ({ context, page }) => {
		await context.addInitScript(key => localStorage.setItem(key, 'zh-TW'), LOCALE_STORAGE_KEY)
		await page.goto('/?probe=stored#state')

		await expect(page)
			.toHaveURL(/\?probe=stored&lang=zh-TW&showcase=survey#state$/)
		await expect(page.locator('html'))
			.toHaveAttribute('lang', 'zh-TW')
	})

	test('theme and locale remain independent persisted presentation preferences', async ({ context, page }) => {
		await context.addInitScript(key => localStorage.setItem(key, 'light'), THEME_STORAGE_KEY)
		await page.goto('/?lang=zh-TW&probe=orthogonal#state')

		await expect(page.locator('html'))
			.toHaveAttribute('lang', 'zh-TW')
		await expect(page.locator('html'))
			.toHaveAttribute('data-lab-theme', 'light')

		// The Theme submenu is localized and shows the current theme as the checked item.
		await page.getByTestId('overflow-menu')
			.click()
		await page.getByRole('menuitem', { name: '主題', exact: true })
			.click()
		await expect(page.getByRole('menuitemcheckbox', { name: '亮色', exact: true }))
			.toBeVisible()
		await expect(page.getByRole('menuitemcheckbox', { name: '亮色', exact: true }))
			.toHaveAttribute('aria-checked', 'true')
		await expect(page.getByRole('menuitemcheckbox', { name: '深色', exact: true }))
			.toHaveAttribute('aria-checked', 'false')
		await page.keyboard.press('Escape')
		await page.keyboard.press('Escape')
		await expect(page.getByRole('menu'))
			.toHaveCount(0)

		await setTheme(page, 'dark')
		await expect(page.locator('html'))
			.toHaveAttribute('data-lab-theme', 'dark')
		await expect(page.locator('html'))
			.toHaveAttribute('lang', 'zh-TW')
		expect(await page.evaluate(key => localStorage.getItem(key), THEME_STORAGE_KEY))
			.toBe('dark')
		expect(await page.evaluate(key => localStorage.getItem(key), LOCALE_STORAGE_KEY))
			.toBe('zh-TW')
		await expect(page)
			.toHaveURL(/\?lang=zh-TW&probe=orthogonal&showcase=survey#state$/)

		await setLocale(page, 'en')
		await expect(page.locator('html'))
			.toHaveAttribute('lang', 'en')
		await expect(page.locator('html'))
			.toHaveAttribute('data-lab-theme', 'dark')
		expect(await page.evaluate(key => localStorage.getItem(key), THEME_STORAGE_KEY))
			.toBe('dark')
		await expect(page)
			.toHaveURL(/\?lang=en&probe=orthogonal&showcase=survey#state$/)
	})

	test('changing locale preserves live Runtime state and shared inspector focus', async ({ page }) => {
		await page.goto('/?lang=en&showcase=sandbox')
		await previewFrame(page)
			.getByRole('button', { name: '+1', exact: true })
			.click()
		await expect(previewFrame(page)
			.getByText('count: 1 · doubled: 2', { exact: true }))
			.toBeVisible()

		await page.getByRole('tab', { name: 'Blueprint' })
			.click()
		await page.getByRole('button', { name: 'title : Text' })
			.click()
		await expect(page.getByTestId('blueprint-view-implementation'))
			.toBeVisible()

		await setLocale(page, 'zh-TW')

		// Locale is presentation-only: the same Runtime instance/state remains live and the same selected
		// Blueprint widget remains focused; no Apply/recompile/showcase replacement is involved.
		await page.getByRole('tab', { name: 'Preview' })
			.click()
		await expect(previewFrame(page)
			.getByText('count: 1 · doubled: 2', { exact: true }))
			.toBeVisible()
		await page.getByRole('tab', { name: 'Blueprint' })
			.click()
		const blueprintImplementationButton = page.getByTestId('blueprint-view-implementation')
		await expect(blueprintImplementationButton)
			.toBeVisible()
		await expect(blueprintImplementationButton)
			.toHaveText('查看實作')
	})

	test('changing locale translates the current tutorial step without restarting tutorial progress', async ({ page }) => {
		await page.goto('/?lang=en')
		await chooseTutorialMenuItem(page)

		const rail = page.getByRole('complementary', { name: 'Tutorial' })
		await expect(rail)
			.toBeVisible()
		await expect(rail.getByText('This is the Interactive Survey', { exact: true }))
			.toBeVisible()
		await expect(rail.getByText('Step 1 of 9', { exact: true }))
			.toBeVisible()

		// Move off the initial step before switching locale. If locale changes rebuilt/reset the tutorial,
		// a Step-1-only assertion would falsely pass; Step 2 pins preservation of real progress.
		await rail.getByRole('button', { name: 'Next', exact: true })
			.click()
		await expect(rail.getByText('Step 2 of 9', { exact: true }))
			.toBeVisible()
		await expect(rail.getByText('One answer, stored as State', { exact: true }))
			.toBeVisible()

		await setLocale(page, 'zh-TW')

		const translatedRail = page.getByRole('complementary', { name: '教學' })
		await expect(translatedRail.getByText('第 2 步，共 9 步', { exact: true }))
			.toBeVisible()
		await expect(translatedRail.getByText('一個答案，儲存在 State', { exact: true }))
			.toBeVisible()
		await expect(translatedRail.getByText('第 1 步，共 9 步', { exact: true }))
			.toHaveCount(0)
	})

	test('registered-plugin catalog chrome translates while plugin identity and source stay verbatim', async ({ page }) => {
		await page.goto('/?lang=zh-TW&showcase=sandbox')
		await openDeveloperTool(page, 'implementation')

		await expect(page.getByRole('button', { name: '已註冊 plugins', exact: true }))
			.toHaveAttribute('aria-pressed', 'true')
		await expect(page.getByRole('button', { name: '聚焦的 instance', exact: true }))
			.toBeVisible()

		const catalog = page.getByRole('navigation', { name: '已註冊 plugins' })
		await expect(catalog)
			.toBeVisible()
		await expect(catalog.getByRole('button', { name: 'Counter', exact: true }))
			.toBeVisible()
		await catalog.getByRole('button', { name: 'Counter', exact: true })
			.click()
		await expect(page.getByTestId('implementation-code'))
			.toContainText('createWidgetPlugin(\'Counter\')')
	})

	test('renderer-owned Survey chrome translates while config/data projection remains verbatim', async ({ page }) => {
		await page.goto('/?lang=zh-TW')

		// These strings are hardcoded renderer-owned presentation chrome.
		await expect(previewFrame(page)
			.getByText('回應——後端讀取的內容', { exact: true }))
			.toBeVisible()
		await expect(previewFrame(page)
			.getByText('語言', { exact: true }))
			.toBeVisible()

		// These come from applied Source/config/data and deliberately bypass the presentation translator.
		await expect(previewFrame(page)
			.getByText('Phone number', { exact: true }))
			.toBeVisible()
		await expect(previewFrame(page)
			.getByText('Response — what a backend reads', { exact: true }))
			.toHaveCount(0)
	})
})
