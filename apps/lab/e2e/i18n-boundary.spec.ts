import { expect, test } from './fixtures'

interface LabTestWindow {
	__WIDGET_LAB_TEST__?: {
		setDraftSourceText: (text: string) => void
	}
}

function localeSelect(page: import('@playwright/test').Page) {
	return page.locator('select:has(option[value="zh-TW"])')
}

test('core diagnostic text is not localized when presentation locale changes (issue #43)', async ({ page }) => {
	await page.goto('/?lab-test&lang=en')
	await page.waitForFunction(() => typeof (window as unknown as LabTestWindow).__WIDGET_LAB_TEST__?.setDraftSourceText === 'function')
	await page.evaluate(() => {
		const seam = (window as unknown as LabTestWindow).__WIDGET_LAB_TEST__
		seam?.setDraftSourceText(JSON.stringify({ id: 'root', type: 'UnknownForI18nContract' }, null, 2))
	})
	await page.getByRole('button', { name: 'Apply', exact: true })
		.click()
	await page.getByRole('tab', { name: 'Blueprint' })
		.click()
	await page.getByRole('button', { name: /All issues/ })
		.click()

	const diagnosticItem = page.locator('li')
		.filter({ has: page.locator('strong') })
		.filter({ hasText: 'UnknownForI18nContract' })
		.first()
	await expect(diagnosticItem)
		.toBeVisible()
	const englishDiagnostic = await diagnosticItem.innerText()
	await expect(diagnosticItem.locator('strong'))
		.toContainText('[definition]')

	await localeSelect(page)
		.selectOption('zh-TW')
	await expect(page.getByRole('button', { name: /所有問題/ }))
		.toBeVisible()
	expect(await diagnosticItem.innerText())
		.toBe(englishDiagnostic)
})
