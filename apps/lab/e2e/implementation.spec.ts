import type { Page } from '@playwright/test'
import { expect, previewFrame, test } from './fixtures'

/**
 * Issue #25 P3 "curated Implementation source explorer" contract.
 *
 * Fixtures used: Survey showcase (`survey-default` preset) — `phone` (`ShortAnswer`) is the widget every
 * test below focuses; its curated entry is `short-answer.ts` (plugin) + `ShortAnswerRenderer.vue`
 * (renderer) + shared helper files (see `showcases/survey/sources.ts`). Two different focus mechanisms are
 * exercised on purpose across the tests below — an Inspect-mode click (Preview -> Blueprint bridge,
 * issue #25 P2) and a direct Blueprint tree-node click — since the Implementation panel is specified to
 * follow whichever shared focus is current, regardless of how it got there.
 */

async function focusPhoneViaInspect(page: Page): Promise<void> {
	await page.getByRole('button', { name: 'Inspect' })
		.click()
	// An Inspect-mode click on the native input is suppressed and selects the `phone` widget instead
	// (`inspect.spec.ts` pins the suppression itself).
	await previewFrame(page)
		.getByLabel('Phone number')
		.click()
	await expect(page.getByRole('heading', { name: 'phone : ShortAnswer' }))
		.toBeVisible()
}

