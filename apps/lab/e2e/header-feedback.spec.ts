import type { Page } from '@playwright/test'
import { answerDraftGuard, expect, expectDocumentStatus, expectPreviewStatus, expectShowcase, loadPreset, openStatusDetails, previewFrame, selectShowcase, setLocale, test } from './fixtures'

/**
 * Issue #230 PR 3a (audit U01-U07, U24): the grouped header, unapplied-draft protection, Undo last change,
 * Cmd/Ctrl+Enter, the plain-language status chips, the Problems list with jump + squiggles, and the
 * stale-preview notice. The draft is dirtied through the `?lab-test` seam (`src/lab-test-seam.ts`) except where
 * the point is the real Monaco editor.
 */

interface LabTestWindow {
	__WIDGET_LAB_TEST__?: { setDraftSourceText: (text: string) => void }
}

async function openLab(page: Page, query: string): Promise<void> {
	await page.goto(`/?lab-test&${query}`)
	await page.waitForFunction(() => typeof (window as unknown as LabTestWindow).__WIDGET_LAB_TEST__?.setDraftSourceText === 'function')
	// Monaco is imported lazily; interact with it only once it is up.
	await expect(page.getByTestId('json-editor')
		.locator('.monaco-editor'))
		.toBeVisible()
}

async function setDraft(page: Page, text: string): Promise<void> {
	await page.evaluate((source) => {
		(window as unknown as LabTestWindow).__WIDGET_LAB_TEST__?.setDraftSourceText(source)
	}, text)
}

const textDocument = (text: string): string => JSON.stringify({ id: 'root', type: 'Text', config: { text } }, null, 2)

/**
 * Edits the real Monaco editor: double-clicks the word inside the root widget's `"root"` id string (a short
 * token at the far left of line 2, so always on screen) and replaces it. Typing inside a JSON string means no
 * bracket or quote is typed, so Monaco's auto-closing cannot damage the document; whole-document insertion is
 * deliberately not used because Monaco re-indents and auto-closes inserted text.
 */
async function renameRootIdInMonaco(page: Page, replacement: string): Promise<void> {
	const token = page.getByTestId('json-editor')
		.locator('.view-line span')
		.filter({ hasText: /^"root"$/ })
		.first()
	const box = (await token.boundingBox())!
	await page.mouse.dblclick(box.x + box.width / 2, box.y + box.height / 2)
	await expect(page.getByTestId('json-editor')
		.locator('.monaco-editor'))
		.toHaveClass(/focused/)
	await page.keyboard.insertText(replacement)
}

test.describe('header layout (U01)', () => {
	for (const [width, height] of [[1280, 800], [1440, 900], [1920, 1080]] as const) {
		test(`stays on one row at ${width}x${height} with every group reachable`, async ({ page }) => {
			await page.setViewportSize({ width, height })
			await openLab(page, 'showcase=survey')

			const header = page.locator('header')
			await expect(page.getByTestId('document-status'))
				.toBeVisible()
			const boxes = await Promise.all(['examples-menu', 'document-status', 'preview-status', 'apply-button', 'revert-button', 'undo-button', 'format-button', 'overflow-menu']
				.map(async id => ({ id, box: (await page.getByTestId(id)
					.boundingBox())! })))
			const headerBox = (await header.boundingBox())!
			expect(headerBox.height, 'one row')
				.toBeLessThan(56)
			for (const { id, box } of boxes) {
				expect(box.y, id)
					.toBeGreaterThanOrEqual(headerBox.y)
				expect(box.y + box.height, id)
					.toBeLessThanOrEqual(headerBox.y + headerBox.height + 1)
				expect(box.x + box.width, `${id} inside the viewport`)
					.toBeLessThanOrEqual(width)
				expect(box.height, `${id} target height`)
					.toBeGreaterThanOrEqual(24)
			}
			expect(await header.evaluate(element => element.scrollWidth <= element.clientWidth))
				.toBe(true)
		})
	}

	test('the overflow menu holds Tutorial, Theme, Language and a Developer submenu with Implementation and Document Tools', async ({ page }) => {
		await openLab(page, 'showcase=survey')
		await page.getByTestId('overflow-menu')
			.click()
		const menu = page.locator('[role="menu"][data-state="open"]')
		for (const name of ['Tutorial', 'Theme', 'Lab language', 'Developer']) {
			await expect(menu.getByRole('menuitem', { name, exact: true }))
				.toBeVisible()
		}

		await menu.getByRole('menuitem', { name: 'Developer', exact: true })
			.click()
		await expect(page.getByRole('menuitem', { name: 'Implementation', exact: true }))
			.toBeVisible()
		await expect(page.getByRole('menuitem', { name: 'Document Tools', exact: true }))
			.toBeVisible()
		// None of the developer entries is a header button any more.
		await page.keyboard.press('Escape')
		await page.keyboard.press('Escape')
		await expect(page.locator('header')
			.getByRole('button', { name: 'Document Tools' }))
			.toHaveCount(0)
	})

	test('the menus are keyboard operable and return focus to their trigger', async ({ page }) => {
		await openLab(page, 'showcase=survey')
		await page.getByTestId('overflow-menu')
			.focus()
		await page.keyboard.press('Enter')
		await expect(page.getByTestId('overflow-menu'))
			.toHaveAttribute('aria-expanded', 'true')
		// Opened from the keyboard: the first item has focus, arrows move on.
		await expect(page.getByRole('menuitem', { name: 'Tutorial', exact: true }))
			.toBeFocused()
		await page.keyboard.press('ArrowDown')
		await expect(page.getByRole('menuitem', { name: 'Theme', exact: true }))
			.toBeFocused()
		await page.keyboard.press('Escape')
		await expect(page.getByTestId('overflow-menu'))
			.toHaveAttribute('aria-expanded', 'false')
		await expect(page.getByTestId('overflow-menu'))
			.toBeFocused()
	})
})

