import type { Locator, Page } from '@playwright/test'
import { expect, openStatusDetails, test } from './fixtures'

/**
 * Issue #230 PR 3c (audit U15): the Structure editor picks its control from the plugin's config JSON Schema (a switch
 * for a boolean, a number box that knows its limits, a list for an enum, a text box for a string), adds and removes
 * optional fields and array items where the schema allows it, and every edit goes through the Document (Undo, the
 * status chips, Problems and the unapplied-draft protection keep working). Nothing here retries an action.
 */

interface LabTestWindow {
	__WIDGET_LAB_TEST__?: { setDraftSourceText: (text: string) => void, getDocumentSourceText: () => string }
}

async function openStructure(page: Page, widget: RegExp, query = 'showcase=survey', tabs = { author: 'Author', structure: 'Structure' }): Promise<Locator> {
	await page.goto(`/?lab-test&${query}`)
	await page.getByRole('tab', { name: tabs.author, exact: true })
		.click()
	await page.getByRole('tab', { name: tabs.structure, exact: true })
		.click()
	await page.getByRole('button', { name: widget })
		.click()
	const editor = page.getByTestId('structure-editor')
	await expect(editor)
		.toBeVisible()
	return editor
}

const field = (editor: Locator, path: string): Locator => editor.locator(`[data-config-path="${path}"]`)

/** The applied Document source (read through the test seam: the editor only renders the lines in view). */
async function documentSource(page: Page): Promise<unknown> {
	return JSON.parse(await page.evaluate(() => (window as unknown as LabTestWindow).__WIDGET_LAB_TEST__!.getDocumentSourceText()))
}

function configOf(source: unknown, id: string): Record<string, unknown> {
	const questions = ((source as { slots: { questions: { id: string, config: Record<string, unknown> }[] } }).slots.questions)
	return questions.find(question => question.id === id)!.config
}

test.describe('type-aware controls', () => {
	test('a boolean is a switch: one click changes the Document, Undo takes it back', async ({ page }) => {
		const editor = await openStructure(page, /guests : Numeric/)
		const integer = field(editor, 'integer')
			.getByRole('switch')
		await expect(integer)
			.toBeChecked()

		await integer.click()
		await expect(page.getByTestId('author-command-outcome'))
			.toContainText('Author command applied to Document r1.')
		await expect(integer)
			.not
			.toBeChecked()
		expect(configOf(await documentSource(page), 'guests').integer)
			.toBe(false)

		await page.getByTestId('undo-button')
			.click()
		// Undo restores the whole source as a new revision, so the selection starts again at the root.
		await page.getByRole('button', { name: /guests : Numeric/ })
			.click()
		await expect(integer)
			.toBeChecked()
	})

	test('a number box applies on Enter, refuses what the schema rules out and says so', async ({ page }) => {
		const editor = await openStructure(page, /phone : ShortAnswer/)
		// `maxLength` is an integer of at least 1.
		const maxLength = field(editor, 'maxLength')
			.getByRole('textbox')
		await maxLength.fill('2.5')
		await maxLength.press('Enter')
		await expect(field(editor, 'maxLength')
			.getByRole('alert'))
			.toHaveText('Enter a valid value of the same scalar type.')
		await expect(page.getByTestId('author-command-outcome'))
			.toHaveCount(0)

		await maxLength.fill('0')
		await maxLength.press('Enter')
		await expect(field(editor, 'maxLength')
			.getByRole('alert'))
			.toBeVisible()

		await maxLength.fill('12')
		await maxLength.press('Enter')
		await expect(page.getByTestId('author-command-outcome'))
			.toContainText('Author command applied')
		expect(configOf(await documentSource(page), 'phone').maxLength)
			.toBe(12)
	})

	test('an enum is a list of the schema\'s options, also inside a condition', async ({ page }) => {
		const editor = await openStructure(page, /phone : ShortAnswer/)
		// `required` is a boolean or a condition; the value is a condition, so it is edited as one.
		const op = field(editor, 'required.op')
			.getByRole('combobox')
		await expect(op)
			.toHaveValue(/\d/)
		await expect(op.locator('option:checked'))
			.toHaveText('equals')
		await expect(op.locator('option'))
			.toHaveText(['equals', 'notEquals'])

		await op.selectOption({ label: 'notEquals' })
		await expect(page.getByTestId('author-command-outcome'))
			.toContainText('Author command applied')
		expect((configOf(await documentSource(page), 'phone').required as { op: string }).op)
			.toBe('notEquals')
	})

	test('a plugin without a config schema still gets typed controls, and says that nothing can be added', async ({ page }) => {
		const editor = await openStructure(page, /title : Text/, 'showcase=sandbox')
		await expect(editor)
			.toContainText('publishes no config schema')
		await field(editor, 'text')
			.getByRole('textbox')
			.fill('typed')
		await field(editor, 'text')
			.getByRole('button', { name: /Set value/ })
			.click()
		await expect(page.getByTestId('author-command-outcome'))
			.toContainText('Author command applied')
		await expect(editor.getByRole('button', { name: /^Add/ }))
			.toHaveCount(0)
	})
})

