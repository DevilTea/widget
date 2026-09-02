import { expect, test } from './fixtures'

test.describe('Document Tools developer panel (Phase 6)', () => {
	test('is lazy-added, closable, and reopenable without changing canonical panels', async ({ page }) => {
		const requestedUrls: string[] = []
		page.on('request', request => requestedUrls.push(request.url()))
		await page.goto('/')

		await expect(page.getByRole('tab', { name: 'Document Tools' }))
			.toHaveCount(0)
		const documentToolsChunk = /\/assets\/DocumentToolsPanel-[^/]+\.js(?:\?.*)?$/
		expect(requestedUrls.some(url => documentToolsChunk.test(url)))
			.toBe(false)
		await page.getByTestId('open-document-tools')
			.click()

		const toolsTab = page.getByRole('tab', { name: 'Document Tools' })
		await expect(toolsTab)
			.toHaveAttribute('aria-selected', 'true')
		await expect(page.getByTestId('document-tools-panel'))
			.toBeVisible()
		await expect.poll(() => requestedUrls.some(url => documentToolsChunk.test(url)))
			.toBe(true)
		await expect(page.getByTestId('document-tools-separated-source'))
			.toBeVisible()

		await expect(toolsTab.locator('.dv-default-tab-action'))
			.toHaveCount(1)
		await toolsTab.locator('.dv-default-tab-action')
			.click()
		await expect(toolsTab)
			.toHaveCount(0)

		await page.getByTestId('open-document-tools')
			.click()
		await expect(page.getByRole('tab', { name: 'Document Tools' }))
			.toHaveAttribute('aria-selected', 'true')
		for (const name of ['Author', 'Blueprint', 'Runtime', 'Graph', 'Preview']) {
			await expect(page.getByRole('tab', { name }))
				.toBeVisible()
		}
	})

	test('shows latest Structure/JSON patches, copies the patch, and reports a non-mutating Core conflict', async ({ page }) => {
		await page.goto('/?lab-test')
		await page.getByTestId('open-document-tools')
			.click()

		await page.getByRole('tab', { name: 'Author' })
			.click()
		await page.getByRole('tab', { name: 'Structure' })
			.click()
		await page.getByRole('button', { name: 'title : Text' })
			.click()
		await page.getByLabel('text')
			.fill('Document Tools structure patch')
		await page.getByRole('button', { name: 'Set value' })
			.click()

		await page.getByTestId('open-document-tools')
			.click()
		await expect(page.getByTestId('document-tools-latest-patch'))
			.toContainText('Structure command')
		await expect(page.getByTestId('document-tools-patch'))
			.toContainText('replace')

		const documentStatusBeforeConflict = await page.getByTestId('document-status')
			.textContent()
		const previewStatusBeforeConflict = await page.getByTestId('preview-status')
			.textContent()
		await page.getByTestId('document-tools-run-conflict')
			.click()
		await expect(page.getByTestId('document-tools-conflict-result'))
			.toContainText('document-revision-conflict')
		await expect(page.getByTestId('document-status'))
			.toHaveText(documentStatusBeforeConflict!)
		await expect(page.getByTestId('preview-status'))
			.toHaveText(previewStatusBeforeConflict!)

		await page.evaluate(() => {
			Object.defineProperty(navigator, 'clipboard', {
				configurable: true,
				value: { writeText: async (text: string) => { (window as unknown as { copiedPatch?: string }).copiedPatch = text } },
			})
		})
		await page.getByTestId('document-tools-copy-patch')
			.click()
		await expect.poll(() => page.evaluate(() => (window as unknown as { copiedPatch?: string }).copiedPatch))
			.toContain('replace')

		await page.evaluate(() => (window as any).__WIDGET_LAB_TEST__.setDraftSourceText(JSON.stringify({
			id: 'root',
			type: 'Text',
			config: { text: 'Document Tools JSON patch' },
		})))
		await page.getByRole('button', { name: 'Apply', exact: true })
			.click()
		await page.getByTestId('open-document-tools')
			.click()
		await expect(page.getByTestId('document-tools-latest-patch'))
			.toContainText('JSON Apply')
		await expect(page.getByTestId('document-tools-patch'))
			.toContainText('Document Tools JSON patch')
		await expect(page.getByTestId('document-tools-trace')
			.locator('li'))
			.toHaveCount(3)
	})

	test('clears the conflict result when a new Document revision is committed', async ({ page }) => {
		await page.goto('/?lab-test')
		await page.getByTestId('open-document-tools')
			.click()
		await page.getByTestId('document-tools-run-conflict')
			.click()
		await expect(page.getByTestId('document-tools-conflict-result'))
			.toBeVisible()

		await page.getByLabel('Load a preset')
			.selectOption('invalid-semantic')
		await expect(page.getByTestId('document-status'))
			.toContainText('invalid')
		await expect(page.getByTestId('document-tools-conflict-result'))
			.toHaveCount(0)
	})

	test('clears the conflict result when a showcase replaces the session at the same revision', async ({ page }) => {
		await page.goto('/?lab-test')
		await page.getByTestId('open-document-tools')
			.click()
		await page.getByTestId('document-tools-run-conflict')
			.click()
		await expect(page.getByTestId('document-tools-conflict-result'))
			.toBeVisible()

		await page.getByLabel('Switch showcase')
			.selectOption('survey')
		await expect(page.getByLabel('Switch showcase'))
			.toHaveValue('survey')
		await expect(page.getByTestId('document-tools-conflict-result'))
			.toHaveCount(0)
	})
})