test.describe('menu focus handling', () => {
	test('clicking into the editor while a menu is open closes it and leaves focus (and typing) in the editor', async ({ page }) => {
		await openLab(page, 'showcase=sandbox')
		const trigger = page.getByTestId('examples-menu')
		await trigger.click()
		await expect(trigger)
			.toHaveAttribute('aria-expanded', 'true')

		// Click on a line of the editor that is below the open menu (the menu covers the top lines, and grows with every
		// showcase the Examples menu lists, so the line is found from the menu's own bottom edge), and type.
		const editor = page.getByTestId('json-editor')
		const menuBox = (await page.getByRole('menu')
			.boundingBox())!
		const lines = await editor.locator('.view-line')
			.evaluateAll(elements => elements.map((element) => {
				const box = element.getBoundingClientRect()
				return { x: box.x, y: box.y, height: box.height }
			}))
		const line = lines.filter(candidate => candidate.y > menuBox.y + menuBox.height + 8)
			.at(0)!
		expect(line, 'a line of the editor below the open menu')
			.toBeDefined()
		await page.mouse.click(line.x + 60, line.y + line.height / 2)
		await expect(trigger)
			.toHaveAttribute('aria-expanded', 'false')
		await expect(editor.locator('.monaco-editor'))
			.toHaveClass(/focused/)
		// The menu's own close handling runs when its exit animation ends: a regression (refocusing the menu
		// button) only shows after that, so wait for exactly that: the closed menu's content leaving the DOM.
		await expect(page.getByRole('menu'))
			.toHaveCount(0)
		await expect(editor.locator('.monaco-editor'))
			.toHaveClass(/focused/)
		await page.keyboard.insertText('typed while the menu was open')

		// The typing landed in the editor (the draft is dirty) and focus did not jump back to the menu button.
		await expect(page.getByTestId('apply-button'))
			.toHaveAttribute('aria-disabled', 'false')
		await expect(trigger)
			.not
			.toBeFocused()
		await expect(page.locator('.view-lines'))
			.toContainText('typed while the menu was open')
	})

	test('opening the other header menu while one is open switches to it instead of closing both', async ({ page }) => {
		await openLab(page, 'showcase=sandbox')
		const examples = page.getByTestId('examples-menu')
		const overflow = page.getByTestId('overflow-menu')
		await examples.click()
		// Let the first menu finish opening (the bug needed a settled menu), then switch.
		await expect(page.getByRole('menuitemcheckbox', { name: 'Valid — interactive' }))
			.toBeVisible()

		await overflow.click()

		await expect(overflow)
			.toHaveAttribute('aria-expanded', 'true')
		await expect(examples)
			.toHaveAttribute('aria-expanded', 'false')
		await expect(page.getByRole('menuitem', { name: 'Tutorial', exact: true }))
			.toBeVisible()
		// The first menu's close must not take focus back from the second and close it too: its close handling runs
		// when its exit animation ends, i.e. when its content leaves the DOM (only the second menu is left).
		await expect(page.getByRole('menu'))
			.toHaveCount(1)
		await expect(overflow)
			.toHaveAttribute('aria-expanded', 'true')
		await expect(page.getByRole('menuitem', { name: 'Tutorial', exact: true }))
			.toBeVisible()

		// And back the other way.
		await examples.click()
		await expect(page.getByRole('menuitemcheckbox', { name: 'Valid — interactive' }))
			.toBeVisible()
		await expect(page.getByRole('menu'))
			.toHaveCount(1)
		await expect(examples)
			.toHaveAttribute('aria-expanded', 'true')
		await expect(overflow)
			.toHaveAttribute('aria-expanded', 'false')
	})

	test('Escape and choosing an item still return focus to the trigger', async ({ page }) => {
		await openLab(page, 'showcase=sandbox')
		const examples = page.getByTestId('examples-menu')
		await examples.click()
		await page.keyboard.press('Escape')
		await expect(examples)
			.toHaveAttribute('aria-expanded', 'false')
		await expect(examples)
			.toBeFocused()

		await examples.click()
		await page.getByRole('menuitemcheckbox', { name: 'Valid — interactive' })
			.click()
		await expect(examples)
			.toHaveAttribute('aria-expanded', 'false')
		await expect(examples)
			.toBeFocused()
	})
})

