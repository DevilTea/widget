import type { Page } from '@playwright/test'
import { defaultSandboxPreset } from '../src/sandbox/presets'
import { expect, expectDocumentStatus, expectPreviewStatus, openAuthorJson, openStatusDetails, previewFrame, test } from './fixtures'

/**
 * Issue #28 Source/Apply lifecycle contract, deliberately not involving Monaco at all — it uses the
 * `?lab-test` interaction seam (`src/lab-test-seam.ts`) instead, which routes through the exact same
 * `LabStore.setDraftSourceText()` call Monaco's `update:modelValue` handler already makes. Runs against
 * the hidden Sandbox test fixture (selected with `?showcase=sandbox`) and its `valid-interactive` preset text
 * (`src/sandbox/presets.ts`), which renders a `Text` widget reading `"Widget Lab sandbox"`.
 */

interface LabTestWindow {
	__WIDGET_LAB_TEST__?: {
		setDraftSourceText: (text: string) => void
	}
}

async function setDraftSourceText(page: Page, text: string): Promise<void> {
	await page.evaluate((source) => {
		(window as unknown as LabTestWindow).__WIDGET_LAB_TEST__?.setDraftSourceText(source)
	}, text)
}

test.beforeEach(async ({ page }) => {
	await page.goto('/?lab-test&showcase=sandbox')
	await page.waitForFunction(() => typeof (window as unknown as LabTestWindow).__WIDGET_LAB_TEST__?.setDraftSourceText === 'function')
})

test('draft source does not affect Preview until Apply, then Apply updates it', async ({ page }) => {
	await expect(previewFrame(page)
		.getByText('Widget Lab sandbox', { exact: true }))
		.toBeVisible()

	const draft = defaultSandboxPreset.sourceText.replace('Widget Lab sandbox', 'Widget Lab sandbox DRAFT')
	await setDraftSourceText(page, draft)

	// Draft-only edit: Preview must still show the prior applied text, and Apply becomes enabled.
	await expect(previewFrame(page)
		.getByText('Widget Lab sandbox', { exact: true }))
		.toBeVisible()
	await expect(previewFrame(page)
		.getByText('Widget Lab sandbox DRAFT', { exact: true }))
		.toHaveCount(0)
	await expect(page.getByRole('button', { name: 'Apply', exact: true }))
		.toBeEnabled()

	await page.getByRole('button', { name: 'Apply', exact: true })
		.click()
	await expect(previewFrame(page)
		.getByText('Widget Lab sandbox DRAFT', { exact: true }))
		.toBeVisible()
})

test('an invalid draft preserves the prior active snapshot and surfaces a visible parse error', async ({ page }) => {
	// Author opens on Structure: this test reads Monaco and the Problems list under it.
	await openAuthorJson(page)
	const draft = defaultSandboxPreset.sourceText.replace('Widget Lab sandbox', 'Widget Lab sandbox DRAFT')
	await setDraftSourceText(page, draft)
	await page.getByRole('button', { name: 'Apply', exact: true })
		.click()
	await expect(previewFrame(page)
		.getByText('Widget Lab sandbox DRAFT', { exact: true }))
		.toBeVisible()

	// A `JSON.parse` failure at Apply time leaves `active` (and therefore Preview) untouched
	// (`LabSession.apply()`): the committed Document and the Preview revision stay exactly as they were.
	const invalidDraft = '{"broken":'
	await setDraftSourceText(page, invalidDraft)
	// The invalid draft is still the live Monaco model and must remain editable/visible; Apply is
	// enabled because it is dirty even though the active Preview snapshot is still valid (#38 guard).
	await expect(page.locator('.view-lines'))
		.toHaveText(invalidDraft)
	await expect(page.getByRole('button', { name: 'Apply', exact: true }))
		.toBeEnabled()
	await page.getByRole('button', { name: 'Apply', exact: true })
		.click()

	await expect(previewFrame(page)
		.getByText('Widget Lab sandbox DRAFT', { exact: true }))
		.toBeVisible()
	await expectPreviewStatus(page, 'current')
	await openStatusDetails(page)
	await expect(page.getByTestId('status-blueprint'))
		.toContainText('valid · 0 diagnostics')
	await page.keyboard.press('Escape')
	await expect(page.locator('.view-lines'))
		.toHaveText(invalidDraft)
	await expect(page.getByRole('button', { name: 'Apply', exact: true }))
		.toBeEnabled()

	// Visible status: the syntax error is a problem of the last Apply, so the header chip counts it and the
	// Problems list under the editor names it (`LabStore.problems`), without touching the Document.
	await expectDocumentStatus(page, { problems: 1 })
	await expect(page.getByTestId('author-problems'))
		.toContainText('SyntaxError:')
})

test('an invalid Document retains the prior Preview and explains the divergence', async ({ page }) => {
	await setDraftSourceText(page, '{ "id": "root", "type": "NoSuchWidgetType" }')
	await page.getByRole('button', { name: 'Apply', exact: true })
		.click()
	await expectDocumentStatus(page, { problems: 1 })
	await expectPreviewStatus(page, 'stale')

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