test.describe('adding and removing where the schema allows it', () => {
	test('an optional field can be added and removed again; a required one has no remove', async ({ page }) => {
		const editor = await openStructure(page, /guests : Numeric/)
		await expect(editor.getByRole('button', { name: 'Remove label' }))
			.toHaveCount(0)
		await expect(editor.getByRole('button', { name: 'Remove max' }))
			.toBeVisible()

		await editor.getByRole('button', { name: 'Remove max' })
			.click()
		await expect(field(editor, 'max'))
			.toHaveCount(0)
		expect(configOf(await documentSource(page), 'guests'))
			.not
			.toHaveProperty('max')

		// `max` is offered again among the optional fields; adding it starts from the schema's default.
		await editor.getByRole('combobox', { name: 'Optional field to add to config' })
			.selectOption('max')
		await editor.getByRole('button', { name: 'Add field' })
			.click()
		await expect(field(editor, 'max'))
			.toBeVisible()
		expect(configOf(await documentSource(page), 'guests').max)
			.toBe(0)
	})

	test('array items are added and removed, and the schema\'s minimum is kept', async ({ page }) => {
		const editor = await openStructure(page, /sessions : MultipleChoice/)
		const options = editor.locator('[role="group"][aria-label="options"]')
		const removers = options.getByRole('button', { name: /^Remove #\d+$/ })
		await expect(removers)
			.toHaveCount(3)

		await options.getByRole('button', { name: 'Remove #3' })
			.click()
		await expect(removers)
			.toHaveCount(2)
		expect((configOf(await documentSource(page), 'sessions').options as unknown[]))
			.toHaveLength(2)

		await options.getByRole('button', { name: 'Add item to options' })
			.click()
		await expect(removers)
			.toHaveCount(3)
		const added = (configOf(await documentSource(page), 'sessions').options as { value: string }[]).at(-1)
		expect(added)
			.toEqual({ value: '', label: {} })
		// The new option is an incomplete one, which Core reports instead of the editor hiding it.
		await expect(page.getByTestId('document-status'))
			.toHaveAttribute('data-state', 'problems')
	})

	test('free keys of a translation can be added by name and removed', async ({ page }) => {
		const editor = await openStructure(page, /guests : Numeric/)
		const label = editor.locator('[role="group"][aria-label="label"]')
		await label.getByRole('textbox', { name: 'Name of the key to add to label' })
			.fill('fr')
		await label.getByRole('button', { name: 'Add key' })
			.click()
		await expect(field(editor, 'label.fr'))
			.toBeVisible()
		expect(((configOf(await documentSource(page), 'guests').label) as Record<string, string>).fr)
			.toBe('')
		// A key that exists cannot be added a second time.
		await label.getByRole('textbox', { name: 'Name of the key to add to label' })
			.fill('fr')
		await expect(label.getByRole('button', { name: 'Add key' }))
			.toBeDisabled()
	})
})

test.describe('the Document stays the authority', () => {
	test('an edit over an unapplied JSON draft is refused and keeps the draft', async ({ page }) => {
		const editor = await openStructure(page, /guests : Numeric/)
		await page.evaluate(() => (window as unknown as LabTestWindow).__WIDGET_LAB_TEST__!.setDraftSourceText('{ "unapplied": true }'))
		await field(editor, 'integer')
			.getByRole('switch')
			.click()
		await expect(page.getByTestId('author-command-outcome'))
			.toHaveText('Apply or Revert the JSON draft before using Structure commands.')
		await openStatusDetails(page)
		await expect(page.getByTestId('status-document-revision'))
			.toHaveText('r0')
	})

	test('an edit that makes the Document invalid lists the problem and keeps the last working preview', async ({ page }) => {
		const editor = await openStructure(page, /guests : Numeric/)
		// `min` above `max` is a Core diagnostic, not something the editor judges.
		const min = field(editor, 'min')
			.getByRole('textbox')
		await min.fill('9')
		await min.press('Enter')
		await expect(page.getByTestId('author-command-outcome'))
			.toContainText('Author command applied')
		await expect(page.getByTestId('document-status'))
			.toHaveAttribute('data-state', 'problems')
		await expect(page.getByTestId('preview-status'))
			.toHaveAttribute('data-state', 'stale')
	})

	test('the controls and every new name are in the Lab language', async ({ page }) => {
		const editor = await openStructure(page, /guests : Numeric/, 'showcase=survey&lang=zh-TW', { author: '編寫', structure: '結構' })
		await expect(field(editor, 'integer')
			.getByRole('switch'))
			.toHaveAccessibleName('integer')
		await expect(editor.getByRole('button', { name: '移除 max' }))
			.toBeVisible()
		await expect(editor.getByRole('combobox', { name: '要加入 config 的選填欄位' }))
			.toBeVisible()
	})
})