test.describe('Examples menu and the showcase URL (U01, U03)', () => {
	test('always names the showcase and the last loaded preset, and says edited once the document changes', async ({ page }) => {
		await openLab(page, 'showcase=survey')
		const trigger = page.getByTestId('examples-menu')
		await expect(page.getByTestId('examples-showcase'))
			.toHaveText('Interactive Survey')
		await expect(page.getByTestId('examples-preset'))
			.toContainText('Default — open day sign-up')
		await expect(trigger)
			.toHaveAttribute('data-preset-id', 'survey-default')

		await loadPreset(page, 'survey-ai-draft')
		await expect(page.getByTestId('examples-preset'))
			.toContainText('AI draft — five mistakes')
		await trigger.click()
		await expect(page.getByRole('menuitemcheckbox', { name: 'AI draft — five mistakes' }))
			.toHaveAttribute('aria-checked', 'true')
		await page.keyboard.press('Escape')

		// Any applied change makes it "edited"; an unapplied edit does too.
		await setDraft(page, '{ "id": "x", "type": "Survey" }')
		await expect(page.getByTestId('examples-preset'))
			.toContainText('edited')
		await expect(page.getByTestId('examples-preset'))
			.toHaveAttribute('data-example-kind', 'edited')
		await page.getByRole('button', { name: 'Apply', exact: true })
			.click()
		await expect(page.getByTestId('examples-preset'))
			.toHaveAttribute('data-example-kind', 'edited')
	})

	test('keeps ?showcase= in step with the active showcase and a reload restores it, hidden fixtures included', async ({ page }) => {
		await openLab(page, 'showcase=sandbox')
		await expectShowcase(page, 'sandbox')
		await expect(page.getByTestId('examples-showcase'))
			.toHaveText('Sandbox')

		await selectShowcase(page, 'survey')
		await expectShowcase(page, 'survey')
		await expect(page.getByTestId('examples-showcase'))
			.toHaveText('Interactive Survey')
		expect(page.url())
			.toContain('lab-test')

		await page.reload()
		await expectShowcase(page, 'survey')
		await expect(previewFrame(page)
			.getByRole('heading', { name: 'Maker Space open day: sign-up' }))
			.toBeVisible()
	})
})

test.describe('unapplied draft protection (U03)', () => {
	test('loading a preset over an unapplied draft asks first: Keep editing preserves it, Discard loads the preset', async ({ page }) => {
		await openLab(page, 'showcase=sandbox')
		await setDraft(page, textDocument('my unapplied edit'))
		await expect(page.locator('.view-lines'))
			.toContainText('my unapplied edit')

		await page.getByTestId('examples-menu')
			.click()
		await page.getByRole('menuitemcheckbox', { name: 'Invalid — semantic' })
			.click()
		const dialog = page.getByRole('alertdialog')
		await expect(dialog)
			.toBeVisible()
		await expect(dialog)
			.toContainText('Loading “Invalid — semantic” will discard them.')
		// The safe choice has the initial focus.
		await expect(page.getByTestId('draft-guard-keep'))
			.toBeFocused()

		await answerDraftGuard(page, 'keep')
		await expect(page.locator('.view-lines'))
			.toContainText('my unapplied edit')
		await expectDocumentStatus(page, { valid: true })
		await expect(page.getByTestId('examples-menu'))
			.toBeFocused()

		// Escape is Keep editing as well.
		await page.getByTestId('examples-menu')
			.click()
		await page.getByRole('menuitemcheckbox', { name: 'Invalid — semantic' })
			.click()
		await expect(dialog)
			.toBeVisible()
		await page.keyboard.press('Escape')
		await expect(dialog)
			.toHaveCount(0)
		await expect(page.locator('.view-lines'))
			.toContainText('my unapplied edit')

		await loadPreset(page, 'invalid-semantic', { discardDraft: true })
		await expectDocumentStatus(page, { problems: 1 })
		await expect(page.locator('.view-lines'))
			.not
			.toContainText('my unapplied edit')
		await expect(page.getByTestId('examples-menu'))
			.toHaveAttribute('data-preset-id', 'invalid-semantic')
	})

	test('switching showcase over an unapplied draft asks first, and a clean draft switches without asking', async ({ page }) => {
		await openLab(page, 'showcase=sandbox')
		await setDraft(page, textDocument('my unapplied edit'))

		await selectShowcase(page, 'survey')
		await expect(page.getByRole('alertdialog'))
			.toBeVisible()
		await answerDraftGuard(page, 'keep')
		await expectShowcase(page, 'sandbox')
		await expect(page.locator('.view-lines'))
			.toContainText('my unapplied edit')

		await selectShowcase(page, 'survey', { discardDraft: true })
		await expectShowcase(page, 'survey')
		await expect(previewFrame(page)
			.getByRole('heading', { name: 'Maker Space open day: sign-up' }))
			.toBeVisible()

		// No draft now: switching back asks nothing.
		await page.getByTestId('examples-menu')
			.click()
		await page.getByRole('menuitemcheckbox', { name: 'Interactive Survey' })
			.click()
		await expect(page.getByRole('alertdialog'))
			.toHaveCount(0)
	})
})

