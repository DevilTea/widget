import type { Page } from '@playwright/test'
import { defaultSandboxPreset } from '../src/sandbox/presets'
import { documentSourceText, editJson, expect, expectDocumentStatus, expectLabStatus, expectPreviewStatus, openAuthorJson, openStatusDetails, previewFrame, test, waitForLabTestSeam } from './fixtures'

/**
 * Lab UX phase 3, one commit model (it replaced issue #28's Apply lifecycle contract, `apply.spec.ts`): the JSON view commits
 * its text through the same root SourcePatch as every other edit, when it parses, after a pause in typing (750 ms) and at once
 * when the editor loses focus. One focus session is one Undo entry. Text that does not parse is never committed. Runs against the
 * hidden Sandbox fixture (`?showcase=sandbox`), whose `valid-interactive` preset renders a `Text` widget reading
 * "Widget Lab sandbox". The seam (`src/lab-test-seam.ts`) stands in for typing a whole text and leaving the editor; the timing
 * tests type into the real Monaco editor.
 */

test.beforeEach(async ({ page }) => {
	await page.goto('/?lab-test&showcase=sandbox')
	await waitForLabTestSeam(page)
})

function rootId(source: string): string {
	return (JSON.parse(source) as { id: string }).id
}

/**
 * Double-clicks the word inside the root widget's id string (a short token at the far left of line 2) and so selects it, with
 * focus in the editor: the next typed characters replace it. Typing inside a JSON string means no bracket or quote is typed,
 * so Monaco's auto-closing cannot damage the document.
 */
async function selectRootIdInMonaco(page: Page, id: string): Promise<void> {
	const token = page.getByTestId('json-editor')
		.locator('.view-line span')
		.filter({ hasText: new RegExp(`^"${id}"$`) })
		.first()
	const box = (await token.boundingBox())!
	await page.mouse.dblclick(box.x + box.width / 2, box.y + box.height / 2)
	await expect(page.getByTestId('json-editor')
		.locator('.monaco-editor'))
		.toHaveClass(/focused/)
}

/** Moves keyboard focus out of the editor without touching anything else (the JSON view's own toolbar text). */
async function leaveEditor(page: Page): Promise<void> {
	await page.getByTestId('json-commit-state')
		.click()
	await expect(page.getByTestId('json-editor')
		.locator('.monaco-editor'))
		.not
		.toHaveClass(/focused/)
}

async function documentRevision(page: Page): Promise<string> {
	await openStatusDetails(page)
	const revision = (await page.getByTestId('status-document-revision')
		.textContent())!.trim()
	await page.keyboard.press('Escape')
	return revision
}

test('a JSON edit reaches the Preview without any Apply, and the header has no Apply or Revert', async ({ page }) => {
	await expect(previewFrame(page)
		.getByText('Widget Lab sandbox', { exact: true }))
		.toBeVisible()
	await expect(page.getByRole('button', { name: 'Apply', exact: true }))
		.toHaveCount(0)
	await expect(page.getByRole('button', { name: 'Revert', exact: true }))
		.toHaveCount(0)

	await editJson(page, defaultSandboxPreset.sourceText.replace('Widget Lab sandbox', 'Widget Lab sandbox EDITED'))
	await expect(previewFrame(page)
		.getByText('Widget Lab sandbox EDITED', { exact: true }))
		.toBeVisible()
	await expectLabStatus(page, ['restarted', 'up-to-date'])
})

test('typing commits after the pause, once, not on every keystroke', async ({ page }) => {
	await openAuthorJson(page)
	await selectRootIdInMonaco(page, 'root')
	// Keystrokes 250 ms apart: shorter than the 750 ms pause, so nothing is committed while typing goes on.
	await page.keyboard.type('abc', { delay: 250 })
	expect(rootId(await documentSourceText(page)))
		.toBe('root')
	await expect.poll(async () => rootId(await documentSourceText(page)))
		.toBe('abc')
	// One commit for the whole word.
	expect(await documentRevision(page))
		.toBe('r1')
})

test('leaving the editor commits at once, without waiting for the pause', async ({ page }) => {
	await openAuthorJson(page)
	await selectRootIdInMonaco(page, 'root')
	await page.keyboard.insertText('left')
	await leaveEditor(page)
	// Read right away: the blur commit is synchronous up to the Preview promotion.
	expect(rootId(await documentSourceText(page)))
		.toBe('left')
	await expectDocumentStatus(page, { valid: true })
})

