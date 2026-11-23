import type { Locator, Page } from '@playwright/test'
import { expect, loadPreset, openTool, previewFrame, setLocale, test, toolTab, workbenchTab } from './fixtures'

/**
 * Issue #230 PR 3b (audit U10, U25): the Selected widget pane shows the Blueprint declaration and the Runtime
 * values of the inspected widget together; Runtime values expand instead of clipping, and what the Inspector
 * snapshot cut is marked as such; raw and resolved config are not printed twice. Since Lab UX phase 3B it is an expert view of the
 * Tools menu, opened in the Tools group beside the Preview.
 */

async function openLab(page: Page, query = 'showcase=survey'): Promise<void> {
	await page.goto(`/?${query}`)
	await expect(workbenchTab(page, 'edit'))
		.toBeVisible()
}

/** Selects a widget in the Blueprint tree and opens the Selected widget pane on it. */
async function selectWidget(page: Page, label: RegExp): Promise<void> {
	await openTool(page, 'blueprint')
	await page.getByRole('button', { name: label })
		.first()
		.click()
	await openTool(page, 'widget')
}

const declaration = (page: Page): Locator => page.getByTestId('selected-widget-declaration')
const runtime = (page: Page): Locator => page.getByTestId('selected-widget-runtime')
function row(page: Page, member: string): Locator {
	return runtime(page)
		.locator(`[data-testid="runtime-value-row"][data-member="${member}"]`)
}

test.describe('selected widget pane', () => {
	test('shows the declaration and the Runtime values of the same widget at the same time', async ({ page }) => {
		await openLab(page)
		await selectWidget(page, /sessions : MultipleChoice/)

		await expect(declaration(page))
			.toBeVisible()
		await expect(runtime(page))
			.toBeVisible()
		await expect(declaration(page)
			.getByRole('heading', { name: 'sessions : MultipleChoice' }))
			.toBeVisible()
		await expect(declaration(page)
			.getByTestId('config-view'))
			.toBeVisible()
		// Runtime half: the same widget's State and Properties with live values.
		for (const member of ['answer', 'text', 'visible', 'required', 'options', 'value', 'errors']) {
			await expect(row(page, member))
				.toBeVisible()
		}
		await expect(row(page, 'visible')
			.getByTestId('value-summary'))
			.toHaveText('true')

		// Side by side at the default width, with nothing clipped.
		const [d, r] = await Promise.all([declaration(page)
			.boundingBox(), runtime(page)
			.boundingBox()])
		expect(r!.x, 'Runtime values sit to the right of the declaration')
			.toBeGreaterThanOrEqual(d!.x + d!.width - 1)
		expect(Math.abs(r!.y - d!.y), 'on the same row')
			.toBeLessThan(2)
	})

	test('stacks the two halves when the pane is narrow, without horizontal overflow', async ({ page }) => {
		await page.setViewportSize({ width: 1280, height: 800 })
		await openLab(page)
		await selectWidget(page, /sessions : MultipleChoice/)
		const sash = (await page.locator('.dv-sash')
			.first()
			.boundingBox())!
		await page.mouse.move(sash.x + 2, sash.y + 120)
		await page.mouse.down()
		// The view is in the Tools group, in the Preview's column (Lab UX phase 3B): moving the divider right narrows it.
		await page.mouse.move(sash.x + 130, sash.y + 120, { steps: 6 })
		await page.mouse.up()

		const pane = page.getByTestId('selected-widget')
		await expect.poll(async () => (await pane.boundingBox())!.width)
			.toBeLessThan(560)
		const [d, r] = await Promise.all([declaration(page)
			.boundingBox(), runtime(page)
			.boundingBox()])
		expect(r!.y, 'Runtime values below the declaration')
			.toBeGreaterThanOrEqual(d!.y + d!.height - 1)
		expect(await pane.evaluate(element => element.scrollWidth <= element.clientWidth + 1))
			.toBe(true)
	})

	test('follows what Inspect selects in the Preview', async ({ page }) => {
		await openLab(page)
		await openTool(page, 'widget')
		await page.getByRole('button', { name: 'Inspect', exact: true })
			.click()
		await previewFrame(page)
			.getByText('Phone number', { exact: true })
			.click()

		// Lab UX phase 3B: a linked Inspect no longer opens this expert view (Explain is the newcomer's view of the widget), but the
		// open view follows the selection.
		await expect(toolTab(page, 'widget'))
			.toHaveAttribute('aria-selected', 'true')
		await expect(declaration(page)
			.getByRole('heading', { name: 'phone : ShortAnswer' }))
			.toBeVisible()
		await expect(row(page, 'required'))
			.toBeVisible()
	})

	test('Runtime values stay live: answering in the Preview updates the open pane', async ({ page }) => {
		await openLab(page)
		await selectWidget(page, /mode : SingleChoice/)
		await expect(row(page, 'answer')
			.getByTestId('value-summary'))
			.toHaveText('null')

		await previewFrame(page)
			.getByRole('radio', { name: 'On site' })
			.check()
		await expect(row(page, 'answer')
			.getByTestId('value-summary'))
			.toHaveText('"onsite"')
	})

	test('says why there are no Runtime values while the Preview shows an older version', async ({ page }) => {
		await openLab(page)
		await loadPreset(page, 'survey-ai-draft')
		await openTool(page, 'widget')

		await expect(page.getByTestId('selected-widget'))
			.toHaveAttribute('data-runtime-state', 'diverged')
		await expect(page.getByTestId('selected-widget-runtime-message'))
			.toContainText('The preview shows the last valid version (r0), not the current document (r1)')
		// The declaration half still works for the (invalid) current document.
		await expect(declaration(page)
			.getByRole('heading', { name: 'open-day : Survey' }))
			.toBeVisible()
	})

	test('says an unresolved widget has no Runtime', async ({ page }) => {
		await openLab(page)
		await loadPreset(page, 'survey-ai-draft')
		await selectWidget(page, /rating : StarRating/)

		await expect(page.getByTestId('selected-widget'))
			.toHaveAttribute('data-runtime-state', 'unresolved')
		await expect(page.getByTestId('selected-widget-runtime-message'))
			.toHaveText('This widget did not resolve, so it has no Runtime.')
	})
})