test.describe('Implementation explorer (issue #25 P3)', () => {
	test.beforeEach(async ({ page }) => {
		await page.goto('/')
	})

	test('Survey: Inspect-select the ShortAnswer widget, open Implementation, see the curated plugin/renderer files highlighted, and the Applied instance JSON', async ({ page }) => {
		await focusPhoneViaInspect(page)

		await page.getByTestId('preview-view-implementation')
			.click()
		await expect(page.getByRole('tab', { name: 'Implementation' }))
			.toHaveAttribute('aria-selected', 'true')
		await expect(page.getByText('ShortAnswer', { exact: true }))
			.toBeVisible()

		// Default tab is the first curated file — the semantic plugin (`short-answer.ts`).
		await expect(page.getByRole('button', { name: 'short-answer.ts' }))
			.toBeVisible()
		await expect(page.getByTestId('implementation-code'))
			.toContainText('createWidgetPlugin(\'ShortAnswer\')')

		await page.getByRole('button', { name: 'ShortAnswerRenderer.vue' })
			.click()
		await expect(page.getByTestId('implementation-code'))
			.toContainText('function onInput')

		await page.getByRole('button', { name: 'Applied instance' })
			.click()
		await expect(page.getByTestId('implementation-code'))
			.toContainText('"id": "phone"')
		await expect(page.getByTestId('implementation-code'))
			.toContainText('"type": "ShortAnswer"')
	})

	test('entry from Blueprint\'s selected-node detail works', async ({ page }) => {
		await page.getByRole('tab', { name: 'Blueprint' })
			.click()
		await page.getByRole('button', { name: 'phone : ShortAnswer' })
			.click()

		await page.getByTestId('blueprint-view-implementation')
			.click()
		await expect(page.getByRole('tab', { name: 'Implementation' }))
			.toHaveAttribute('aria-selected', 'true')
		await expect(page.getByText('ShortAnswer', { exact: true }))
			.toBeVisible()
	})

	test('the panel is closable and reopenable from a different entry point; the five canonical panels stay non-closable', async ({ page }) => {
		await focusPhoneViaInspect(page)
		await page.getByTestId('preview-view-implementation')
			.click()

		const implementationTab = page.getByRole('tab', { name: 'Implementation' })
		await expect(implementationTab)
			.toBeVisible()
		const closeAction = implementationTab.locator('.dv-default-tab-action')
		await expect(closeAction)
			.toHaveCount(1)

		// No canonical-panel regression (issue #27's non-closable policy stays untouched).
		for (const name of ['Author', 'Blueprint', 'Runtime', 'Dependencies', 'Preview']) {
			await expect(page.getByRole('tab', { name })
				.locator('.dv-default-tab-action'))
				.toHaveCount(0)
		}

		await closeAction.click()
		await expect(page.getByRole('tab', { name: 'Implementation' }))
			.toHaveCount(0)

		// Reopen from a DIFFERENT entry point (Blueprint's selected-node detail) — same widget is still
		// held in shared focus, so the button is enabled without reselecting anything.
		await page.getByRole('tab', { name: 'Blueprint' })
			.click()
		await page.getByTestId('blueprint-view-implementation')
			.click()
		await expect(page.getByRole('tab', { name: 'Implementation' }))
			.toHaveAttribute('aria-selected', 'true')
	})

	test('lazy boundary: the Implementation panel/Shiki chunk and curated raw-source chunks are not fetched before first open, and are fetched after', async ({ page }) => {
		const requestedUrls: string[] = []
		page.on('request', request => requestedUrls.push(request.url()))

		// Re-navigate under this test's own request listener (the `beforeEach` above already navigated).
		await page.goto('/')
		await focusPhoneViaInspect(page)

		const implementationChunk = /\/assets\/ImplementationPanel-[^/]+\.js(?:\?.*)?$/
		// `ShortAnswerRenderer-*.js` is unambiguous: the REAL compiled `ShortAnswerRenderer.vue` Vue
		// component is bundled into the Survey renderer's own chunks under a different basename, so the only
		// chunk with this basename is the `?raw` text variant `showcases/survey/sources.ts`'s `ShortAnswer`
		// entry lazily imports.
		const rendererRawChunk = /\/assets\/ShortAnswerRenderer-[^/]+\.js(?:\?.*)?$/
		expect(requestedUrls.some(url => implementationChunk.test(url)))
			.toBe(false)
		expect(requestedUrls.some(url => rendererRawChunk.test(url)))
			.toBe(false)

		await page.getByTestId('preview-view-implementation')
			.click()
		await expect(page.getByTestId('implementation-code'))
			.toContainText('createWidgetPlugin(\'ShortAnswer\')')

		await expect.poll(() => requestedUrls.some(url => implementationChunk.test(url)))
			.toBe(true)
		// The default-selected tab is the plugin file (`short-answer.ts`), not the renderer — switch to it
		// to actually trigger the renderer's own raw-content fetch before asserting it happened.
		await page.getByRole('button', { name: 'ShortAnswerRenderer.vue' })
			.click()
		await expect(page.getByTestId('implementation-code'))
			.toContainText('function onInput')
		await expect.poll(() => requestedUrls.some(url => rendererRawChunk.test(url)))
			.toBe(true)
	})

	/**
	 * P3 merge-gate review round 1, blocker 2: pin the applied-vs-draft identity boundary at the actual
	 * `ImplementationPanel` + `LabStore` integration boundary — `applied-instance.unit.test.ts` only
	 * proves the pure extractor walks whatever string it is handed; it cannot catch a one-line regression
	 * from `store.active.value.sourceText` to `store.draftSourceText.value` at the call site. Reuses the
	 * `?lab-test` seam / dirty-draft-without-Apply pattern already established by
	 * `tutorial.spec.ts`'s `dirtyTheDraft()`. The hidden Sandbox fixture (`?showcase=sandbox`) and its
	 * `title` (`Text`) widget are the fixture — simple enough to hand-author a one-field-changed draft
	 * string for.
	 */
	test('Applied instance always reflects the APPLIED snapshot, never an unapplied draft edit to the same widget (issue #25 P3 locked identity boundary)', async ({ page }) => {
		interface LabTestWindow { __WIDGET_LAB_TEST__?: { setDraftSourceText: (text: string) => void } }

		await page.goto('/?lab-test&showcase=sandbox')
		await page.waitForFunction(() => typeof (window as unknown as LabTestWindow).__WIDGET_LAB_TEST__?.setDraftSourceText === 'function')

		// Focus the `title` (`Text`) widget via the Blueprint tree and open its Applied instance.
		await page.getByRole('tab', { name: 'Blueprint' })
			.click()
		await page.getByRole('button', { name: 'title : Text' })
			.click()
		await page.getByTestId('blueprint-view-implementation')
			.click()
		await page.getByRole('button', { name: 'Applied instance' })
			.click()

		const appliedInstanceCode = page.getByTestId('implementation-code')
		await expect(appliedInstanceCode)
			.toContainText('"text": "Widget Lab sandbox"')

		// Dirty the DRAFT (never applied) — the same `title` widget, a distinctive marker in its `text`.
		const marker = 'DRAFT_ONLY_MARKER_never_applied_9f3c1a'
		await page.evaluate((text) => {
			(window as unknown as LabTestWindow).__WIDGET_LAB_TEST__?.setDraftSourceText(JSON.stringify({
				id: 'root',
				type: 'Stack',
				slots: {
					items: [
						{ id: 'title', type: 'Text', config: { text } },
						{ id: 'counter-1', type: 'Counter' },
					],
				},
			}))
		}, marker)

		// The Source editor (Monaco) shows the dirtied draft.
		await page.getByRole('tab', { name: 'Author' })
			.click()
		await expect(page.locator('.view-lines')
			.getByText(marker, { exact: false }))
			.toBeVisible()

		// Applied instance — re-activating the SAME Implementation tab, never re-navigated — still shows
		// the applied declaration and must NOT show the unapplied marker (scoped to the Implementation
		// panel's own code view, not a page-wide assertion, since the marker legitimately lives in
		// Monaco's `.view-lines` DOM above — same scoping precedent as `tutorial.spec.ts`'s dirty-draft
		// tests).
		await page.getByRole('tab', { name: 'Implementation' })
			.click()
		await expect(appliedInstanceCode)
			.toContainText('"text": "Widget Lab sandbox"')
		await expect(appliedInstanceCode)
			.not.toContainText(marker)
	})
})
