import type { Locator } from '@playwright/test'
import { expect, expectDocumentStatus, loadPreset, openAuthorJson, openExplain, test } from './fixtures'

/**
 * Lab UX phase 2, report item 12: Structure shows the committed Document's problems at their fields, at the widget, or in a
 * compact list, and "Show problems" stays in the open Edit view.
 */

const field = (editor: Locator, path: string): Locator => editor.locator(`[data-config-path="${path}"]`)

test.describe('problems in Structure (report item 12)', () => {
	test('a max below min shows at the max field, with the field marked invalid and described by it', async ({ page }) => {
		await page.goto('/?showcase=survey')
		const editor = page.getByTestId('structure-editor')
		await page.getByRole('button', { name: /^guests : Numeric/ })
			.click()
		const max = field(editor, 'max')
		// survey-default's guests has min 0 and max 3.
		const box = max.locator('input')
		await box.fill('-1')
		await box.press('Enter')
		await expectDocumentStatus(page, { problems: 1 })

		const problem = max.getByTestId('field-problem')
		await expect(problem)
			.toContainText('invalid-widget-config: ')
		await expect(problem)
			.toContainText('must not be less than min (0).')
		await expect(box)
			.toHaveAttribute('aria-invalid', 'true')
		const describedBy = await box.getAttribute('aria-describedby')
		expect(describedBy)
			.toBe(await max.getByTestId('field-problems')
				.getAttribute('id'))
		// The other fields are not marked.
		await expect(field(editor, 'min')
			.locator('input'))
			.toHaveAttribute('aria-invalid', 'false')

		// From another widget, the problem is listed and one click shows it at its field.
		await page.getByRole('button', { name: /^mode : SingleChoice/ })
			.click()
		const list = editor.getByTestId('structure-problems')
		await expect(list)
			.toContainText('1 problem elsewhere in the document')
		await list.getByTestId('structure-problem-row')
			.click()
		await expect(editor.getByRole('heading', { name: 'guests : Numeric' }))
			.toBeVisible()
		await expect(box)
			.toBeFocused()
	})

	test('a widget-level problem shows at the widget header, and "Show problems" stays in Structure and focuses the first problem', async ({ page }) => {
		await page.goto('/?showcase=survey')
		await loadPreset(page, 'survey-ai-draft')
		const editor = page.getByTestId('structure-editor')
		await page.getByRole('button', { name: /^guests : Numeric/ })
			.click()
		// guests' condition names a question that does not exist: a dependency diagnostic at the widget, not at a field.
		const nodeProblems = editor.getByTestId('node-problems')
		await expect(nodeProblems.getByTestId('node-problem'))
			.toContainText('missing-dependency-target')
		await expect(editor.getByTestId('field-problem'))
			.toHaveCount(0)
		await expect(editor.getByTestId('structure-problems'))
			.toContainText('4 problems elsewhere in the document')

		await openExplain(page)
		await page.getByTestId('preview-show-problems')
			.click()
		await expect(page.getByTestId('author-view-structure'))
			.toHaveAttribute('aria-selected', 'true')
		await expect(editor.getByRole('heading', { name: 'mode : SingleChoice' }))
			.toBeVisible()
		await expect(field(editor, 'options')
			.getByTestId('field-problems'))
			.toBeFocused()
	})

	// The Catalog is a modal slide-over since Lab UX phase 3B, not a view "Show problems" could be pressed from.
	test('in JSON, "Show problems" keeps the list under the editor', async ({ page }) => {
		await page.goto('/?showcase=survey')
		await loadPreset(page, 'survey-ai-draft')

		await openAuthorJson(page)
		await page.getByTestId('lab-status')
			.click()
		await expect(page.getByTestId('author-view-json'))
			.toHaveAttribute('aria-selected', 'true')
		await expect(page.getByTestId('author-problems')
			.getByTestId('problem-row')
			.first())
			.toBeFocused()
	})
})