test.describe('Undo last change (U04)', () => {
	test('restores the previously applied source as a new revision and explains its disabled states', async ({ page }) => {
		await openLab(page, 'showcase=sandbox')
		const undo = page.getByTestId('undo-button')
		const revert = page.getByTestId('revert-button')
		const apply = page.getByTestId('apply-button')

		// The visible text is "Undo"; the accessible name says what it does, and does not collide with Apply's name.
		await expect(page.getByRole('button', { name: 'Undo last change', exact: true }))
			.toBeVisible()
		await expect(page.getByRole('button', { name: 'Apply', exact: true }))
			.toHaveCount(1)
		await expect(undo)
			.toHaveText('Undo')

		// Nothing applied yet: disabled, and the tooltip says why (the button stays focusable).
		await expect(undo)
			.toHaveAttribute('aria-disabled', 'true')
		await undo.focus()
		await expect(page.getByRole('tooltip', { name: 'Nothing to undo yet' }))
			.toBeAttached()
		await expect(revert)
			.toHaveAttribute('aria-disabled', 'true')

		await setDraft(page, textDocument('second version'))
		await expect(revert)
			.toHaveAttribute('aria-disabled', 'false')
		await apply.click()
		await expect(previewFrame(page)
			.getByText('second version', { exact: true }))
			.toBeVisible()
		// Revert only discards the unapplied draft: nothing to revert after Apply, Undo is available.
		await expect(revert)
			.toHaveAttribute('aria-disabled', 'true')
		await expect(undo)
			.toHaveAttribute('aria-disabled', 'false')

		// An unapplied draft makes Undo unavailable (it would silently discard typing) and says so.
		await setDraft(page, textDocument('typing in progress'))
		await expect(undo)
			.toHaveAttribute('aria-disabled', 'true')
		// The tooltip opens for keyboard focus only (Reka's `ignoreNonKeyboardFocus`), and a script `focus()` counts as
		// keyboard focus only when the user's last input was a key (Chromium's :focus-visible heuristic), but the last
		// input here was the mouse click on Apply: press a key first. (Nothing waits for other tooltips to go away: a
		// closed tooltip unmounts at once, see `nuxt-ui.ts`, and `e2e/tooltips.spec.ts` pins real Tab navigation.)
		await page.keyboard.press('Escape')
		await undo.focus()
		await expect(page.getByRole('tooltip', { name: 'Apply or revert your unapplied edits before undoing' }))
			.toBeAttached()
		// Activating it anyway does nothing (the button stays focusable, so the click is forced through).
		await undo.click({ force: true })
		await expect(page.locator('.view-lines'))
			.toContainText('typing in progress')
		await revert.click()

		await undo.click()
		await expect(previewFrame(page)
			.getByText('Widget Lab sandbox', { exact: true }))
			.toBeVisible()
		await expect(page.locator('.view-lines'))
			.toContainText('Widget Lab sandbox')
		await expect(undo)
			.toHaveAttribute('aria-disabled', 'true')
		// A new Document revision (r2), not a rewind to r0, and the Preview follows it.
		await page.getByTestId('status-details')
			.click()
		await expect(page.getByTestId('status-document-revision'))
			.toHaveText('r2')
		await expect(page.getByTestId('status-preview-revision'))
			.toHaveText('r2')
		await expect(page.getByTestId('revision-link-status'))
			.toHaveText('Linked / Synced')
	})

	test('undoes a bad apply: the previous working document and a valid status come back', async ({ page }) => {
		await openLab(page, 'showcase=sandbox')
		await loadPreset(page, 'invalid-semantic')
		await expectDocumentStatus(page, { problems: 1 })
		await expectPreviewStatus(page, 'stale')

		await page.getByTestId('undo-button')
			.click()
		await expectDocumentStatus(page, { valid: true })
		await expectPreviewStatus(page, 'current')
		await expect(page.getByTestId('examples-menu'))
			.toHaveAttribute('data-preset-id', 'valid-interactive')
	})
})

