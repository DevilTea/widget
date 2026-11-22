import type { Locator, Page } from '@playwright/test'
import { expect, loadPreset, previewFrame, setLocale, test } from './fixtures'

/**
 * Lab UX phase 2, M13: the Explain tab. It explains one chosen widget (never the root by default): what it is, why it behaves
 * this way (its Properties' reads of other widgets with their live Preview values and the config field that names them), its
 * current values, who uses it and what it depends on, and the declaration details. Inspect keeps the Explain tab open.
 */

async function openLab(page: Page): Promise<void> {
	await page.goto('/?showcase=survey')
	await expect(previewFrame(page)
		.getByRole('heading', { name: 'Maker Space open day: sign-up' }))
		.toBeVisible()
}

function explainTab(page: Page, name = 'Explain'): Locator {
	return page.getByRole('tab', { name, exact: true })
}

const explain = (page: Page): Locator => page.getByTestId('explain')
const identity = (page: Page): Locator => page.getByTestId('explain-identity')

function why(page: Page, property: string, target: string): Locator {
	return explain(page)
		.locator(`[data-testid="explain-why"][data-property="${property}"][data-target="${target}"]`)
}

/** Picks the widget whose Preview text is `text` with Inspect, then leaves Inspect so the Preview answers clicks again. */
async function inspectWidget(page: Page, text: string, inspectLabel = 'Inspect'): Promise<void> {
	const toggle = page.getByRole('button', { name: inspectLabel, exact: true })
	await toggle.click()
	await expect(toggle)
		.toHaveAttribute('aria-pressed', 'true')
	await previewFrame(page)
		// A required question's label ends in "*", so the text is matched as a prefix.
		.getByText(text)
		.first()
		.click()
	await toggle.click()
	await expect(toggle)
		.toHaveAttribute('aria-pressed', 'false')
}

