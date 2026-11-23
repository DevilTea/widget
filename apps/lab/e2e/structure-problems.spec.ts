import type { Locator } from '@playwright/test'
import { documentSourceText, editJson, expect, expectDocumentStatus, loadPreset, openAuthorJson, openExplain, test, waitForLabTestSeam } from './fixtures'

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

	test('a broken widget reference shows at its field, and "Show problems" stays in Structure and focuses the first problem', async ({ page }) => {
		await page.goto('/?showcase=survey')
		await loadPreset(page, 'survey-ai-draft')
		const editor = page.getByTestId('structure-editor')
		await page.getByRole('button', { name: /^guests : Numeric/ })
			.click()
		// guests' condition names a question that does not exist (`"mod"`). Core reports the dependency at the widget; the config
		// value the schema marks as a widget reference (`@widgetRef`) is where it is written, so it shows there, not at the header.
		const question = field(editor, 'visibleWhen.question')
		await expect(question.getByTestId('field-problem'))
			.toHaveText(/^missing-dependency-target: /)
		await expect(question.locator('input'))
			.toHaveAttribute('aria-invalid', 'true')
		await expect(editor.getByTestId('field-problem'))
			.toHaveCount(1)
		await expect(editor.getByTestId('node-problems'))
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

	test('a rule condition naming a missing question shows at that question field, and "Show problems" focuses it', async ({ page }) => {
		await page.goto('/?lab-test&showcase=survey')
		await waitForLabTestSeam(page)
		const editor = page.getByTestId('structure-editor')
		// sessions' rule: rules -> when -> all -> question, the second condition's question typed wrong.
		const text = await documentSourceText(page)
		await editJson(page, text.replace('{ "question": "guests", "op": "greaterThan", "value": 2 }', '{ "question": "gusets", "op": "greaterThan", "value": 2 }'))
		await expectDocumentStatus(page, { problems: 1 })

		await page.getByRole('button', { name: /^sessions : MultipleChoice/ })
			.click()
		const question = field(editor, 'rules.0.when.all.1.question')
		await expect(question.getByTestId('field-problem'))
			.toHaveText(/^missing-dependency-target: /)
		await expect(editor.getByTestId('field-problem'))
			.toHaveCount(1)
		await expect(editor.getByTestId('node-problems'))
			.toHaveCount(0)

		// From another widget, "Show problems" selects sessions and focuses the question's control.
		await page.getByRole('button', { name: /^mode : SingleChoice/ })
			.click()
		await page.getByTestId('lab-status')
			.click()
		await expect(editor.getByRole('heading', { name: 'sessions : MultipleChoice' }))
			.toBeVisible()
		await expect(question.locator('input'))
			.toBeFocused()
	})

	test('a dependency diagnostic with no config location stays at the widget header', async ({ page }) => {
		await page.goto('/?lab-test&showcase=survey')
		await waitForLabTestSeam(page)
		await loadPreset(page, 'survey-ai-draft')
		const editor = page.getByTestId('structure-editor')
		// guests' condition now names `rating`, a question of an unknown type: the reference is right and the target is broken
		// (`unresolved-dependency-target`, a code the config location does not apply to), so the problem stays at the widget.
		await expectDocumentStatus(page, { problems: 5 })
		const text = await documentSourceText(page)
		expect(text)
			.toContain('"visibleWhen": { "question": "mod",')
		await editJson(page, text.replace('"visibleWhen": { "question": "mod",', '"visibleWhen": { "question": "rating",'))
		await expect.poll(() => documentSourceText(page))
			.toContain('"question": "rating"')
		await page.getByRole('button', { name: /^guests : Numeric/ })
			.click()
		await expect(editor.getByTestId('node-problems')
			.getByTestId('node-problem'))
			.toContainText('unresolved-dependency-target')
		await expect(editor.getByTestId('field-problem'))
			.toHaveCount(0)
	})

	test('in JSON, the squiggle covers the broken reference\'s value, not the widget id, and "Go to location" selects it', async ({ page }) => {
		await page.goto('/?lab-test&showcase=survey')
		await waitForLabTestSeam(page)
		await loadPreset(page, 'survey-ai-draft')
		await openAuthorJson(page)
		const editor = page.getByTestId('json-editor')
		await expect(editor)
			.toHaveAttribute('data-marker-count', '5')

		await page.getByTestId('author-problems')
			.locator('[data-testid="problem-row"][data-problem-code="missing-dependency-target"]')
			.click()
		await expect(editor.locator('.monaco-editor'))
			.toHaveClass(/focused/)
		// The value `"mod"` on guests' visibleWhen line, as Monaco renders it (one string token).
		const line = editor.locator('.view-line')
			.filter({ hasText: '"question": "mod"' })
		await expect(line)
			.toHaveCount(1)
		const value = line.locator('span span')
			.filter({ hasText: /^"mod"$/ })
		const valueBox = (await value.boundingBox())!
		const selected = editor.locator('.selected-text')
		await expect(selected)
			.toHaveCount(1)
		const selectedBox = (await selected.boundingBox())!
		expect(Math.abs(selectedBox.x - valueBox.x), 'the selection starts at the value')
			.toBeLessThan(2)
		expect(Math.abs(selectedBox.width - valueBox.width), 'the selection is the value, quotes included')
			.toBeLessThan(2)
		expect(Math.abs(selectedBox.y - valueBox.y), 'on the visibleWhen line, not the "id" line')
			.toBeLessThan(4)

		// The squiggle on that line covers the same range.
		const squiggles = await editor.locator('.squiggly-error')
			.all()
		const boxes = await Promise.all(squiggles.map(squiggle => squiggle.boundingBox()))
		const onLine = boxes.filter(box => box !== null && Math.abs(box.y - valueBox.y) < 4)
		expect(onLine)
			.toHaveLength(1)
		expect(Math.abs(onLine[0]!.x - valueBox.x))
			.toBeLessThan(2)
		expect(Math.abs(onLine[0]!.width - valueBox.width))
			.toBeLessThan(2)
		// And no squiggle sits on guests' `"id"` line any more. The line is four lines above the revealed value, so it is on screen
		// (Monaco renders only visible lines; the assertion fails rather than passing silently if it is not).
		const idLine = editor.locator('.view-line')
			.filter({ hasText: '"id": "guests"' })
		await expect(idLine)
			.toBeVisible()
		const idBox = (await idLine.boundingBox())!
		const allBoxes = await Promise.all((await editor.locator('.squiggly-error')
			.all()).map(squiggle => squiggle.boundingBox()))
		expect(allBoxes.filter(box => box !== null && Math.abs(box.y - idBox.y) < 4))
			.toHaveLength(0)
	})

	test('two diagnostics about one reference written twice: two rows, one line per field, one squiggle per value', async ({ page }) => {
		await page.goto('/?lab-test&showcase=survey')
		await waitForLabTestSeam(page)
		const editor = page.getByTestId('structure-editor')
		// sessions reads `gusets` twice, from the kids option's visibleWhen and from its rule: Core reports one diagnostic per member
		// (`options`, `errors`), and each is located at both values.
		const text = (await documentSourceText(page))
			.replace('"visibleWhen": { "question": "guests", "op": "greaterThan", "value": 0 }', '"visibleWhen": { "question": "gusets", "op": "greaterThan", "value": 0 }')
			.replace('{ "question": "guests", "op": "greaterThan", "value": 2 }', '{ "question": "gusets", "op": "greaterThan", "value": 2 }')
		await editJson(page, text)
		await expectDocumentStatus(page, { problems: 2 })

		await page.getByRole('button', { name: /^sessions : MultipleChoice/ })
			.click()
		for (const path of ['options.2.visibleWhen.question', 'rules.0.when.all.1.question']) {
			await expect(field(editor, path)
				.getByTestId('field-problem'))
				.toHaveCount(1)
		}
		await expect(editor.getByTestId('field-problem'))
			.toHaveCount(2)

		await openAuthorJson(page)
		await expect(page.getByTestId('author-problems')
			.getByTestId('problem-row'))
			.toHaveCount(2)
		await expect(page.getByTestId('json-editor'))
			.toHaveAttribute('data-marker-count', '2')
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
