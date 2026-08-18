import { expect, test } from './fixtures'

/** Issue #42: passive registered-plugin browsing alongside the existing focused-instance inspector. */
test.describe('Implementation registered-plugin catalog (issue #42)', () => {
	test('opens directly from the header without widget focus and exposes every Sandbox curated plugin type', async ({ page }) => {
		await page.goto('/')
		await page.getByRole('button', { name: 'Implementation', exact: true })
			.click()

		await expect(page.getByRole('tab', { name: 'Implementation' }))
			.toHaveAttribute('aria-selected', 'true')
		await expect(page.getByRole('button', { name: 'Registered plugins' }))
			.toHaveAttribute('aria-pressed', 'true')

		const catalog = page.getByRole('navigation', { name: 'Registered plugins' })
		for (const type of ['Text', 'Counter', 'Section', 'Stack', 'Summary']) {
			await expect(catalog.getByRole('button', { name: type, exact: true }))
				.toBeVisible()
		}

		// Applied instance is concrete-instance data, never a plugin-type catalog tab.
		await expect(page.getByRole('button', { name: 'Applied instance' }))
			.toHaveCount(0)

		await catalog.getByRole('button', { name: 'Counter', exact: true })
			.click()
		await expect(catalog.getByRole('button', { name: 'Counter', exact: true }))
			.toHaveAttribute('aria-current', 'true')
		await expect(page.getByTestId('implementation-code'))
			.toContainText("createWidgetPlugin('Counter')")
	})

	test('switching showcases replaces the catalog with the new showcase registry', async ({ page }) => {
		await page.goto('/')
		await page.getByRole('button', { name: 'Implementation', exact: true })
			.click()

		let catalog = page.getByRole('navigation', { name: 'Registered plugins' })
		await expect(catalog.getByRole('button', { name: 'Text', exact: true }))
			.toBeVisible()

		await page.getByLabel('Switch showcase')
			.selectOption('survey')

		catalog = page.getByRole('navigation', { name: 'Registered plugins' })
		await expect(catalog.getByRole('button', { name: 'TripSurvey', exact: true }))
			.toBeVisible()
		await expect(catalog.getByRole('button', { name: 'TripRecommendation', exact: true }))
			.toBeVisible()
		await expect(catalog.getByRole('button', { name: 'Text', exact: true }))
			.toHaveCount(0)
		await expect(catalog.getByRole('button', { name: 'TripSurvey', exact: true }))
			.toHaveAttribute('aria-current', 'true')
	})

	test('catalog browsing never changes shared focus, and contextual View implementation requests return to Focused instance', async ({ page }) => {
		await page.goto('/')

		// Establish one real shared focus through Blueprint: `title : Text`.
		await page.getByRole('tab', { name: 'Blueprint' })
			.click()
		await page.getByRole('button', { name: 'title : Text' })
			.click()

		// Header opens catalog mode independently of that focus; browse a different plugin type.
		await page.getByRole('button', { name: 'Implementation', exact: true })
			.click()
		const catalog = page.getByRole('navigation', { name: 'Registered plugins' })
		await catalog.getByRole('button', { name: 'Counter', exact: true })
			.click()

		// Returning to Focused instance resolves the original shared focus; catalog selection did not
		// become a second semantic/instance selection model.
		await page.getByRole('button', { name: 'Focused instance' })
			.click()
		await expect(page.getByRole('button', { name: 'Focused instance' }))
			.toHaveAttribute('aria-pressed', 'true')
		await expect(page.getByText('Text', { exact: true }))
			.toBeVisible()
		await expect(page.getByRole('button', { name: 'Applied instance' }))
			.toBeVisible()

		// Put the panel back in catalog mode, then use the existing contextual entry point. `open()`'s
		// default request mode must switch the already-mounted panel back to focused mode.
		await page.getByRole('button', { name: 'Registered plugins' })
			.click()
		await page.getByRole('tab', { name: 'Blueprint' })
			.click()
		await page.getByTestId('blueprint-view-implementation')
			.click()
		await expect(page.getByRole('button', { name: 'Focused instance' }))
			.toHaveAttribute('aria-pressed', 'true')
		await expect(page.getByText('Text', { exact: true }))
			.toBeVisible()
	})
})
