import type { Page } from '@playwright/test'
import { defaultSandboxPreset } from '../src/sandbox/presets'
import { expect, test } from './fixtures'

/**
 * Issue #28 Source/Apply lifecycle contract, deliberately not involving Monaco at all — it uses the
 * `?lab-test` interaction seam (`src/lab-test-seam.ts`) instead, which routes through the exact same
 * `LabStore.setDraftSourceText()` call Monaco's `update:modelValue` handler already makes. Runs against
 * the default Sandbox showcase (the app's default on load) and its `valid-interactive` preset text
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
	await page.goto('/?lab-test')
	await page.waitForFunction(() => typeof (window as unknown as LabTestWindow).__WIDGET_LAB_TEST__?.setDraftSourceText === 'function')
})

test('draft source does not affect Preview until Apply, then Apply updates it', async ({ page }) => {
	await expect(page.getByText('Widget Lab sandbox', { exact: true }))
		.toBeVisible()

	const draft = defaultSandboxPreset.sourceText.replace('Widget Lab sandbox', 'Widget Lab sandbox DRAFT')
	await setDraftSourceText(page, draft)

	// Draft-only edit: Preview must still show the prior applied text, and Apply becomes enabled.
	await expect(page.getByText('Widget Lab sandbox', { exact: true }))
		.toBeVisible()
	await expect(page.getByText('Widget Lab sandbox DRAFT', { exact: true }))
		.toHaveCount(0)
	await expect(page.getByRole('button', { name: 'Apply' }))
		.toBeEnabled()

	await page.getByRole('button', { name: 'Apply' })
		.click()
	await expect(page.getByText('Widget Lab sandbox DRAFT', { exact: true }))
		.toBeVisible()
})

test('an invalid draft preserves the prior active snapshot and surfaces a visible parse error', async ({ page }) => {
	const draft = defaultSandboxPreset.sourceText.replace('Widget Lab sandbox', 'Widget Lab sandbox DRAFT')
	await setDraftSourceText(page, draft)
	await page.getByRole('button', { name: 'Apply' })
		.click()
	await expect(page.getByText('Widget Lab sandbox DRAFT', { exact: true }))
		.toBeVisible()

	// A `JSON.parse` failure at Apply time leaves `active` (and therefore Preview) untouched
	// (`LabSession.apply()`) — the Blueprint/Runtime status pills stay exactly as they were.
	await setDraftSourceText(page, '{ not valid json')
	await page.getByRole('button', { name: 'Apply' })
		.click()

	await expect(page.getByText('Widget Lab sandbox DRAFT', { exact: true }))
		.toBeVisible()
	await expect(page.getByText('Blueprint: valid'))
		.toBeVisible()
	await expect(page.getByText('Runtime: active'))
		.toBeVisible()

	// Visible status: the Source panel's parse-error banner (`SourcePanel.vue`'s
	// `store.parseError.value`) — LabHeader's own status pills never reflect a Lab-only parse error.
	await expect(page.getByText('SyntaxError:'))
		.toBeVisible()
})