test.describe('runtime values do not clip (U10)', () => {
	test('a long value takes the room it has, expands in full, shows deep values as a tree and collapses again', async ({ page }) => {
		await page.setViewportSize({ width: 1920, height: 1080 })
		await openLab(page)
		await selectWidget(page, /open-day : Survey/)

		const response = row(page, 'response')
		const summary = response.getByTestId('value-summary')
		const expand = response.getByTestId('value-expand')
		// Was clipped at 160px with no way to read the rest.
		expect((await summary.boundingBox())!.width, 'summary is not capped at 160px')
			.toBeGreaterThan(200)
		await expect(response.getByTestId('value-select'))
			.toHaveAttribute('title', /"answers"/)

		await expect(expand)
			.toHaveAttribute('aria-expanded', 'false')
		await expect(response.getByTestId('value-detail'))
			.toHaveCount(0)
		await expand.click()
		await expect(expand)
			.toHaveAttribute('aria-expanded', 'true')
		const detail = response.getByTestId('value-detail')
		await expect(detail)
			.toBeVisible()
		await expect(detail)
			.toContainText('answers')
		await expect(detail)
			.toContainText('guests')

		// Nested containers have their own disclosure; closing one hides its entries, opening it brings them back.
		const inner = detail.getByTestId('value-toggle')
		expect(await inner.count())
			.toBeGreaterThan(2)
		const second = inner.nth(1)
		const controlled = detail.locator(`#${await second.getAttribute('aria-controls')}`)
		await expect(second)
			.toHaveAttribute('aria-expanded', 'true')
		await expect(controlled)
			.toBeVisible()
		await second.click()
		await expect(second)
			.toHaveAttribute('aria-expanded', 'false')
		await expect(controlled)
			.toBeHidden()
		await second.click()
		await expect(controlled)
			.toBeVisible()

		await expand.click()
		await expect(response.getByTestId('value-detail'))
			.toHaveCount(0)
		await expect(expand)
			.toHaveAttribute('aria-expanded', 'false')
	})

	test('a value the Inspector snapshot cut says so, where it was cut', async ({ page }) => {
		await page.setViewportSize({ width: 1920, height: 1080 })
		await openLab(page)
		await selectWidget(page, /open-day : Survey/)

		const response = row(page, 'response')
		await response.getByTestId('value-expand')
			.click()
		// `response.answers.<id>.errors` sits below the Inspector's depth limit: not `<truncated>` text, a clear note.
		const marks = response.getByTestId('value-detail')
			.getByTestId('value-truncated')
		await expect(marks.first())
			.toHaveText('… truncated by the Inspector snapshot (nested too deeply)')
		await expect(response.getByTestId('value-snapshot-note'))
			.toContainText('left out by the Inspector snapshot')
		await expect(response.getByTestId('value-detail'))
			.not
			.toContainText('<truncated>')
	})

	test('the disclosure works from the keyboard and is named for the member', async ({ page }) => {
		await openLab(page)
		await selectWidget(page, /mode : SingleChoice/)

		const expand = row(page, 'options')
			.getByTestId('value-expand')
		await expect(expand)
			.toHaveAccessibleName('Value of options')
		// Closed: it controls nothing yet (no dangling `aria-controls`).
		await expect(expand)
			.not
			.toHaveAttribute('aria-controls')
		await expand.focus()
		await page.keyboard.press('Enter')
		await expect(expand)
			.toHaveAttribute('aria-expanded', 'true')
		await expect(expand)
			.toHaveAccessibleName('Value of options')
		const controlled = await expand.getAttribute('aria-controls')
		expect(controlled)
			.not
			.toBeNull()
		await expect(page.locator(`#${controlled}`))
			.toBeVisible()
		await page.keyboard.press('Space')
		await expect(expand)
			.toHaveAttribute('aria-expanded', 'false')
	})

	test('an open value does not carry over to another widget\'s member of the same name', async ({ page }) => {
		await openLab(page)
		await selectWidget(page, /mode : SingleChoice/)
		await row(page, 'options')
			.getByTestId('value-expand')
			.click()
		await expect(row(page, 'options')
			.getByTestId('value-detail'))
			.toBeVisible()

		// `sessions` has an `options` Property too: it starts closed.
		await selectWidget(page, /sessions : MultipleChoice/)
		await expect(declaration(page)
			.getByRole('heading', { name: 'sessions : MultipleChoice' }))
			.toBeVisible()
		await expect(row(page, 'options')
			.getByTestId('value-expand'))
			.toHaveAttribute('aria-expanded', 'false')
		await expect(row(page, 'options')
			.getByTestId('value-detail'))
			.toHaveCount(0)
	})

	test('selecting a member row does not toggle its value, and vice versa', async ({ page }) => {
		await openLab(page)
		await selectWidget(page, /mode : SingleChoice/)

		const options = row(page, 'options')
		await options.getByTestId('value-select')
			.click()
		await expect(options.getByTestId('value-detail'))
			.toHaveCount(0)
		await options.getByTestId('value-expand')
			.click()
		await expect(options.getByTestId('value-detail'))
			.toBeVisible()
	})
})