test.describe('Apply shortcut (U05)', () => {
	test('Cmd/Ctrl+Enter inside the Monaco editor applies instead of inserting a line', async ({ page }) => {
		await openLab(page, 'showcase=sandbox')
		const lines = page.locator('.view-lines .view-line')
		await expect(lines.first())
			.toBeVisible()
		const lineCount = await lines.count()
		await renameRootIdInMonaco(page, 'renamed')
		await expect(page.getByTestId('apply-button'))
			.toHaveAttribute('aria-disabled', 'false')
		await expect(page.locator('.view-lines'))
			.toContainText('"id": "renamed"')

		// Playwright's Desktop Chrome user agent is a Windows one, so Monaco's CtrlCmd is Control here whatever the
		// host OS is (`ControlOrMeta` would press Meta on a Mac host).
		await page.keyboard.press('Control+Enter')

		await expect(page.getByTestId('apply-button'))
			.toHaveAttribute('aria-disabled', 'true')
		await expectDocumentStatus(page, { valid: true })
		await page.getByTestId('status-details')
			.click()
		await expect(page.getByTestId('status-document-revision'))
			.toHaveText('r1')
		await expect(page.getByTestId('status-preview-revision'))
			.toHaveText('r1')
		// No line was inserted by the editor's own Cmd+Enter binding.
		await expect(lines)
			.toHaveCount(lineCount)
	})

	test('Cmd/Ctrl+Enter applies from a focused Dockview tab, where Enter was already claimed by the tab', async ({ page }) => {
		await openLab(page, 'showcase=sandbox')
		await setDraft(page, textDocument('applied from a tab'))
		await page.getByRole('tab', { name: 'Runtime' })
			.focus()

		await page.keyboard.press('ControlOrMeta+Enter')

		await expect(previewFrame(page)
			.getByText('applied from a tab', { exact: true }))
			.toBeVisible()
	})

	test('the Apply tooltip shows the shortcut', async ({ page }) => {
		await openLab(page, 'showcase=sandbox')
		await setDraft(page, textDocument('tooltip check'))
		await page.getByTestId('apply-button')
			.hover()
		await expect(page.getByRole('tooltip', { name: /Apply your edits to the document and preview/ }))
			.toBeAttached()
		// The shortcut is shown as two key caps (Cmd/Ctrl, Enter), not just described in words.
		await expect(page.locator('[data-slot="kbds"] kbd'))
			.toHaveCount(2)
		await expect(page.locator('[data-slot="kbds"]'))
			.toContainText('↵')
	})
})

test.describe('status chips and details (U02)', () => {
	test('two plain-language chips; revisions and linkage live in the details popover', async ({ page }) => {
		await openLab(page, 'showcase=survey')
		await expect(page.locator('header [data-testid$="-status"]'))
			.toHaveCount(2)
		await expect(page.getByTestId('document-status'))
			.toHaveText('Valid')
		await expect(page.getByTestId('preview-status'))
			.toHaveText('Preview up to date')
		await expect(page.locator('header'))
			.not
			.toContainText('Blueprint')
		await expect(page.locator('header'))
			.not
			.toContainText('Linked')

		await loadPreset(page, 'survey-ai-draft')
		await expect(page.getByTestId('document-status'))
			.toHaveText('5 problems')
		await expect(page.getByTestId('preview-status'))
			.toHaveText('Preview shows the last valid version')

		await page.getByTestId('status-details')
			.click()
		const details = page.getByTestId('status-details-panel')
		await expect(details)
			.toContainText('invalid · 5 diagnostics')
		await expect(page.getByTestId('status-document-revision'))
			.toHaveText('r1')
		await expect(page.getByTestId('status-preview-revision'))
			.toHaveText('r0')
		await expect(page.getByTestId('revision-link-status'))
			.toHaveText('Diverged / Unlinked')
	})

	test('an unapplied draft is named, and the Preview chip stops calling itself up to date until Apply or Revert', async ({ page }) => {
		await openLab(page, 'showcase=sandbox')
		const draftChip = page.getByTestId('draft-status')
		const previewChip = page.getByTestId('preview-status')
		await expect(draftChip)
			.toHaveCount(0)
		await expect(previewChip)
			.toHaveText('Preview up to date')

		await setDraft(page, textDocument('typing in progress'))
		await expect(draftChip)
			.toHaveText('Unapplied changes')
		await expect(draftChip)
			.toHaveAttribute('role', 'status')
		await expect(previewChip)
			.toHaveText('Preview shows the last applied version')
		// The Preview still shows the committed Document: the state is a fact about it and does not change while typing.
		await expect(previewChip)
			.toHaveAttribute('data-state', 'current')
		await expect(previewChip)
			.toHaveAttribute('data-behind-draft', 'true')

		await page.getByTestId('revert-button')
			.click()
		await expect(draftChip)
			.toHaveCount(0)
		await expect(previewChip)
			.toHaveText('Preview up to date')

		await setDraft(page, textDocument('applied now'))
		await expect(draftChip)
			.toBeVisible()
		await page.getByTestId('apply-button')
			.click()
		await expect(previewFrame(page)
			.getByText('applied now', { exact: true }))
			.toBeVisible()
		await expect(draftChip)
			.toHaveCount(0)
		await expect(previewChip)
			.toHaveText('Preview up to date')
		await expect(previewChip)
			.toHaveAttribute('data-behind-draft', 'false')
	})

	for (const lang of ['en', 'zh-TW'] as const) {
		test(`with the draft chip shown the header stays on one row at 1280x800 (${lang})`, async ({ page }) => {
			await page.setViewportSize({ width: 1280, height: 800 })
			await openLab(page, `showcase=survey&lang=${lang}`)
			await setDraft(page, '{ "id": "x", "type": "Survey" }')
			await expect(page.getByTestId('draft-status'))
				.toBeVisible()
			const header = page.locator('header')
			const headerBox = (await header.boundingBox())!
			expect(headerBox.height, 'one row')
				.toBeLessThan(56)
			for (const id of ['examples-menu', 'document-status', 'draft-status', 'preview-status', 'apply-button', 'overflow-menu']) {
				const box = (await page.getByTestId(id)
					.boundingBox())!
				expect(box.y + box.height, id)
					.toBeLessThanOrEqual(headerBox.y + headerBox.height + 1)
				expect(box.x + box.width, `${id} inside the viewport`)
					.toBeLessThanOrEqual(1280)
			}
			expect(await header.evaluate(element => element.scrollWidth <= element.clientWidth))
				.toBe(true)
		})
	}

	test('the problems chip is a named button that opens the Problems list', async ({ page }) => {
		await openLab(page, 'showcase=survey')
		// A valid Document has nothing to show: the chip is a status, not a button.
		await expect(page.locator('header')
			.getByRole('button', { name: /show them in the JSON view/ }))
			.toHaveCount(0)
		await expect(page.getByTestId('document-status'))
			.toHaveAttribute('role', 'status')

		await loadPreset(page, 'survey-ai-draft')
		await page.getByRole('tab', { name: 'Runtime' })
			.click()
		const chip = page.getByRole('button', { name: '5 problems: show them in the JSON view', exact: true })
		await expect(chip)
			.toHaveText('5 problems')
		await chip.click()
		await expect(page.getByRole('tab', { name: 'Author' }))
			.toHaveAttribute('aria-selected', 'true')
		await expect(page.getByRole('tab', { name: 'JSON' }))
			.toHaveAttribute('aria-selected', 'true')
		await expect(page.getByTestId('author-problems')
			.getByTestId('problem-row')
			.first())
			.toBeFocused()

		// From the keyboard too.
		await page.getByRole('tab', { name: 'Structure' })
			.click()
		await chip.focus()
		await page.keyboard.press('Enter')
		await expect(page.getByRole('tab', { name: 'JSON' }))
			.toHaveAttribute('aria-selected', 'true')
		await expect(page.getByTestId('author-problems')
			.getByTestId('problem-row')
			.first())
			.toBeFocused()
	})
})

