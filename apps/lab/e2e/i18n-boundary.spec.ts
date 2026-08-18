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

	// `IssueList.vue` renders the machine-readable source kind in the first direct child, and the
	// core-owned human diagnostic as the next direct child. Compare that payload alone: #43 is allowed
	// to translate surrounding action chrome such as "jump to node".
	const diagnosticItem = page.locator('li')
		.filter({ hasText: 'UnknownForI18nContract' })
		.first()
	await expect(diagnosticItem)
		.toBeVisible()
	await expect(diagnosticItem.locator('span')
		.first())
		.toHaveText('definition')
	const diagnosticMessage = diagnosticItem.locator(':scope > div')
		.nth(1)
	const englishDiagnostic = await diagnosticMessage.textContent()

	await localeSelect(page)
		.selectOption('zh-TW')
	await expect(page.getByRole('button', { name: /所有問題/ }))
		.toBeVisible()
	await expect(diagnosticItem.locator('span')
		.first())
		.toHaveText('definition')

	// The inspector chrome may translate, but the actual core issue payload is invariant.
	expect(await diagnosticMessage.textContent())
		.toBe(englishDiagnostic)
})
