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

/**
 * Makes the JSON draft dirty and acts on `control` in the SAME task, before Vue renders the lock that a draft puts on the
 * editor (Lab UX phase 1: with a draft, Structure says so up front and its controls send nothing). The command therefore
 * reaches the session, which refuses it (`draft-dirty`): this is how the specs below reach the refused-commit handling, which
 * also serves patch errors and stale selections.
 */
async function actWithDraftAppearing(control: Locator, action: { click: true } | { choose: string } | { press: 'Enter' }): Promise<void> {
	await control.evaluate((element, act) => {
		(window as unknown as LabTestWindow).__WIDGET_LAB_TEST__!.setDraftSourceText('{ "unapplied": true }')
		if ('click' in act) {
			(element as HTMLElement).click()
		}
		else if ('choose' in act) {
			const select = element as HTMLSelectElement
			select.value = String([...select.options].findIndex(option => option.text === act.choose))
			select.dispatchEvent(new Event('change', { bubbles: true }))
		}
		else {
			element.dispatchEvent(new KeyboardEvent('keydown', { key: act.press, bubbles: true, cancelable: true }))
		}
	}, action)
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
			.toHaveText('Change applied. Use Undo to take it back.')
		await expect(page.getByTestId('author-command-outcome'))
			.toHaveAttribute('data-revision', '1')
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

	test('a number box applies on Enter, refuses what is not a number, and leaves limits to Core', async ({ page }) => {
		const editor = await openStructure(page, /phone : ShortAnswer/)
		const maxLength = field(editor, 'maxLength')
			.getByRole('textbox')
		for (const text of ['abc', '0x10', 'Infinity', '']) {
			await maxLength.fill(text)
			await maxLength.press('Enter')
			await expect(field(editor, 'maxLength')
				.getByRole('alert'))
				.toHaveText('Enter a number, such as 12 or 2.5.')
			await expect(page.getByTestId('author-command-outcome'))
				.toHaveCount(0)
		}

		await maxLength.fill('12')
		await maxLength.press('Enter')
		await expect(page.getByTestId('author-command-outcome'))
			.toContainText('Change applied')
		expect(configOf(await documentSource(page), 'phone').maxLength)
			.toBe(12)

		// `maxLength` is an integer of at least 1 in the schema. The editor does not judge that: the value goes to Core,
		// which reports it, so the schema and the compiler cannot disagree about what is allowed.
		await maxLength.fill('2.5')
		await maxLength.press('Enter')
		await expect(page.getByTestId('author-command-outcome'))
			.toContainText('Change applied')
		expect(configOf(await documentSource(page), 'phone').maxLength)
			.toBe(2.5)
		await expect(page.getByTestId('document-status'))
			.toHaveAttribute('data-state', 'problems')
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
		// The branch of the condition this value is (a leaf with an equality operator) offers its own operators; the
		// editor does not claim to list all the schema allows, and says where the other forms are edited.
		await expect(op.locator('option', { hasText: 'notEquals' }))
			.toHaveCount(1)
		await expect(field(editor, 'required')
			.getByTestId('union-hint')
			.first())
			.toHaveText('This value has other forms; the JSON view edits those.')

		await op.selectOption({ label: 'notEquals' })
		await expect(page.getByTestId('author-command-outcome'))
			.toContainText('Change applied')
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
			.toContainText('Change applied')
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
	test('with an unapplied JSON draft, Structure says so before anything is clicked and its controls send nothing (Lab UX phase 1)', async ({ page }) => {
		const editor = await openStructure(page, /guests : Numeric/)
		const notice = editor.getByTestId('structure-draft-notice')
		await expect(notice)
			.toHaveCount(0)
		await expect(editor.getByTestId('structure-fields'))
			.toHaveAttribute('data-locked', 'false')

		await page.evaluate(() => (window as unknown as LabTestWindow).__WIDGET_LAB_TEST__!.setDraftSourceText('{ "unapplied": true }'))
		await expect(notice)
			.toHaveText(/The JSON view has unapplied changes\. Apply or discard the JSON draft to edit here\./)
		await expect(notice)
			.toHaveAttribute('role', 'note')
		await expect(editor.getByTestId('structure-fields'))
			.toHaveAttribute('data-locked', 'true')
		const integer = field(editor, 'integer')
			.getByRole('switch')
		const min = field(editor, 'min')
			.getByRole('textbox')
		// Locked, not removed: the controls stay focusable and say they are unavailable.
		await expect(integer)
			.toHaveAttribute('aria-disabled', 'true')
		await expect(min)
			.toHaveAttribute('aria-disabled', 'true')
		await expect(field(editor, 'min')
			.getByRole('button', { name: 'Set value: min' }))
			.toHaveAttribute('aria-disabled', 'true')

		// Nothing is sent: no refusal after the fact, the switch keeps the Document's value, the Document stays at r0. (Playwright
		// treats `aria-disabled` as disabled, so the actions are forced, as a user's click or typing would be.)
		await integer.click({ force: true })
		await min.fill('3', { force: true })
		await min.press('Enter')
		await expect(integer)
			.toBeChecked()
		await expect(page.getByTestId('author-command-outcome'))
			.toHaveCount(0)
		await openStatusDetails(page)
		await expect(page.getByTestId('status-document-revision'))
			.toHaveText('r0')
		await page.keyboard.press('Escape')

		// The notice leads to the JSON view; discarding the draft unlocks Structure.
		await notice.getByRole('button', { name: 'Open the JSON view' })
			.click()
		await expect(page.getByRole('tab', { name: 'JSON', exact: true }))
			.toHaveAttribute('aria-selected', 'true')
		await page.getByTestId('revert-button')
			.click()
		await page.getByRole('tab', { name: 'Structure', exact: true })
			.click()
		await expect(editor.getByTestId('structure-draft-notice'))
			.toHaveCount(0)
		await expect(editor.getByTestId('structure-fields'))
			.toHaveAttribute('data-locked', 'false')
	})

	test('an edit sent as the JSON draft appears is refused and keeps the draft', async ({ page }) => {
		const editor = await openStructure(page, /guests : Numeric/)
		await actWithDraftAppearing(field(editor, 'integer')
			.getByRole('switch'), { click: true })
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
			.toContainText('Change applied')
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

test.describe('keyboard focus stays through a commit', () => {
	test('after a switch, a number, a list, an added field and a removed one', async ({ page }) => {
		const editor = await openStructure(page, /guests : Numeric/)
		const outcome = page.getByTestId('author-command-outcome')

		// A switch, with Space.
		const integer = field(editor, 'integer')
			.getByRole('switch')
		await integer.focus()
		await page.keyboard.press('Space')
		await expect(outcome)
			.toHaveAttribute('data-revision', '1')
		await expect(integer)
			.toBeFocused()

		// A number box, with Enter.
		const min = field(editor, 'min')
			.getByRole('textbox')
		await min.focus()
		await page.keyboard.press('Control+a')
		await page.keyboard.type('1')
		await page.keyboard.press('Enter')
		await expect(outcome)
			.toHaveAttribute('data-revision', '2')
		await expect(min)
			.toBeFocused()

		// A field is removed with Enter on its button: focus is still in the editor, on the control that took its place.
		await editor.getByRole('button', { name: 'Remove max' })
			.focus()
		await page.keyboard.press('Enter')
		await expect(outcome)
			.toHaveAttribute('data-revision', '3')
		await expect(field(editor, 'max'))
			.toHaveCount(0)
		await expect(editor.locator(':focus'))
			.toHaveCount(1)

		// A field is added from the list with Enter on its button: focus moves to the new field's control.
		await editor.getByRole('combobox', { name: 'Optional field to add to config' })
			.selectOption('max')
		await editor.getByRole('button', { name: 'Add field' })
			.focus()
		await page.keyboard.press('Enter')
		await expect(outcome)
			.toHaveAttribute('data-revision', '4')
		await expect(field(editor, 'max')
			.getByRole('textbox'))
			.toBeFocused()
	})

	test('after a choice from a list, and after an array item is added and removed', async ({ page }) => {
		const phone = await openStructure(page, /phone : ShortAnswer/)
		const op = field(phone, 'required.op')
			.getByRole('combobox')
		// (Arrow keys open the list on some platforms, so the choice itself is made through Playwright; the focus is the user's.)
		await op.focus()
		await op.selectOption({ label: 'notEquals' })
		await expect(page.getByTestId('author-command-outcome'))
			.toHaveAttribute('data-revision', '1')
		await expect(op.locator('option:checked'))
			.toHaveText('notEquals')
		await expect(op)
			.toBeFocused()

		await page.getByRole('button', { name: /sessions : MultipleChoice/ })
			.click()
		const options = page.getByTestId('structure-editor')
			.locator('[role="group"][aria-label="options"]')
		await options.getByRole('button', { name: 'Add item to options' })
			.focus()
		await page.keyboard.press('Enter')
		await expect(options.getByRole('button', { name: 'Remove #4' }))
			.toBeVisible()
		// The new item has the focus (its first control), not the page.
		await expect(page.getByTestId('structure-editor')
			.locator(':focus'))
			.toHaveCount(1)
		await options.getByRole('button', { name: 'Remove #4' })
			.focus()
		await page.keyboard.press('Enter')
		await expect(options.getByRole('button', { name: 'Remove #4' }))
			.toHaveCount(0)
		await expect(page.getByTestId('structure-editor')
			.locator(':focus'))
			.toHaveCount(1)
	})
})

test.describe('focus and triggers while a commit runs', () => {
	test('focus the user moved to another control while the commit ran stays there', async ({ page }) => {
		const editor = await openStructure(page, /guests : Numeric/)
		const integer = field(editor, 'integer')
			.getByRole('switch')
		// In one task: the switch is clicked (the commit starts and takes a while: the Preview is mounted again) and focus
		// goes to a header control. When the commit resolves it must not pull focus back into Structure.
		await integer.evaluate((element) => {
			(element as HTMLElement).click()
			;(document.querySelector('[data-testid="status-details"]') as HTMLElement).focus()
		})
		await expect(page.getByTestId('author-command-outcome'))
			.toHaveAttribute('data-revision', '1')
		await expect(page.getByTestId('status-details'))
			.toBeFocused()
		await expect(editor.locator(':focus'))
			.toHaveCount(0)
	})

	test('a second trigger in the same task is dropped without a message, a refusal or a second commit', async ({ page }) => {
		const editor = await openStructure(page, /guests : Numeric/)
		const integer = field(editor, 'integer')
			.getByRole('switch')
		await integer.evaluate((element) => {
			(element as HTMLElement).click()
			;(element as HTMLElement).click()
		})
		const outcome = page.getByTestId('author-command-outcome')
		await expect(outcome)
			.toHaveText('Change applied. Use Undo to take it back.')
		// One commit only: revision 1.
		await expect(outcome)
			.toHaveAttribute('data-revision', '1')
		await expect(integer)
			.not
			.toBeChecked()
		expect((configOf(await documentSource(page), 'guests')).integer)
			.toBe(false)
		// Nothing arrives later to overwrite the message (a queued second command would answer "unavailable").
		await expect(outcome)
			.not
			.toContainText('unavailable')
	})

	test('a free key with a backslash and a quote in its name is found again, and takes the focus', async ({ page }) => {
		const editor = await openStructure(page, /guests : Numeric/)
		const label = editor.locator('[role="group"][aria-label="label"]')
		await label.getByRole('textbox', { name: 'Name of the key to add to label' })
			.fill('a\\b"c')
		await label.getByRole('button', { name: 'Add key' })
			.click()
		await expect(page.getByTestId('author-command-outcome'))
			.toHaveAttribute('data-revision', '1')
		await expect.poll(() => page.evaluate(() => (document.activeElement?.closest('[data-config-path]') as HTMLElement | null)?.dataset.configPath))
			.toBe('label.a\\b"c')
	})
})

test.describe('a commit that is refused: switches and lists show the Document, typed text and add choices are kept', () => {
	// The draft appears in the same task as the edit (`actWithDraftAppearing`): with a draft already there, Structure is
	// locked and sends nothing, so this is how a refusal is reached from the page.
	test('a list and a switch snap back when the JSON draft is dirty', async ({ page }) => {
		const editor = await openStructure(page, /phone : ShortAnswer/)

		const op = field(editor, 'required.op')
			.getByRole('combobox')
		await actWithDraftAppearing(op, { choose: 'notEquals' })
		await expect(page.getByTestId('author-command-outcome'))
			.toHaveText('Apply or Revert the JSON draft before using Structure commands.')
		await expect(op.locator('option:checked'))
			.toHaveText('equals')
		expect((configOf(await documentSource(page), 'phone').required as { op: string }).op)
			.toBe('equals')

		// Discard that draft, so the next edit is again one sent as a draft appears.
		await page.getByTestId('revert-button')
			.click()
		await page.getByRole('button', { name: /guests : Numeric/ })
			.click()
		const integer = field(editor, 'integer')
			.getByRole('switch')
		await expect(integer)
			.toBeChecked()
		await integer.focus()
		await actWithDraftAppearing(integer, { click: true })
		await expect(page.getByTestId('author-command-outcome'))
			.toHaveText('Apply or Revert the JSON draft before using Structure commands.')
		await expect(integer)
			.toBeChecked()
		await expect(integer)
			.toBeFocused()
	})

	test('a refused text keeps what was typed and says why; another field keeps its text; the Document value comes back on request', async ({ page }) => {
		const editor = await openStructure(page, /guests : Numeric/)
		const max = field(editor, 'max')
			.getByRole('textbox')
		await max.fill('42')
		const min = field(editor, 'min')
			.getByRole('textbox')
		await min.fill('7')
		await actWithDraftAppearing(min, { press: 'Enter' })
		await expect(page.getByTestId('author-command-outcome'))
			.toHaveText('Apply or Revert the JSON draft before using Structure commands.')
		// Nothing typed is lost: the refused box keeps its input and says it was not applied.
		await expect(min)
			.toHaveValue('7')
		await expect(field(editor, 'min')
			.getByTestId('not-applied'))
			.toContainText('Not applied: Apply or Revert the JSON draft before using Structure commands.')
		await expect(max)
			.toHaveValue('42')
		await expect(field(editor, 'max')
			.getByTestId('not-applied'))
			.toHaveCount(0)
		expect(configOf(await documentSource(page), 'guests').min)
			.toBe(0)

		await field(editor, 'min')
			.getByRole('button', { name: 'Use the Document value: min' })
			.click()
		await expect(min)
			.toHaveValue('0')
		await expect(field(editor, 'min')
			.getByTestId('not-applied'))
			.toHaveCount(0)
	})

	test('a refused text belongs to its widget: selecting another widget shows that widget\'s value and no note', async ({ page }) => {
		const editor = await openStructure(page, /guests : Numeric/)
		const min = field(editor, 'min')
			.getByRole('textbox')
		await min.fill('7')
		await actWithDraftAppearing(min, { press: 'Enter' })
		await expect(field(editor, 'min')
			.getByTestId('not-applied'))
			.toBeVisible()

		await page.getByRole('button', { name: /phone : ShortAnswer/ })
			.click()
		await expect(editor.getByTestId('not-applied'))
			.toHaveCount(0)
		await page.getByRole('button', { name: /guests : Numeric/ })
			.click()
		await expect(field(editor, 'min')
			.getByRole('textbox'))
			.toHaveValue('0')
		await expect(editor.getByTestId('not-applied'))
			.toHaveCount(0)
	})

	test('a refused add keeps the field that was chosen', async ({ page }) => {
		const editor = await openStructure(page, /guests : Numeric/)
		await editor.getByRole('button', { name: 'Remove max' })
			.click()
		await expect(field(editor, 'max'))
			.toHaveCount(0)
		const optional = editor.getByRole('combobox', { name: 'Optional field to add to config' })
		await optional.selectOption('max')
		await actWithDraftAppearing(editor.getByRole('button', { name: 'Add field' }), { click: true })
		await expect(page.getByTestId('author-command-outcome'))
			.toHaveText('Apply or Revert the JSON draft before using Structure commands.')
		await expect(optional)
			.toHaveValue('max')
		await expect(field(editor, 'max'))
			.toHaveCount(0)
	})
})

test.describe('a config that is not an object, or is missing', () => {
	async function applyDraft(page: Page, source: unknown): Promise<void> {
		await page.evaluate(text => (window as unknown as LabTestWindow).__WIDGET_LAB_TEST__!.setDraftSourceText(text), JSON.stringify(source))
		await page.getByRole('button', { name: 'Apply', exact: true })
			.click()
		await expect(page.getByTestId('document-status'))
			.toBeVisible()
	}
	const openRoot = async (page: Page): Promise<Locator> => {
		await page.getByRole('tab', { name: 'Author', exact: true })
			.click()
		await page.getByRole('tab', { name: 'Structure', exact: true })
			.click()
		const editor = page.getByTestId('structure-editor')
		await expect(editor)
			.toBeVisible()
		return editor
	}

	for (const [label, config] of [['a string', 'x'], ['a list', []], ['a number', 7]] as const) {
		test(`${label} is edited whole, as JSON, and replaced by an object`, async ({ page }) => {
			await page.goto('/?lab-test&showcase=sandbox')
			await applyDraft(page, { id: 'root', type: 'Text', config })
			const editor = await openRoot(page)
			const box = field(editor, '')
				.getByRole('textbox')
			await expect(box)
				.toHaveValue(JSON.stringify(config))
			await box.fill('{ "text": "fixed" }')
			await field(editor, '')
				.getByRole('button', { name: /Set value/ })
				.click()
			await expect(page.getByTestId('author-command-outcome'))
				.toContainText('Change applied')
			expect(JSON.parse(await page.evaluate(() => (window as unknown as LabTestWindow).__WIDGET_LAB_TEST__!.getDocumentSourceText())).config)
				.toEqual({ text: 'fixed' })
			await expect(page.getByTestId('document-status'))
				.toHaveAttribute('data-state', 'valid')
			await expect(field(editor, 'text'))
				.toBeVisible()
		})
	}

	test('a config of null is shown as an empty object and the first optional field creates it', async ({ page }) => {
		await page.goto('/?lab-test&showcase=survey')
		await applyDraft(page, { id: 'open-day', type: 'Survey', config: null })
		const editor = await openRoot(page)
		await expect(editor)
			.toContainText('Nothing set yet.')
		await editor.getByRole('combobox', { name: 'Optional field to add to config' })
			.selectOption('languages')
		await editor.getByRole('button', { name: 'Add field' })
			.click()
		await expect(page.getByTestId('author-command-outcome'))
			.toContainText('Change applied')
		expect(JSON.parse(await page.evaluate(() => (window as unknown as LabTestWindow).__WIDGET_LAB_TEST__!.getDocumentSourceText())).config)
			.toEqual({ languages: ['en'] })
	})

	test('a widget without a config gets one from its first field, and a refused edit says what is wrong', async ({ page }) => {
		await page.goto('/?lab-test&showcase=survey')
		await applyDraft(page, { id: 'open-day', type: 'Survey' })
		const editor = await openRoot(page)
		await editor.getByRole('combobox', { name: 'Optional field to add to config' })
			.selectOption('title')
		await editor.getByRole('button', { name: 'Add field' })
			.click()
		await expect(page.getByTestId('author-command-outcome'))
			.toContainText('Change applied')
		await expect(field(editor, 'title'))
			.toBeVisible()
	})
})