test.describe('Problems list, jump and squiggles (U06)', () => {
	test('lists the last Apply\'s diagnostics under the editor, with code and message verbatim', async ({ page }) => {
		await openLab(page, 'showcase=survey')
		await loadPreset(page, 'survey-ai-draft')

		const problems = page.getByTestId('author-problems')
		await expect(problems)
			.toHaveAttribute('data-problem-count', '5')
		await expect(problems.getByTestId('author-problems-summary'))
			.toHaveText('5 problems')
		const rows = problems.getByTestId('problem-row')
		await expect(rows)
			.toHaveCount(5)
		await expect(rows.first())
			.toContainText('invalid-widget-config')
		await expect(rows.first())
			.toContainText('options: must contain at least one option.')
		await expect(rows.first())
			.toContainText('widget "mode : SingleChoice"')
		await expect(rows.nth(1))
			.toContainText('unknown-widget-type')
		await expect(rows.nth(1))
			.toContainText('Unknown plugin type "StarRating".')
	})

	test('jump to location selects the source range in the editor, in the current text', async ({ page }) => {
		await openLab(page, 'showcase=survey')
		await loadPreset(page, 'survey-ai-draft')
		const rows = page.getByTestId('author-problems')
			.getByTestId('problem-row')

		await rows.first()
			.click()
		const editor = page.getByTestId('json-editor')
		await expect(editor.locator('.monaco-editor'))
			.toHaveClass(/focused/)
		const selected = editor.locator('.selected-text')
			.first()
		await expect(selected)
			.toBeVisible()
		const line = editor.locator('.view-line')
			.filter({ hasText: '"options": []' })
			.first()
		const selectedBox = (await selected.boundingBox())!
		const lineBox = (await line.boundingBox())!
		expect(Math.abs(selectedBox.y - lineBox.y), 'the selection is on the options line')
			.toBeLessThan(4)
		// The key `"options"` only (9 characters), not the whole line or object.
		expect(selectedBox.width)
			.toBeLessThan(lineBox.width / 2)

		// Edits above the problem do not break the jump: it is located by source path in the current text.
		const box = (await editor.boundingBox())!
		await page.mouse.click(box.x + 300, box.y + 20)
		await page.keyboard.press('ControlOrMeta+Home')
		await page.keyboard.insertText('\n\n\n')
		await rows.nth(1)
			.click()
		const rowSelection = editor.locator('.selected-text')
			.first()
		await expect(rowSelection)
			.toBeVisible()
		const starLine = editor.locator('.view-line')
			.filter({ hasText: '"StarRating"' })
			.first()
		await expect(starLine)
			.toBeVisible()
		expect(Math.abs((await rowSelection.boundingBox())!.y - (await starLine.boundingBox())!.y))
			.toBeLessThan(4)
	})

	test('shows squiggles for Core diagnostics and for a JSON syntax error, and the syntax error lists as a problem', async ({ page }) => {
		await openLab(page, 'showcase=survey')
		const editor = page.getByTestId('json-editor')
		await expect(editor)
			.toHaveAttribute('data-marker-count', '0')
		await expect(page.locator('.squiggly-error'))
			.toHaveCount(0)

		await loadPreset(page, 'survey-ai-draft')
		await expect(editor)
			.toHaveAttribute('data-marker-count', '5')
		// Jump to the first problem so its line is on screen (squiggles only render for visible lines).
		await page.getByTestId('author-problems')
			.getByTestId('problem-row')
			.first()
			.click()
		await expect(page.locator('.squiggly-error')
			.first())
			.toBeVisible()

		await loadPreset(page, 'survey-default')
		await expect(editor)
			.toHaveAttribute('data-marker-count', '0')
		await expect(page.locator('.squiggly-error'))
			.toHaveCount(0)

		// A JSON syntax error: short text so the failing token is on screen.
		await setDraft(page, '{ "id": "x", nope }')
		await page.getByTestId('apply-button')
			.click()
		await expect(editor)
			.toHaveAttribute('data-marker-count', '1')
		await expect(page.locator('.squiggly-error'))
			.toHaveCount(1)
		const row = page.getByTestId('author-problems')
			.getByTestId('problem-row')
		await expect(row)
			.toHaveCount(1)
		await expect(row)
			.toContainText('SyntaxError:')
		await expect(row)
			.toHaveAttribute('data-problem-code', 'syntax-error')
		await expectDocumentStatus(page, { problems: 1 })
		// The committed Document and the Preview are untouched by a syntax error.
		await expectPreviewStatus(page, 'current')

		// Editing clears it (the Lab-only error describes text that no longer exists).
		await setDraft(page, '{ "id": "x", "type": "Text" }')
		await expect(page.getByTestId('author-problems'))
			.toHaveAttribute('data-problem-count', '0')
		await expect(page.locator('.squiggly-error'))
			.toHaveCount(0)
	})

	test('keeps the Blueprint "All diagnostics" view working next to the Problems list', async ({ page }) => {
		await openLab(page, 'showcase=survey')
		await loadPreset(page, 'survey-ai-draft')
		await page.getByRole('tab', { name: 'Blueprint' })
			.click()
		await page.getByRole('button', { name: /All diagnostics \(5\)/ })
			.click()
		await expect(page.locator('[data-testid^="blueprint-diagnostic-location-"]'))
			.toHaveCount(5)
	})
})

