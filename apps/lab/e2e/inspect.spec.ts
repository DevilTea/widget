import type { Page } from '@playwright/test'
import { defaultSandboxPreset } from '../src/sandbox/presets'
import { expect, loadPreset, previewFrame, test } from './fixtures'

/**
 * Issue #25 P2 "Preview -> semantic inspector bridge" (Inspect mode) contract.
 *
 * Fixtures used:
 *  - Sandbox test fixture (`?showcase=sandbox`, `valid-interactive` preset): the `counter-1` (`Counter`)
 *    widget nested inside `root` (`Stack`) — the nested-anchor case; its "+1" button changes the visible
 *    `count: N · doubled: M` text, a clearly observable underlying action to prove suppressed/not-suppressed.
 *  - Survey showcase (`survey-default` preset): `phone` (`ShortAnswer`, label "Phone number") — visible on
 *    load, so a plain hover/badge target and a native text input; `mode` (`SingleChoice`) whose "On site"
 *    answer makes `guests` appear (the Property-driven proof that a write reached State).
 */

const INSPECT_TOGGLE = { name: 'Inspect' }
const COUNTER_TEXT_0 = 'count: 0 · doubled: 0'
const COUNTER_TEXT_1 = 'count: 1 · doubled: 2'

function inspectToggle(page: Page) {
	return page.getByRole('button', INSPECT_TOGGLE)
}

interface LabTestWindow {
	__WIDGET_LAB_TEST__?: {
		editJson: (text: string) => void
	}
}

async function commitJson(page: Page, text: string): Promise<void> {
	await page.evaluate((source) => {
		(window as unknown as LabTestWindow).__WIDGET_LAB_TEST__?.editJson(source)
	}, text)
}