test('one focus session is one Undo entry; a new focus session is a new one', async ({ page }) => {
	await openAuthorJson(page)
	// Session 1: one edit, then leave.
	await selectRootIdInMonaco(page, 'root')
	await page.keyboard.insertText('one')
	await leaveEditor(page)
	expect(rootId(await documentSourceText(page)))
		.toBe('one')

	// Session 2: two bursts with a pause between them (two commits), then a third edit committed by the click on Undo.
	await selectRootIdInMonaco(page, 'one')
	await page.keyboard.insertText('tw')
	await expect.poll(async () => rootId(await documentSourceText(page)))
		.toBe('tw')
	await page.keyboard.insertText('o')
	await expect.poll(async () => rootId(await documentSourceText(page)))
		.toBe('two')
	await page.keyboard.insertText('!')
	await page.getByTestId('undo-button')
		.click()
	// One Undo takes the whole session back, to where session 1 left the document.
	await expect.poll(async () => rootId(await documentSourceText(page)))
		.toBe('one')
	await expect(page.locator('.view-lines'))
		.toContainText('"id": "one"')

	await page.getByTestId('undo-button')
		.click()
	await expect.poll(async () => rootId(await documentSourceText(page)))
		.toBe('root')
	await expect(page.getByTestId('undo-button'))
		.toHaveAttribute('aria-disabled', 'true')
})

test('text that does not parse commits nothing: a syntax marker, the chip, Structure inert, and Discard brings the document back', async ({ page }) => {
	await openAuthorJson(page)
	const broken = '{ "id": "root", "type": nope }'
	await editJson(page, broken)

	const editor = page.getByTestId('json-editor')
	await expect(editor)
		.toHaveAttribute('data-marker-count', '1')
	await expect(page.locator('.squiggly-error'))
		.toHaveCount(1)
	await expect(page.getByTestId('json-commit-state'))
		.toHaveAttribute('data-state', 'syntax-error')
	await expect(page.getByTestId('json-commit-state'))
		.toContainText('JSON has a syntax error — not applied.')
	await expectLabStatus(page, 'syntax-error')
	await expect(page.getByTestId('lab-status'))
		.toHaveText('JSON syntax error — not applied')
	// Well past the pause, nothing was committed: the Document and the Preview are as they were.
	await page.waitForTimeout(1000)
	expect(await documentSourceText(page))
		.toBe(defaultSandboxPreset.sourceText)
	await expectPreviewStatus(page, 'current')
	await expect(previewFrame(page)
		.getByText('Widget Lab sandbox', { exact: true }))
		.toBeVisible()

	// Structure says why it is inert, and stays so until the JSON parses or is discarded.
	await page.getByTestId('author-view-structure')
		.click()
	await page.getByRole('button', { name: 'title : Text' })
		.click()
	await expect(page.getByTestId('structure-draft-notice'))
		.toBeVisible()
	await expect(page.getByTestId('structure-fields'))
		.toHaveAttribute('data-locked', 'true')

	await page.getByTestId('discard-json-button')
		.click()
	await expect(page.getByTestId('structure-draft-notice'))
		.toHaveCount(0)
	await expect(page.getByTestId('discard-json-button'))
		.toHaveCount(0)
	await expectLabStatus(page, 'up-to-date')
})

test('Format in the JSON view\'s toolbar rewrites the text and commits it as a no-op', async ({ page }) => {
	await openAuthorJson(page)
	await editJson(page, JSON.stringify(JSON.parse(defaultSandboxPreset.sourceText)))
	await page.getByTestId('json-toolbar')
		.getByRole('button', { name: 'Format' })
		.click()
	await expect.poll(async () => documentSourceText(page))
		.toBe(JSON.stringify(JSON.parse(defaultSandboxPreset.sourceText), null, 2))
	// The same document in another layout: no new revision, no Undo entry.
	expect(await documentRevision(page))
		.toBe('r0')
	await expect(page.getByTestId('undo-button'))
		.toHaveAttribute('aria-disabled', 'true')
})

test('an invalid Document keeps the last working Preview and explains the divergence', async ({ page }) => {
	await editJson(page, '{ "id": "root", "type": "NoSuchWidgetType" }')
	await expectDocumentStatus(page, { problems: 1 })
	await expectPreviewStatus(page, 'stale')
	await expectLabStatus(page, 'problems')
	await expect(page.getByTestId('lab-status'))
		.toHaveText('1 problem · Preview shows the last working version')

	await page.getByRole('tab', { name: 'Runtime' })
		.click()
	await expect(page.getByTestId('preview-diverged-status'))
		.toContainText('Your last change has 1 problem, so the preview still shows the last working version.')
	await expect(page.getByRole('tabpanel', { name: 'Runtime' })
		.getByText('Preview r0', { exact: true }))
		.toBeVisible()
	await expect(page.getByRole('tabpanel', { name: 'Runtime' })
		.getByText('Diverged / Unlinked', { exact: true }))
		.toBeVisible()
})