test.describe('stale-preview notice (U07)', () => {
	test('explains the cause in plain language and "Show problems" opens the list', async ({ page }) => {
		await openLab(page, 'showcase=survey')
		await loadPreset(page, 'survey-ai-draft')

		const notice = page.getByTestId('preview-diverged-status')
		await expect(notice)
			.toContainText('Your last change has 5 problems, so the preview still shows the last working version.')
		await expect(notice)
			.not
			.toContainText(/revision|r0|r1/)
		await expect(previewFrame(page)
			.getByRole('heading', { name: 'Maker Space open day: sign-up' }))
			.toBeVisible()

		// From another workbench tab, and from the Structure view: the action brings the JSON problems forward.
		await page.getByRole('tab', { name: 'Runtime' })
			.click()
		await expect(page.getByRole('tab', { name: 'Runtime' }))
			.toHaveAttribute('aria-selected', 'true')
		await notice.getByTestId('preview-show-problems')
			.click()
		await expect(page.getByRole('tab', { name: 'Author' }))
			.toHaveAttribute('aria-selected', 'true')
		await expect(page.getByTestId('author-problems')
			.getByTestId('problem-row')
			.first())
			.toBeFocused()

		await page.getByRole('tab', { name: 'Structure' })
			.click()
		await notice.getByTestId('preview-show-problems')
			.click()
		await expect(page.getByRole('tab', { name: 'JSON' }))
			.toHaveAttribute('aria-selected', 'true')
		await expect(page.getByTestId('author-problems')
			.getByTestId('problem-row')
			.first())
			.toBeFocused()
	})

	test('the notice is gone once the document is valid again', async ({ page }) => {
		await openLab(page, 'showcase=survey')
		await loadPreset(page, 'survey-ai-draft')
		await expect(page.getByTestId('preview-diverged-status'))
			.toBeVisible()
		await loadPreset(page, 'survey-default')
		await expect(page.getByTestId('preview-diverged-status'))
			.toHaveCount(0)
		await expectPreviewStatus(page, 'current')
	})
})

test.describe('plain-language wording follows the locale', () => {
	test('zh-TW translates the new chrome while Core diagnostic text stays verbatim', async ({ page }) => {
		await openLab(page, 'showcase=survey&lang=zh-TW')
		await expect(page.getByTestId('document-status'))
			.toHaveText('有效')
		await expect(page.getByTestId('preview-status'))
			.toHaveText('預覽已是最新')

		await loadPreset(page, 'survey-ai-draft')
		await expect(page.getByTestId('document-status'))
			.toHaveText('5 個問題')
		await expect(page.getByTestId('preview-diverged-status'))
			.toContainText('你上次的變更有 5 個問題')
		const first = page.getByTestId('author-problems')
			.getByTestId('problem-row')
			.first()
		await expect(first)
			.toContainText('invalid-widget-config')
		await expect(first)
			.toContainText('options: must contain at least one option.')
		await expect(page.getByTestId('author-problems'))
			.toContainText('問題')
	})
})

