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

	// `IssueList.vue` renders the machine-readable source kind as a badge (`span`) and the core-owned
	// human diagnostic as a sibling `div`; do not couple this contract to invented `<strong>` markup.
	const diagnosticItem = page.locator('li')
		.filter({ hasText: 'UnknownForI18nContract' })
		.first()
	await expect(diagnosticItem)
		.toBeVisible()
	await expect(diagnosticItem.locator('span')
		.first())
		.toHaveText('definition')
	const englishDiagnostic = await diagnosticItem.textContent()

	await localeSelect(page)
		.selectOption('zh-TW')
	await expect(page.getByRole('button', { name: /所有問題/ }))
		.toBeVisible()

	// Locale changes may translate the inspector chrome around this item, but the actual core diagnostic
	// payload and semantic source kind remain byte-for-byte the same.
	expect(await diagnosticItem.textContent())
		.toBe(englishDiagnostic)
})
