import { expect, openDeveloperTool, openTool, selectShowcase, test, toolPanel, toolTab } from './fixtures'

/** Issue #42: passive registered-plugin browsing alongside the existing focused-instance inspector. */
test.describe('implementation registered-plugin catalog (issue #42)', () => {
	test('opens directly from the header without widget focus and exposes every Sandbox curated plugin type', async ({ page }) => {
		await page.goto('/?showcase=sandbox')
		await openDeveloperTool(page, 'implementation')

		await expect(toolTab(page, 'implementation'))
			.toHaveAttribute('aria-selected', 'true')
		// The tab names the plugin type the catalog shows (Lab UX phase 3B).
		await expect(toolTab(page, 'implementation'))
			.toHaveAccessibleName(/^Implementation — \S/)
		await expect(page.getByRole('button', { name: 'Registered plugins' }))
			.toHaveAttribute('aria-pressed', 'true')

		const catalog = page.getByRole('navigation', { name: 'Registered plugins' })
		for (const type of ['Text', 'Counter', 'Section', 'Stack', 'Summary']) {
			await expect(catalog.getByRole('button', { name: type, exact: true }))
				.toBeVisible()
		}

		await expect(page.getByRole('button', { name: 'Applied instance' }))
			.toHaveCount(0)

		await catalog.getByRole('button', { name: 'Counter', exact: true })
			.click()
		await expect(catalog.getByRole('button', { name: 'Counter', exact: true }))
			.toHaveAttribute('aria-current', 'true')
		await expect(page.getByTestId('implementation-code'))
			.toContainText('createWidgetPlugin(\'Counter\')')
		await expect(page.getByRole('button', { name: 'renderers.ts', exact: true }))
			.toBeVisible()
		await page.getByRole('button', { name: 'renderers.ts', exact: true })
			.click()
		await expect(page.getByTestId('implementation-code'))
			.toContainText('CounterRenderer')
	})

	test('switching showcases replaces the catalog with the new showcase registry', async ({ page }) => {
		await page.goto('/?showcase=sandbox')
		await openDeveloperTool(page, 'implementation')

		let catalog = page.getByRole('navigation', { name: 'Registered plugins' })
		await expect(catalog.getByRole('button', { name: 'Text', exact: true }))
			.toBeVisible()

		await selectShowcase(page, 'survey')

		catalog = page.getByRole('navigation', { name: 'Registered plugins' })
		await expect(catalog.getByRole('button', { name: 'Survey', exact: true }))
			.toBeVisible()
		await expect(catalog.getByRole('button', { name: 'Numeric', exact: true }))
			.toBeVisible()
		await expect(catalog.getByRole('button', { name: 'Text', exact: true }))
			.toHaveCount(0)
		await expect(catalog.getByRole('button', { name: 'Survey', exact: true }))
			.toHaveAttribute('aria-current', 'true')
	})

	test('catalog browsing never changes shared focus, and contextual View implementation requests return to Focused instance', async ({ page }) => {
		await page.goto('/?showcase=sandbox')

		await openTool(page, 'blueprint')
		// Scoped to the Blueprint tree: the Edit tab beside it lists the same widgets in its Structure tree.
		await toolPanel(page, 'blueprint')
			.getByRole('button', { name: 'title : Text' })
			.click()

		await openDeveloperTool(page, 'implementation')
		const catalog = page.getByRole('navigation', { name: 'Registered plugins' })
		await catalog.getByRole('button', { name: 'Counter', exact: true })
			.click()

		await page.getByRole('button', { name: 'Focused instance' })
			.click()
		await expect(page.getByRole('button', { name: 'Focused instance' }))
			.toHaveAttribute('aria-pressed', 'true')
		await expect(page.getByText('Text', { exact: true }))
			.toBeVisible()
		await expect(page.getByRole('button', { name: 'Applied instance' }))
			.toBeVisible()

		await page.getByRole('button', { name: 'Registered plugins' })
			.click()
		await openTool(page, 'blueprint')
		await page.getByTestId('blueprint-view-implementation')
			.click()
		await expect(page.getByRole('button', { name: 'Focused instance' }))
			.toHaveAttribute('aria-pressed', 'true')
		await expect(page.getByText('Text', { exact: true }))
			.toBeVisible()
	})
})
