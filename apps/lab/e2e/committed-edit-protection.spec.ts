import type { Locator, Page } from '@playwright/test'
import { answerDraftGuard, chooseTutorialMenuItem, expect, expectDocumentStatus, expectShowcase, loadPreset, previewFrame, selectShowcase, test } from './fixtures'

/**
 * Lab UX phase 2, report item 10: committed edits are not lost silently. A showcase switch (a new session, nothing to undo) asks
 * first; a preset load or a tutorial start (ordinary commits) runs and offers Undo. With a draft (since Lab UX phase 3: JSON text
 * that does not parse) and edits, one dialog names both.
 */

interface LabTestWindow {
	__WIDGET_LAB_TEST__?: { editJson: (text: string) => void }
}

const field = (editor: Locator, path: string): Locator => editor.locator(`[data-config-path="${path}"]`)

/** Commits a new en title of the survey through Structure (the root is selected on entry). */
async function editSurveyTitle(page: Page, title: string): Promise<void> {
	const box = field(page.getByTestId('structure-editor'), 'title.en')
		.locator('input')
	await box.fill(title)
	await box.press('Enter')
	await expect(previewFrame(page)
		.getByRole('heading', { name: title }))
		.toBeVisible()
	await expect(page.getByTestId('examples-preset'))
		.toHaveAttribute('data-example-kind', 'edited')
}

test.describe('committed edits are protected (report item 10)', () => {
	test('switching showcase away from committed edits asks first, naming that Undo cannot bring them back', async ({ page }) => {
		await page.goto('/?showcase=survey')
		await editSurveyTitle(page, 'My open day')

		await selectShowcase(page, 'trip-budget')
		const dialog = page.getByTestId('draft-guard-dialog')
		await expect(dialog)
			.toBeVisible()
		await expect(dialog.getByRole('heading'))
			.toHaveText('Discard your edits?')
		await expect(page.locator('#draft-guard-dialog-body'))
			.toHaveText('You edited this document. Opening “Trip budget splitter” replaces it, and Undo cannot bring your edits back.')
		await expect(page.getByTestId('draft-guard-keep'))
			.toBeFocused()

		// Keep editing: nothing changes.
		await answerDraftGuard(page, 'keep')
		await expectShowcase(page, 'survey')
		await expect(previewFrame(page)
			.getByRole('heading', { name: 'My open day' }))
			.toBeVisible()

		// Continue: the switch happens.
		await selectShowcase(page, 'trip-budget', { discardDraft: true })
		await expectShowcase(page, 'trip-budget')
	})

	test('a document that equals a preset again (after Undo) switches without asking', async ({ page }) => {
		await page.goto('/?showcase=survey')
		await editSurveyTitle(page, 'My open day')
		await page.getByTestId('undo-button')
			.click()
		await expect(page.getByTestId('examples-preset'))
			.toHaveAttribute('data-example-kind', 'preset')

		await selectShowcase(page, 'trip-budget')
		await expect(page.getByTestId('draft-guard-dialog'))
			.toBeHidden()
		await expectShowcase(page, 'trip-budget')
	})

	test('a draft and committed edits ask once, naming both', async ({ page }) => {
		await page.goto('/?lab-test&showcase=survey')
		await editSurveyTitle(page, 'My open day')
		await page.evaluate(() => (window as unknown as LabTestWindow).__WIDGET_LAB_TEST__!.editJson('{ "unapplied": '))
		await expect(page.getByTestId('lab-status'))
			.toHaveAttribute('data-state', 'syntax-error')

		await selectShowcase(page, 'trip-budget')
		await expect(page.getByTestId('draft-guard-dialog')
			.getByRole('heading'))
			.toHaveText('Discard your changes?')
		await expect(page.locator('#draft-guard-dialog-body'))
			.toHaveAttribute('data-loss', 'draft-and-edits')
		await answerDraftGuard(page, 'discard')
		await expectShowcase(page, 'trip-budget')
		// One dialog only.
		await expect(page.getByRole('alertdialog'))
			.toHaveCount(0)
	})

	test('reloading a preset over committed edits runs at once and offers Undo, which brings the edits back', async ({ page }) => {
		await page.goto('/?showcase=survey')
		await editSurveyTitle(page, 'My open day')

		await loadPreset(page, 'survey-default')
		await expect(page.getByTestId('draft-guard-dialog'))
			.toBeHidden()
		const preview = previewFrame(page)
		await expect(preview.getByRole('heading', { name: 'Maker Space open day: sign-up' }))
			.toBeVisible()
		const notice = page.getByTestId('replaced-document-notice')
		await expect(notice)
			.toContainText('Loaded “Default — open day sign-up”. Undo to get your edits back.')

		await notice.getByRole('button', { name: 'Undo last change' })
			.click()
		await expect(preview.getByRole('heading', { name: 'My open day' }))
			.toBeVisible()
		await expect(notice)
			.toHaveCount(0)

		// Dismiss closes it without touching the Document; a later commit ends it too.
		await loadPreset(page, 'survey-default')
		await expect(notice)
			.toBeVisible()
		await notice.getByRole('button', { name: 'Dismiss notice' })
			.click()
		await expect(notice)
			.toHaveCount(0)
		await expect(preview.getByRole('heading', { name: 'Maker Space open day: sign-up' }))
			.toBeVisible()
	})

	test('a preset load over a draft still asks about the draft only, then offers Undo for the edits', async ({ page }) => {
		await page.goto('/?lab-test&showcase=survey')
		await editSurveyTitle(page, 'My open day')
		await page.evaluate(() => (window as unknown as LabTestWindow).__WIDGET_LAB_TEST__!.editJson('{ "unapplied": '))

		await loadPreset(page, 'survey-ai-draft')
		await expect(page.locator('#draft-guard-dialog-body'))
			.toHaveAttribute('data-loss', 'draft')
		await answerDraftGuard(page, 'discard')
		await expectDocumentStatus(page, { problems: 5 })
		const notice = page.getByTestId('replaced-document-notice')
		await expect(notice)
			.toContainText('Loaded “AI draft — five mistakes”.')
		// The notice lives in a real status region.
		await expect(page.getByTestId('replaced-document-region'))
			.toHaveAttribute('role', 'status')

		// JSON that does not parse makes Undo unavailable: the notice says why, and the button is described by it.
		await page.evaluate(() => (window as unknown as LabTestWindow).__WIDGET_LAB_TEST__!.editJson('{ "unapplied": '))
		const reason = notice.getByTestId('replaced-document-undo-reason')
		await expect(reason)
			.toHaveText('Fix or discard the JSON syntax error before undoing')
		const undo = notice.getByRole('button', { name: 'Undo last change' })
		await expect(undo)
			.toHaveAttribute('aria-disabled', 'true')
		await expect(undo)
			.toHaveAttribute('aria-describedby', (await reason.getAttribute('id'))!)
	})

	test('restarting the tutorial over committed edits on its own showcase asks nothing and offers Undo', async ({ page }) => {
		await page.goto('/?showcase=survey')
		await editSurveyTitle(page, 'My open day')
		await chooseTutorialMenuItem(page)
		await expect(page.getByRole('complementary', { name: 'Tutorial' }))
			.toBeVisible()
		await expect(page.getByRole('alertdialog'))
			.toHaveCount(0)
		await expect(page.getByTestId('replaced-document-notice'))
			.toBeVisible()
	})
})