test.describe('Inspect mode (issue #25 P2)', () => {
	test('is off by default: Sandbox Counter buttons behave normally', async ({ page }) => {
		await page.goto('/?showcase=sandbox')

		await expect(inspectToggle(page))
			.toHaveAttribute('aria-pressed', 'false')

		await previewFrame(page)
			.getByRole('button', { name: '+1' })
			.click()
		await expect(previewFrame(page)
			.getByText(COUNTER_TEXT_1, { exact: true }))
			.toBeVisible()
	})

	test('toggling on: hovering a Survey question outlines it and shows the type#id badge', async ({ page }) => {
		await page.goto('/')
		await inspectToggle(page)
			.click()
		await expect(inspectToggle(page))
			.toHaveAttribute('aria-pressed', 'true')

		const phoneLabel = previewFrame(page)
			.getByText('Phone number', { exact: true })
		const phoneAnchor = phoneLabel.locator('..')

		await phoneLabel.hover()

		// The highlight is an Agent-owned ShadowRoot overlay drawn over the anchor, not a class on it.
		const overlayRect = previewFrame(page)
			.locator('[data-widget-inspector-overlay="true"] .rect')
		await expect(overlayRect)
			.toHaveCount(1)
		await expect(phoneAnchor)
			.not
			.toHaveClass(/highlight/)
		const [anchorBox, overlayBox] = await Promise.all([phoneAnchor.boundingBox(), overlayRect.boundingBox()])
		expect(anchorBox)
			.not
			.toBeNull()
		expect(overlayBox?.x)
			.toBeCloseTo(anchorBox!.x, 0)
		expect(overlayBox?.y)
			.toBeCloseTo(anchorBox!.y, 0)
		expect(overlayBox?.width)
			.toBeCloseTo(anchorBox!.width, 0)
		expect(overlayBox?.height)
			.toBeCloseTo(anchorBox!.height, 0)
		await expect(previewFrame(page)
			.getByText('ShortAnswer#phone'))
			.toBeVisible()
	})

	test('inspect-click on a Sandbox Counter button suppresses its action but drives shared focus into Blueprint and Runtime', async ({ page }) => {
		await page.goto('/?showcase=sandbox')

		await inspectToggle(page)
			.click()

		await previewFrame(page)
			.getByRole('button', { name: '+1' })
			.click()

		// Suppressed: the Counter State did not change.
		await expect(previewFrame(page)
			.getByText(COUNTER_TEXT_0, { exact: true }))
			.toBeVisible()

		// Drives the existing shared focus + opens the Selected widget pane for immediate visible feedback.
		await expect(page.getByRole('tab', { name: 'Selected widget' }))
			.toHaveAttribute('aria-selected', 'true')
		await expect(page.getByRole('heading', { name: 'counter-1 : Counter' }))
			.toBeVisible()

		// Runtime reflects the exact same shared focus once opened: the same tree row is the selected
		// (highlighted) one there too — relative to a sibling row's own background, rather than any
		// specific color value.
		await page.getByRole('tab', { name: 'Runtime' })
			.click()
		const counterRow = page.getByRole('button', { name: 'counter-1 : Counter' })
		const summaryRow = page.getByRole('button', { name: 'summary-1 : Summary' })
		const [selectedBackground, otherBackground] = await Promise.all([
			counterRow.evaluate(el => getComputedStyle(el).backgroundColor),
			summaryRow.evaluate(el => getComputedStyle(el).backgroundColor),
		])
		expect(selectedBackground)
			.not.toBe(otherBackground)
	})

	test('innermost inspect anchor wins: a Counter nested inside the root Stack selects itself, not its container', async ({ page }) => {
		await page.goto('/?showcase=sandbox')

		await inspectToggle(page)
			.click()

		// `counter-1` (Counter) is nested inside `root` (Stack) — both are stamped Inspect anchors.
		await previewFrame(page)
			.getByText(COUNTER_TEXT_0, { exact: true })
			.click()

		await expect(page.getByRole('tab', { name: 'Selected widget' }))
			.toHaveAttribute('aria-selected', 'true')
		await expect(page.getByRole('heading', { name: 'counter-1 : Counter' }))
			.toBeVisible()
		await expect(page.getByRole('heading', { name: 'root : Stack' }))
			.toHaveCount(0)
	})

	test('the hint names the panel a click opens: Selected widget, or Runtime while the Preview lags the Document', async ({ page }) => {
		await page.goto('/?showcase=sandbox')
		await inspectToggle(page)
			.click()
		const hint = page.getByTestId('inspect-hint')
		await expect(hint)
			.toHaveText('Click a widget to open it in Selected widget — Esc to exit')
		await previewFrame(page)
			.getByText(COUNTER_TEXT_0, { exact: true })
			.click()
		await expect(page.getByRole('tab', { name: 'Selected widget' }))
			.toHaveAttribute('aria-selected', 'true')

		// An invalid Document leaves the Preview on the last valid revision: only the Runtime panel knows its widgets.
		await loadPreset(page, 'invalid-semantic')
		await expect(page.getByTestId('lab-status'))
			.toHaveAttribute('data-preview', 'stale')
		await expect(inspectToggle(page))
			.toHaveAttribute('aria-pressed', 'true')
		await expect(hint)
			.toHaveText('Click a widget to open it in Runtime — Esc to exit')
		await previewFrame(page)
			.getByText(COUNTER_TEXT_0, { exact: true })
			.click()
		await expect(page.getByRole('tab', { name: 'Runtime', exact: true }))
			.toHaveAttribute('aria-selected', 'true')
	})

	test('Escape exits Inspect mode: badge disappears and subsequent clicks act normally', async ({ page }) => {
		await page.goto('/')
		await inspectToggle(page)
			.click()
		const phoneLabel = previewFrame(page)
			.getByText('Phone number', { exact: true })
		await phoneLabel.hover()
		await expect(previewFrame(page)
			.getByText('ShortAnswer#phone'))
			.toBeVisible()
		await expect(inspectToggle(page))
			.toBeEnabled()

		// Escape issued in the parent realm must bridge to the isolated Preview Agent.
		await inspectToggle(page)
			.press('Escape')

		await expect(inspectToggle(page))
			.toHaveAttribute('aria-pressed', 'false')
		await expect(previewFrame(page)
			.getByText('ShortAnswer#phone'))
			.toHaveCount(0)

		// A subsequent click now behaves normally again: choosing "On site" actually reaches the widget's
		// State (as it would with Inspect never having been turned on). Guests appearing is the
		// browser-visible proof that this was a semantic State write that its dependent Property
		// recomputed from, not just a radio button's DOM update (#11 false-green guard).
		const guestsQuestion = previewFrame(page)
			.getByText('Guests coming with you')
		await expect(guestsQuestion)
			.toHaveCount(0)
		const onSite = previewFrame(page)
			.getByLabel('On site', { exact: true })
		await onSite.click()
		await expect(onSite)
			.toBeChecked()
		await expect(guestsQuestion)
			.toBeVisible()
	})

	test('toggling off restores normal Preview behavior immediately', async ({ page }) => {
		await page.goto('/?showcase=sandbox')

		await inspectToggle(page)
			.click()
		await expect(inspectToggle(page))
			.toHaveAttribute('aria-pressed', 'true')

		// Toggle off explicitly (not Escape).
		await inspectToggle(page)
			.click()
		await expect(inspectToggle(page))
			.toHaveAttribute('aria-pressed', 'false')

		await previewFrame(page)
			.getByRole('button', { name: '+1' })
			.click()
		await expect(previewFrame(page)
			.getByText(COUNTER_TEXT_1, { exact: true }))
			.toBeVisible()
	})

	/**
	 * Merge-gate review round 1, blocker 1: `click.capture` alone is too late — a real pointer
	 * activation runs `pointerdown` (and the browser's default focus-on-mousedown action) strictly
	 * before `click`, so a click-only suppression cannot stop a native `<input>` from already being
	 * focused. This pins the stronger "inspector selection ONLY — the underlying control is not also
	 * activated" contract against a NATIVE FOCUSABLE control (not a Button): the Survey "Phone number" text
	 * input. Written to fail against the pre-fix (`click`-only) implementation and pass once
	 * `pointerdown`/`pointerup` are also suppressed at the capture boundary.
	 */
	test('inspect-click on a native focusable control (Survey "Phone number" input) selects the widget without focusing/activating it or mutating its State', async ({ page }) => {
		await page.goto('/')
		const phoneInput = previewFrame(page)
			.getByLabel('Phone number')
		await expect(phoneInput)
			.toHaveValue('')

		await inspectToggle(page)
			.click()

		await phoneInput.click()

		// (a) the correct semantic widget is selected/focused in the inspector.
		await expect(page.getByRole('tab', { name: 'Selected widget' }))
			.toHaveAttribute('aria-selected', 'true')
		await expect(page.getByRole('heading', { name: 'phone : ShortAnswer' }))
			.toBeVisible()

		// (b) the underlying native control did NOT receive focus / native activation.
		await expect(phoneInput)
			.not.toBeFocused()

		// (c) no semantic State change occurred as a side effect (the value is unchanged).
		await expect(phoneInput)
			.toHaveValue('')
	})

	/**
	 * Merge-gate review round 1, blocker 2: an Inspect toggle that is a non-functional mode (zero anchors)
	 * is a user-visible capability lie. `sandbox/renderers.ts`'s five render-function renderers each
	 * project `widgetId`/`widgetType` onto their own root vnode via `useInspectAnchor()` — the two tests
	 * below exercise that against the Counter widget (`counter-1`) from the `valid-interactive` preset of
	 * the hidden Sandbox test fixture (`?showcase=sandbox`).
	 */
	test('restores requested Inspect state after a JSON commit replaces the Preview Runtime', async ({ page }) => {
		await page.goto('/?lab-test&showcase=sandbox')
		await page.waitForFunction(() => typeof (window as unknown as LabTestWindow).__WIDGET_LAB_TEST__?.editJson === 'function')

		await inspectToggle(page)
			.click()
		await expect(inspectToggle(page))
			.toHaveAttribute('aria-pressed', 'true')

		const draft = defaultSandboxPreset.sourceText.replace('Widget Lab sandbox', 'Widget Lab sandbox INSPECT REPLACED')
		await commitJson(page, draft)

		await expect(previewFrame(page)
			.getByText('Widget Lab sandbox INSPECT REPLACED', { exact: true }))
			.toBeVisible()
		await expect(inspectToggle(page))
			.toBeEnabled()
		await expect(inspectToggle(page))
			.toHaveAttribute('aria-pressed', 'true')

		await previewFrame(page)
			.getByText('count: 0 · doubled: 0', { exact: true })
			.click()
		await expect(page.getByRole('heading', { name: 'counter-1 : Counter' }))
			.toBeVisible()
	})

	test('Sandbox fixture: Inspect works against its initial state — hover/click the Counter widget', async ({ page }) => {
		await page.goto('/?showcase=sandbox')
		await inspectToggle(page)
			.click()
		await expect(inspectToggle(page))
			.toHaveAttribute('aria-pressed', 'true')

		const counterValue = previewFrame(page)
			.getByText('count: 0 · doubled: 0', { exact: true })
		await counterValue.hover()
		await expect(previewFrame(page)
			.getByText('Counter#counter-1'))
			.toBeVisible()

		await counterValue.click()

		await expect(page.getByRole('tab', { name: 'Selected widget' }))
			.toHaveAttribute('aria-selected', 'true')
		await expect(page.getByRole('heading', { name: 'counter-1 : Counter' }))
			.toBeVisible()
	})
})
