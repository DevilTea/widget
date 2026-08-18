import { expect, test } from './fixtures'

const THEME_STORAGE_KEY = 'widget-lab:theme'

async function seedTheme(context: import('@playwright/test').BrowserContext, theme: 'light' | 'dark'): Promise<void> {
	await context.addInitScript(({ key, value }) => localStorage.setItem(key, value), { key: THEME_STORAGE_KEY, value: theme })
}

test.describe('lab theme (issue #44)', () => {
	test('switches document, Monaco, and Dockview presentation without resetting Runtime state', async ({ context, page }) => {
		await seedTheme(context, 'light')
		await page.goto('/')

		const themeSelect = page.getByLabel('Theme')
		await expect(themeSelect)
			.toHaveValue('light')
		await expect(page.locator('html'))
			.toHaveAttribute('data-lab-theme', 'light')
		await expect(page.locator('.monaco-editor'))
			.toBeVisible()

		const monacoLight = await page.locator('.monaco-editor')
			.evaluate(element => getComputedStyle(element).backgroundColor)
		const dockviewLight = await page.locator('.dockview-theme-lab')
			.evaluate(element => getComputedStyle(element).getPropertyValue('--dv-group-view-background-color'))

		await page.getByRole('button', { name: '+1', exact: true })
			.click()
		await expect(page.getByText('count: 1 · doubled: 2', { exact: true }))
			.toBeVisible()

		await themeSelect.selectOption('dark')
		await expect(page.locator('html'))
			.toHaveAttribute('data-lab-theme', 'dark')
		await expect(page.getByText('count: 1 · doubled: 2', { exact: true }))
			.toBeVisible()
		expect(await page.evaluate(key => localStorage.getItem(key), THEME_STORAGE_KEY))
			.toBe('dark')

		await expect.poll(async () => page.locator('.monaco-editor')
			.evaluate(element => getComputedStyle(element).backgroundColor))
			.not.toBe(monacoLight)
		const dockviewDark = await page.locator('.dockview-theme-lab')
			.evaluate(element => getComputedStyle(element).getPropertyValue('--dv-group-view-background-color'))
		expect(dockviewDark)
			.not.toBe(dockviewLight)

		await page.reload()
		await expect(themeSelect)
			.toHaveValue('dark')
	})

	test('rehighlights already-loaded Implementation source when theme changes without reloading source text', async ({ context, page, blockedRequestUrls }) => {
		await seedTheme(context, 'light')
		await page.goto('/')
		await page.getByRole('tab', { name: 'Blueprint' })
			.click()
		await page.getByRole('button', { name: 'title : Text' })
			.click()
		await page.getByTestId('blueprint-view-implementation')
			.click()

		const code = page.getByTestId('implementation-code')
		const pre = code.locator('pre')
		await expect(pre)
			.toBeVisible()
		await expect(code)
			.toContainText("createWidgetPlugin('Text')")
		const textBefore = await code.textContent()
		const lightBackground = await pre.evaluate(element => getComputedStyle(element).backgroundColor)

		await page.getByLabel('Theme')
			.selectOption('dark')
		await expect.poll(async () => pre.evaluate(element => getComputedStyle(element).backgroundColor))
			.not.toBe(lightBackground)
		expect(await code.textContent())
			.toBe(textBefore)
		expect(blockedRequestUrls)
			.toEqual([])
	})
})

test.describe('native dialog theme foreground (issue #44)', () => {
	test.use({ welcomeDismissed: false })

	for (const selectedTheme of ['light', 'dark'] as const) {
		test(`welcome dialog inherits readable foreground in ${selectedTheme} theme`, async ({ context, page }) => {
			await seedTheme(context, selectedTheme)
			await page.goto('/')

			const dialog = page.getByRole('dialog')
			await expect(dialog)
				.toBeVisible()
			const heading = dialog.getByRole('heading')
			await expect(heading)
				.toBeVisible()
			const colors = await heading.evaluate((element) => ({
				heading: getComputedStyle(element).color,
				body: getComputedStyle(document.body).color,
			}))
			expect(colors.heading)
				.toBe(colors.body)
		})
	}
})