test.describe('config view (U25)', () => {
	test('resolved config first, the authored one on request, never both at once', async ({ page }) => {
		await openLab(page)
		await selectWidget(page, /open-day : Survey/)

		const view = declaration(page)
			.getByTestId('config-view')
		await expect(view)
			.toHaveAttribute('data-config-state', 'different')
		await expect(view.getByTestId('config-show-resolved'))
			.toHaveAttribute('aria-pressed', 'true')
		await expect(view.getByTestId('config-differs-note'))
			.toContainText('Differs in: recovered')
		await expect(view.getByTestId('config-json'))
			.toContainText('"recovered": false')
		await expect(view.locator('pre'))
			.toHaveCount(1)

		await view.getByTestId('config-show-authored')
			.click()
		await expect(view.getByTestId('config-show-authored'))
			.toHaveAttribute('aria-pressed', 'true')
		await expect(view.getByTestId('config-json'))
			.not
			.toContainText('recovered')
		await expect(view.getByTestId('config-json'))
			.toContainText('"title"')
		await expect(view.locator('pre'))
			.toHaveCount(1)

		await view.getByTestId('config-show-resolved')
			.click()
		await expect(view.getByTestId('config-json'))
			.toContainText('"recovered": false')
	})

	test('a config that resolved to what was written is shown once, with a note', async ({ page }) => {
		await openLab(page, 'showcase=sandbox')
		await selectWidget(page, /title : Text/)

		const view = declaration(page)
			.getByTestId('config-view')
		await expect(view)
			.toHaveAttribute('data-config-state', 'same')
		await expect(view.getByTestId('config-same-note'))
			.toHaveText('The resolved config is identical to the authored config.')
		await expect(view.locator('pre'))
			.toHaveCount(1)
		await expect(view.getByTestId('config-show-authored'))
			.toHaveCount(0)
	})

	test('the Blueprint panel shows the same single config view', async ({ page }) => {
		await openLab(page)
		await openTool(page, 'blueprint')
		await page.getByRole('button', { name: /open-day : Survey/ })
			.first()
			.click()
		await expect(page.getByRole('tabpanel', { name: 'Blueprint tree' })
			.getByTestId('config-view')
			.locator('pre'))
			.toHaveCount(1)
	})
})

test.describe('zh-TW', () => {
	test('the pane, its sections and the value controls are translated', async ({ page }) => {
		await openLab(page)
		await setLocale(page, 'zh-TW')
		await selectWidgetZh(page)

		await expect(page.getByRole('heading', { name: /宣告/ }))
			.toBeVisible()
		await expect(page.getByRole('heading', { name: /Runtime 的值/ }))
			.toBeVisible()
		await expect(row(page, 'options')
			.getByTestId('value-expand'))
			.toHaveAccessibleName('options 的值')
		await expect(declaration(page)
			.getByTestId('config-show-authored'))
			.toHaveText('原始寫法')
	})

	async function selectWidgetZh(page: Page): Promise<void> {
		await selectWidget(page, /mode : SingleChoice/)
		await expect(toolTab(page, 'widget'))
			.toHaveAccessibleName('選取的 widget')
	}
})
