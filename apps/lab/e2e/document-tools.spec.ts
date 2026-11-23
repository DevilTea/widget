import { expect, expectDocumentStatus, expectShowcase, loadPreset, openDeveloperTool, openEditStructure, previewFrame, selectShowcase, test, toolTab } from './fixtures'

test.describe('Document Tools developer panel (Phase 6)', () => {
	test('is lazy-added, closable, and reopenable without changing canonical panels', async ({ page }) => {
		const requestedUrls: string[] = []
		page.on('request', request => requestedUrls.push(request.url()))
		await page.goto('/')

		await expect(toolTab(page, 'document-tools'))
			.toHaveCount(0)
		const documentToolsChunk = /\/assets\/DocumentToolsPanel-[^/]+\.js(?:\?.*)?$/
		expect(requestedUrls.some(url => documentToolsChunk.test(url)))
			.toBe(false)
		await openDeveloperTool(page, 'document-tools')

		const toolsTab = toolTab(page, 'document-tools')
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

		await openDeveloperTool(page, 'document-tools')
		await expect(toolTab(page, 'document-tools'))
			.toHaveAttribute('aria-selected', 'true')
		for (const name of ['Edit', 'Explain', 'Tools', 'Preview']) {
			await expect(page.getByRole('tab', { name, exact: true }))
				.toBeVisible()
		}
	})

	test('shows latest Structure/JSON patches, copies the patch, and reports a non-mutating Core conflict', async ({ page }) => {
		await page.goto('/?lab-test&showcase=sandbox')
		await openDeveloperTool(page, 'document-tools')

		await openEditStructure(page)
		await page.getByRole('button', { name: 'title : Text' })
			.click()
		await page.getByLabel('text', { exact: true })
			.fill('Document Tools structure patch')
		await page.keyboard.press('Enter')

		await openDeveloperTool(page, 'document-tools')
		await expect(page.getByTestId('document-tools-latest-patch'))
			.toContainText('Structure command')
		await expect(page.getByTestId('document-tools-patch'))
			.toContainText('replace')

		// The facts the status chip reports (its text may still be the brief "Preview restarted" of the Structure commit).
		const documentStatusBeforeConflict = await page.getByTestId('lab-status')
			.getAttribute('data-validity')
		const previewStatusBeforeConflict = await page.getByTestId('lab-status')
			.getAttribute('data-preview')
		await page.getByTestId('document-tools-run-conflict')
			.click()
		await expect(page.getByTestId('document-tools-conflict-result'))
			.toContainText('document-revision-conflict')
		await expect(page.getByTestId('lab-status'))
			.toHaveAttribute('data-validity', documentStatusBeforeConflict!)
		await expect(page.getByTestId('lab-status'))
			.toHaveAttribute('data-preview', previewStatusBeforeConflict!)
		await expect(previewFrame(page)
			.getByText('Document Tools structure patch'))
			.toBeVisible()

		await page.evaluate(() => {
			Object.defineProperty(navigator, 'clipboard', {
				configurable: true,
				value: { writeText: async (text: string) => { (window as unknown as { copiedPatch?: string }).copiedPatch = text } },
			})
		})
		const displayedPatch = (await page.getByTestId('document-tools-patch')
			.textContent())?.trim()
		await page.getByTestId('document-tools-copy-patch')
			.click()
		await expect.poll(() => page.evaluate(
			() => (window as unknown as { copiedPatch?: string }).copiedPatch?.trim(),
		))
			.toBe(displayedPatch)

		await page.evaluate(() => (window as any).__WIDGET_LAB_TEST__.editJson(JSON.stringify({
			id: 'root',
			type: 'Text',
			config: { text: 'Document Tools JSON patch' },
		})))
		await openDeveloperTool(page, 'document-tools')
		await expect(page.getByTestId('document-tools-latest-patch'))
			.toContainText('JSON edit')
		await expect(page.getByTestId('document-tools-patch'))
			.toContainText('Document Tools JSON patch')
		await expect(page.getByTestId('document-tools-trace')
			.locator('li'))
			.toHaveCount(3)
	})

	test('clears the conflict result when a new Document revision is committed', async ({ page }) => {
		await page.goto('/?lab-test&showcase=sandbox')
		await openDeveloperTool(page, 'document-tools')
		await page.getByTestId('document-tools-run-conflict')
			.click()
		await expect(page.getByTestId('document-tools-conflict-result'))
			.toBeVisible()

		await loadPreset(page, 'invalid-semantic')
		await expectDocumentStatus(page, { problems: 1 })
		await expect(page.getByTestId('document-tools-conflict-result'))
			.toHaveCount(0)
	})

	test('clears the conflict result when a showcase replaces the session at the same revision', async ({ page }) => {
		await page.goto('/?lab-test&showcase=sandbox')
		await openDeveloperTool(page, 'document-tools')
		await page.getByTestId('document-tools-run-conflict')
			.click()
		await expect(page.getByTestId('document-tools-conflict-result'))
			.toBeVisible()

		await selectShowcase(page, 'survey')
		await expectShowcase(page, 'survey')
		await expect(page.getByTestId('document-tools-conflict-result'))
			.toHaveCount(0)
	})
})