test.describe('explain tab', () => {
	test('sits right after Author and shows one card while nothing is chosen, never the root', async ({ page }) => {
		await openLab(page)
		// The Dockview tabs of the tool group (not the Author panel's own Catalog/Structure/JSON tabs).
		const toolTabs = page.locator('.dv-groupview')
			.filter({ has: page.getByRole('tab', { name: 'Author', exact: true }) })
			.locator('.dv-tab')
		await expect(toolTabs)
			.toHaveText(['Author', 'Explain', 'Selected widget', 'Blueprint', 'Runtime', 'Events', 'Dependencies'])

		await explainTab(page)
			.click()
		await expect(page.getByTestId('explain-empty'))
			.toHaveText(/Click a widget in the Preview \(Inspect\) or in the Structure tree to see what it is and why it behaves this way\./)
		await expect(page.getByTestId('explain-widget'))
			.toHaveCount(0)
		await expect(explain(page))
			.toHaveAttribute('data-runtime-state', 'none')
	})

	test('Inspect keeps Explain open: identity, and a why sentence whose value follows the Preview', async ({ page }) => {
		await openLab(page)
		await explainTab(page)
			.click()
		await inspectWidget(page, 'Sessions you want to join')

		await expect(explainTab(page))
			.toHaveAttribute('aria-selected', 'true')
		await expect(identity(page)
			.getByRole('heading'))
			.toHaveText('#sessions MultipleChoice')
		// The generated plugin summary, with its Markdown code spans drawn as code, not as backticks.
		const summary = page.getByTestId('explain-summary')
		await expect(summary)
			.toContainText('A pick-several question. The chosen option values are State answer.')
		await expect(summary.locator('code')
			.first())
			.toBeVisible()
		await expect(summary)
			.not
			.toContainText('`')

		const options = why(page, 'options', 'mode')
		await expect(options.getByTestId('explain-why-sentence'))
			.toHaveText('options reads #mode\'s value (now: no value)')
		await expect(options.getByTestId('explain-why-field'))
			.toContainText('— enabledWhen: Allow choosing the option only while this holds')
		await expect(page.getByTestId('explain-values-source'))
			.toHaveText('Current values come from the running preview, which shows the current document (r0).')
		// The why list is a real list.
		await expect(page.getByTestId('explain-why-list'))
			.toHaveJSProperty('tagName', 'UL')
		// Current values: State and Properties of the widget itself, without Methods.
		await expect(page.getByTestId('explain-values')
			.locator('[data-testid="runtime-value-row"][data-member="answer"]'))
			.toBeVisible()
		await expect(page.getByTestId('explain-values')
			.getByRole('heading', { name: /^Methods/ }))
			.toHaveCount(0)

		await previewFrame(page)
			.getByRole('radio', { name: 'On site' })
			.check()
		await expect(options.getByTestId('explain-why-sentence'))
			.toHaveText('options reads #mode\'s value (now: "onsite")')
	})

	test('clicking a Used-by entry selects that widget everywhere', async ({ page }) => {
		await openLab(page)
		await explainTab(page)
			.click()
		await inspectWidget(page, 'How will you join?')
		await expect(identity(page)
			.getByRole('heading'))
			.toHaveText('#mode SingleChoice')

		const usedBy = page.getByTestId('explain-used-by')
		await expect(usedBy.getByTestId('explain-relation'))
			.toHaveCount(4)
		await usedBy.locator('[data-testid="explain-relation"][data-widget="guests"]')
			.getByRole('button', { name: 'Select widget #guests' })
			.click()

		await expect(identity(page)
			.getByRole('heading'))
			.toHaveText('#guests Numeric')
		await expect(why(page, 'visible', 'mode')
			.getByTestId('explain-why-field'))
			.toContainText('visibleWhen')
		// Shared selection: the Selected widget pane follows.
		await page.getByRole('tab', { name: 'Selected widget', exact: true })
			.click()
		await expect(page.getByTestId('selected-widget-declaration')
			.getByRole('heading', { name: 'guests : Numeric' }))
			.toBeVisible()
	})

	test('Open dependency graph shows the Graph in the Dependencies tab', async ({ page }) => {
		await openLab(page)
		await explainTab(page)
			.click()
		await inspectWidget(page, 'Phone number')
		// From the keyboard, as a keyboard user would.
		await page.getByTestId('explain-open-graph')
			.focus()
		await page.keyboard.press('Enter')

		await expect(page.getByRole('tab', { name: 'Dependencies', exact: true }))
			.toHaveAttribute('aria-selected', 'true')
		const graphTab = page.getByRole('tablist', { name: 'Dependencies views' })
			.getByRole('tab', { name: 'Graph' })
		await expect(graphTab)
			.toHaveAttribute('aria-selected', 'true')
		// Focus lands on the Graph tab, not on the page.
		await expect(graphTab)
			.toBeFocused()
		await expect(page.locator('.vue-flow__node-cluster')
			.first())
			.toBeVisible({ timeout: 15_000 })
	})

	test('says which version the values come from while the Preview shows an older one', async ({ page }) => {
		await openLab(page)
		await explainTab(page)
			.click()
		await inspectWidget(page, 'Phone number')
		await loadPreset(page, 'survey-ai-draft')
		await explainTab(page)
			.click()

		await expect(explain(page))
			.toHaveAttribute('data-runtime-state', 'diverged')
		await expect(identity(page)
			.getByRole('heading'))
			.toHaveText('#phone ShortAnswer')
		await expect(page.getByTestId('explain-values-source'))
			.toHaveText('No current values: the preview shows the last valid version (r0), not the current document (r1).')
		await expect(explain(page)
			.getByTestId('explain-live-value'))
			.toHaveCount(0)
		await expect(page.getByTestId('explain-values-message'))
			.toContainText('The preview shows the last valid version (r0)')
	})

	test('with nothing chosen while the Preview is older, the card points to the Structure tree (Inspect opens Runtime then)', async ({ page }) => {
		await openLab(page)
		await loadPreset(page, 'survey-ai-draft')
		await explainTab(page)
			.click()

		await expect(page.getByTestId('explain-empty-hint'))
			.toHaveText('The preview shows an older version of the document, so Inspect opens Runtime instead. Select a widget in the Structure tree to see what it is and why it behaves this way.')
		await setLocale(page, 'zh-TW')
		await expect(page.getByTestId('explain-empty-hint'))
			.toHaveText('預覽顯示的是較舊版本的 document，所以「檢視」會改開 Runtime。請在「結構」樹中點選 widget，就能看到它是什麼，以及它為什麼會這樣運作。')
	})

	test('speaks Taiwan Chinese', async ({ page }) => {
		await openLab(page)
		await setLocale(page, 'zh-TW')
		await explainTab(page, '說明')
			.click()
		await expect(page.getByTestId('explain-empty'))
			.toContainText('在 Preview 用「檢視」點選 widget，或在「結構」樹中點選')

		await inspectWidget(page, 'Sessions you want to join', '檢視')
		await expect(page.getByRole('heading', { name: '為什麼會這樣運作' }))
			.toBeVisible()
		await expect(why(page, 'options', 'mode')
			.getByTestId('explain-why-sentence'))
			.toHaveText('options 讀取 #mode 的 value（目前：沒有值）')
		await expect(page.getByTestId('explain-open-graph'))
			.toHaveText('開啟相依性關係圖')
		await expect(page.getByRole('heading', { name: '它依賴的 widget' }))
			.toBeVisible()
		await expect(why(page, 'options', 'mode')
			.getByRole('button', { name: '選取 widget #mode' }))
			.toBeVisible()
		await expect(page.getByTestId('explain-declaration')
			.locator('summary'))
			.toContainText('宣告細節')
	})
})