test.describe('status details popover (the former Author status box, folded in)', () => {
	test('the Author panel no longer carries its own copy of the status', async ({ page }) => {
		await openLab(page, 'showcase=survey')
		await expect(page.getByTestId('author-document-status'))
			.toHaveCount(0)
		await expect(page.getByText('Document / recovery status'))
			.toHaveCount(0)
		await expect(page.getByRole('tab', { name: 'JSON' }))
			.toBeVisible()
	})

	test('lists revisions, linkage, draft, compatibility, Blueprint status and recovery topology', async ({ page }) => {
		await openLab(page, 'showcase=survey')
		const panel = await openStatusDetails(page)

		await expect(panel.getByTestId('status-document-revision'))
			.toHaveText('r0')
		await expect(panel.getByTestId('status-preview-revision'))
			.toHaveText('r0')
		await expect(panel.getByTestId('revision-link-status'))
			.toHaveText('Linked / Synced')
		await expect(panel.getByTestId('status-json-draft'))
			.toHaveText('Matches committed Document')
		await expect(panel.getByTestId('status-source-compat'))
			.toHaveText('Compatible (Core)')
		await expect(panel.getByTestId('status-blueprint'))
			.toHaveText('valid · 0 diagnostics')
		await expect(panel.getByTestId('status-recovery'))
			.toHaveText('0 unresolved · 0 raw-slot placements')
		// Each fact appears once.
		await expect(panel.getByText('Blueprint status'))
			.toHaveCount(1)
		await expect(panel.getByText('Preview', { exact: true }))
			.toHaveCount(1)
	})

	test('follows the document: an unapplied draft, then an invalid apply that leaves the preview behind', async ({ page }) => {
		await openLab(page, 'showcase=survey')
		await setDraft(page, '{ "id": "x", "type": "Survey" }')
		let panel = await openStatusDetails(page)
		await expect(panel.getByTestId('status-json-draft'))
			.toHaveText('Unapplied draft')
		await page.keyboard.press('Escape')
		await expect(page.getByTestId('status-details-panel'))
			.toHaveCount(0)

		await loadPreset(page, 'survey-ai-draft', { discardDraft: true })
		panel = await openStatusDetails(page)
		await expect(panel.getByTestId('status-document-revision'))
			.toHaveText('r1')
		await expect(panel.getByTestId('status-preview-revision'))
			.toHaveText('r0')
		await expect(panel.getByTestId('revision-link-status'))
			.toHaveText('Diverged / Unlinked')
		await expect(panel.getByTestId('status-blueprint'))
			.toHaveText('invalid · 5 diagnostics')
		await expect(panel.getByTestId('status-recovery'))
			.toContainText('1 unresolved')
	})

	test('opens and closes from the keyboard, with a named trigger, and gives focus back', async ({ page }) => {
		await openLab(page, 'showcase=survey')
		const trigger = page.getByTestId('status-details')
		await expect(trigger)
			.toHaveAccessibleName('Document and preview details')
		await trigger.focus()
		await page.keyboard.press('Enter')
		await expect(page.getByTestId('status-details-panel'))
			.toBeVisible()
		await page.keyboard.press('Escape')
		await expect(page.getByTestId('status-details-panel'))
			.toHaveCount(0)
		await expect(trigger)
			.toBeFocused()
	})

	test('is translated in zh-TW', async ({ page }) => {
		await openLab(page, 'showcase=survey')
		await setLocale(page, 'zh-TW')
		const panel = await openStatusDetails(page)
		await expect(panel.getByTestId('status-json-draft'))
			.toHaveText('與已提交 Document 相符')
		await expect(panel.getByTestId('status-source-compat'))
			.toHaveText('相容（Core）')
		await expect(panel.getByTestId('status-recovery'))
			.toHaveText('0 未解析 · 0 raw-slot placement')
	})
})

test.describe('Monaco keeps its room with the Problems list open (PR 3a carry-over)', () => {
	for (const [width, height] of [[1280, 800], [1440, 900]] as const) {
		test(`at ${width}x${height} the editor stays tall and the list scrolls instead`, async ({ page }) => {
			await page.setViewportSize({ width, height })
			await openLab(page, 'showcase=survey')
			await loadPreset(page, 'survey-ai-draft')
			const problems = page.getByTestId('author-problems')
			await expect(problems)
				.toHaveAttribute('data-problem-count', '5')
			await expect(problems.getByTestId('problem-row'))
				.toHaveCount(5)

			const editor = (await page.getByTestId('json-editor')
				.boundingBox())!
			const list = (await problems.boundingBox())!
			// 312px before the redesign at 1280x800 (a 119px status box and a 192px list above and below it).
			expect(editor.height, 'editor height')
				.toBeGreaterThanOrEqual(height * 0.45)
			expect(list.height, 'Problems list')
				.toBeLessThanOrEqual(160)
			expect(list.y + list.height, 'list inside the viewport')
				.toBeLessThanOrEqual(height + 1)
			// Every problem is still reachable (the list scrolls within itself).
			await problems.getByTestId('problem-row')
				.last()
				.scrollIntoViewIfNeeded()
			await expect(problems.getByTestId('problem-row')
				.last())
				.toBeVisible()
		})
	}
})
