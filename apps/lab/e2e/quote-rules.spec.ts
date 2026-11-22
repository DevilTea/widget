import type { Locator, Page } from '@playwright/test'
import { chooseTutorialMenuItem, expect, expectDocumentStatus, expectPreviewStatus, expectShowcase, loadPreset, openAuthorJson, previewFrame, selectShowcase, setLocale, setTheme, test } from './fixtures'

/**
 * Quote rules acceptance contract (issue #230, showcase 2): the Corner Press print job quote
 * (`showcases/quote-rules/presets.ts`, preset `quote-default`) in the Examples menu next to the survey and the trip.
 *
 * Covers selecting it (menu and `?showcase=`); the same rules in the page and in a real Web Worker with no DOM, side by
 * side, from JSON text only; the schema library's own messages as located problems; the config JSON Schema driving the
 * Structure editor; a rule that throws and the page that receives the isolated exception through the host's handler
 * instead of crashing; theme, accessibility minimums, the guided tour and zh-TW.
 *
 * The renderers write on the native `input`/`change` event, so a plain `.fill()`, `.check()` or `.selectOption()` is
 * enough. Nothing here retries an action or waits a fixed time: every wait is for a state the page reaches.
 */

async function openQuote(page: Page, query = ''): Promise<void> {
	await page.goto(`/?showcase=quote-rules${query}`)
	await expect(previewFrame(page)
		.getByRole('heading', { name: /^Corner Press: print job/, level: 1 }))
		.toBeVisible()
}

function widget(page: Page, id: string): Locator {
	return previewFrame(page)
		.locator(`[data-widget-id="${id}"]`)
}

function quantity(page: Page, id: string): Locator {
	return widget(page, id)
		.getByTestId('quote-quantity')
}

/** Everything that went wrong on the page, in the Lab and in the Preview frame, that nobody caught. */
function trackUncaughtErrors(page: Page): string[] {
	const errors: string[] = []
	page.on('pageerror', error => errors.push(error.message))
	return errors
}

/** Opens the buggy-rule quote and waits for it to be on screen (an earlier Preview is still there until it is). */
async function openBuggy(page: Page): Promise<void> {
	await openQuote(page)
	await loadPreset(page, 'quote-buggy-rule')
	await expect(previewFrame(page)
		.getByTestId('quote-total'))
		.toHaveText('€45.75')
}

/** Selects a widget in the Blueprint tree and opens the Selected widget pane on it. */
async function selectWidget(page: Page, label: RegExp): Promise<void> {
	await page.getByRole('tab', { name: 'Blueprint', exact: true })
		.click()
	await page.getByRole('button', { name: label })
		.first()
		.click()
	await page.getByRole('tab', { name: 'Selected widget', exact: true })
		.click()
}

function runtimeRow(page: Page, member: string): Locator {
	return page.getByTestId('selected-widget-runtime')
		.locator(`[data-testid="runtime-value-row"][data-member="${member}"]`)
}

test.describe('selecting the showcase', () => {
	test('is listed in the Examples menu after the survey and the trip, and selecting it shows the quote', async ({ page }) => {
		await page.goto('/')
		await expectShowcase(page, 'survey')

		await page.getByTestId('examples-menu')
			.click()
		const items = page.getByRole('menuitemcheckbox')
		await expect(items.filter({ hasText: 'Quote rules shared by browser and backend' }))
			.toBeVisible()
		await page.keyboard.press('Escape')

		await selectShowcase(page, 'quote-rules')
		await expectShowcase(page, 'quote-rules')
		await expect(previewFrame(page)
			.getByRole('heading', { name: 'Corner Press: print job', level: 1 }))
			.toBeVisible()
		await expect(page.getByTestId('examples-menu'))
			.toHaveAttribute('data-preset-id', 'quote-default')
		await expectDocumentStatus(page, { valid: true })
		await expectPreviewStatus(page, 'current')
	})

	test('?showcase=quote-rules opens it directly, and a reload restores it', async ({ page }) => {
		await openQuote(page)
		await expectShowcase(page, 'quote-rules')
		await page.reload()
		await expect(previewFrame(page)
			.getByRole('heading', { name: 'Corner Press: print job', level: 1 }))
			.toBeVisible()
		await expectShowcase(page, 'quote-rules')
	})

	test('does not leak into the survey: switching back shows the survey, and the default URL still opens it', async ({ page }) => {
		await openQuote(page)
		await selectShowcase(page, 'survey')
		await expect(previewFrame(page)
			.getByRole('heading', { name: 'Maker Space open day: sign-up' }))
			.toBeVisible()
		await page.goto('/')
		await expectShowcase(page, 'survey')
	})
})

test.describe('the same rules in the page and in a Web Worker', () => {
	test('shows the quote the plugins compute, and the very same JSON from a Worker that has no DOM', async ({ page }) => {
		const errors = trackUncaughtErrors(page)
		await openQuote(page)
		const preview = previewFrame(page)

		await expect(preview.getByTestId('quote-total'))
			.toHaveText('€125.30')
		await expect(preview.getByTestId('quote-browser-total'))
			.toHaveText('€125.30')
		await expect(preview.getByTestId('quote-worker-total'))
			.toHaveText('€125.30')
		await expect(preview.getByTestId('quote-comparison'))
			.toHaveAttribute('data-state', 'match')

		// Where each side ran: the page has a document, the Worker has neither a document nor a window.
		await expect(preview.getByTestId('quote-browser-env'))
			.toHaveAttribute('data-has-document', 'true')
		await expect(preview.getByTestId('quote-worker-env'))
			.toHaveAttribute('data-has-document', 'false')
		await expect(preview.getByTestId('quote-worker-env'))
			.toHaveText('No document, no window')

		// A real dedicated Worker from this showcase's own file is running.
		await expect.poll(() => page.workers()
			.map(worker => worker.url()))
			.toEqual(expect.arrayContaining([expect.stringMatching(/quote\.worker/)]))

		// The two outcomes are the same JSON text.
		await preview.getByTestId('quote-browser-json-toggle')
			.click()
		await preview.getByTestId('quote-worker-json-toggle')
			.click()
		const browserJson = await preview.getByTestId('quote-browser-json')
			.textContent() ?? ''
		expect(browserJson)
			.toContain('"totalCents": 12530')
		await expect(preview.getByTestId('quote-worker-json'))
			.toHaveText(browserJson)
		expect(errors)
			.toEqual([])
	})

	test('follows every answer: the two columns move together and still match, as the amounts the page shows', async ({ page }) => {
		await openQuote(page)
		const preview = previewFrame(page)

		await quantity(page, 'flyers')
			.fill('600')
		await widget(page, 'rush')
			.getByTestId('quote-rush')
			.check()
		await widget(page, 'delivery')
			.getByTestId('quote-delivery')
			.selectOption('courier')

		// 600 x 9 + 3500 + 2900 = 11800; 5% off 590; rush 25% 2950; courier 900; taxable 15060; tax 21% 3163; total 18223
		await expect(preview.getByTestId('quote-total'))
			.toHaveText('€182.23')
		await expect(preview.getByTestId('quote-browser-total'))
			.toHaveText('€182.23')
		await expect(preview.getByTestId('quote-worker-total'))
			.toHaveText('€182.23')
		await expect(preview.getByTestId('quote-comparison'))
			.toHaveAttribute('data-state', 'match')
	})

	test('"Start over" puts every answer back, in the page and in the worker column', async ({ page }) => {
		await openQuote(page)
		const preview = previewFrame(page)
		await quantity(page, 'cards')
			.fill('1000')
		await expect(preview.getByTestId('quote-worker-total'))
			.not
			.toHaveText('€125.30')
		await preview.getByTestId('quote-start-over')
			.click()
		await expect(quantity(page, 'cards'))
			.toHaveValue('250')
		await expect(preview.getByTestId('quote-worker-total'))
			.toHaveText('€125.30')
		await expect(preview.getByTestId('quote-comparison'))
			.toHaveAttribute('data-state', 'match')
	})

	test('refuses a quantity the schema library refuses, keeps the stored one and says why until a valid one is stored', async ({ page }) => {
		await openQuote(page)
		const error = widget(page, 'flyers')
			.getByTestId('quote-quantity-error')
		// The polite live region is rendered (not display: none) before any message arrives, so it is announced.
		const region = widget(page, 'flyers')
			.locator('[aria-live="polite"]')
		await expect(region)
			.toBeEmpty()
		expect(await region.evaluate(element => getComputedStyle(element).display))
			.not
			.toBe('none')
		await quantity(page, 'flyers')
			.fill('0')
		await expect(error)
			.toContainText('Invalid value: Expected >=1 but received 0')
		await expect(quantity(page, 'flyers'))
			.toHaveAttribute('aria-invalid', 'true')
		await expect(previewFrame(page)
			.getByTestId('quote-total'))
			.toHaveText('€125.30')
		await expect(quantity(page, 'flyers'))
			.toHaveValue('500')
		// Clearing the field is refused out loud too.
		await quantity(page, 'flyers')
			.fill('')
		await expect(error)
			.toContainText('Invalid type')
		await quantity(page, 'flyers')
			.fill('510')
		await expect(error)
			.toHaveCount(0)
		await expect(previewFrame(page)
			.getByTestId('quote-total'))
			.not
			.toHaveText('€125.30')
	})
})

test.describe('the schema library\'s own messages', () => {
	test('the invalid-config preset has six located problems with the library\'s messages, word for word, and the preview keeps the last working version', async ({ page }) => {
		await openQuote(page)
		await loadPreset(page, 'quote-invalid')

		await expectDocumentStatus(page, { problems: 6 })
		await expectPreviewStatus(page, 'stale')
		// Author opens on Structure: the Problems list is under the JSON editor.
		await openAuthorJson(page)
		const problems = page.getByTestId('author-problems')
		await expect(problems)
			.toHaveAttribute('data-problem-count', '6')
		const rows = problems.getByTestId('problem-row')
		await expect(rows)
			.toHaveCount(6)
		const expected: readonly [string, string][] = [
			['Invalid type: Expected number but received "9"', 'widget "flyers : Item"'],
			['Invalid integer: Received 2.5', 'widget "cards : Item"'],
			['Invalid key: Expected never but received "finish"', 'widget "cards : Item"'],
			['Invalid value: Expected <=100 but received 120', 'widget "volume : VolumeDiscount"'],
			['Invalid key: Expected "en" but received undefined', 'widget "rush : RushSurcharge"'],
			['Invalid format: Expected /^[A-Z]{3}$/ but received "euro"', 'widget "quote : Quote"'],
		]
		for (const [index, [message, location]] of expected.entries()) {
			await expect(rows.nth(index))
				.toContainText(message)
			await expect(rows.nth(index))
				.toContainText(location)
		}
		await expect(previewFrame(page)
			.getByRole('heading', { name: 'Corner Press: print job', level: 1 }))
			.toBeVisible()
	})
})

test.describe('the config JSON Schema', () => {
	interface LabTestWindow {
		__WIDGET_LAB_TEST__?: { getDocumentSourceText: () => string }
	}

	async function openStructure(page: Page, widgetLabel: RegExp): Promise<Locator> {
		await page.goto('/?lab-test&showcase=quote-rules')
		await expect(previewFrame(page)
			.getByRole('heading', { name: 'Corner Press: print job', level: 1 }))
			.toBeVisible()
		await page.getByRole('tab', { name: 'Author', exact: true })
			.click()
		await page.getByRole('tab', { name: 'Structure', exact: true })
			.click()
		await page.getByRole('button', { name: widgetLabel })
			.click()
		const editor = page.getByTestId('structure-editor')
		await expect(editor)
			.toBeVisible()
		return editor
	}

	async function documentSource(page: Page): Promise<any> {
		return JSON.parse(await page.evaluate(() => (window as unknown as LabTestWindow).__WIDGET_LAB_TEST__!.getDocumentSourceText()))
	}

	test('offers a list of tiers with Add and Remove, number boxes and the schema\'s help text, from the plugin\'s published schema', async ({ page }) => {
		const editor = await openStructure(page, /volume : VolumeDiscount/)
		const tiers = editor.locator('[role="group"][aria-label="tiers"]')
		const removers = tiers.getByRole('button', { name: /^Remove #\d+$/ })
		await expect(removers)
			.toHaveCount(3)
		await expect(editor.locator('[data-config-path="tiers.1.percent"] [title="The percentage taken off the subtotal."]')
			.first())
			.toBeVisible()

		await editor.locator('[data-config-path="tiers.1.percent"]')
			.getByRole('textbox')
			.fill('7')
		await editor.locator('[data-config-path="tiers.1.percent"]')
			.getByRole('textbox')
			.press('Enter')
		await expect(page.getByTestId('author-command-outcome'))
			.toContainText('Change applied')
		expect((await documentSource(page)).slots.rules[0].config.tiers[1].percent)
			.toBe(7)
		// The change reaches the page: 752 pieces is in the 300 tier, now 7% of 10900 = 763 off.
		await expect(previewFrame(page)
			.locator('[data-widget-id="volume"] [data-testid="quote-rule-amount"]'))
			.toHaveText('−€7.63')

		await tiers.getByRole('button', { name: 'Remove #3' })
			.click()
		await expect(removers)
			.toHaveCount(2)
		await tiers.getByRole('button', { name: 'Add item to tiers' })
			.click()
		await expect(removers)
			.toHaveCount(3)
		expect((await documentSource(page)).slots.rules[0].config.tiers)
			.toHaveLength(3)
	})

	test('offers a list for an enum and a switch for a boolean, and Catalog shows the very same schema', async ({ page }) => {
		const delivery = await openStructure(page, /delivery : Delivery/)
		await expect(delivery.locator('[data-config-path="freeOverCents"]'))
			.toBeVisible()
		await delivery.getByRole('combobox', { name: 'Optional field to add to config' })
			.selectOption('method')
		await delivery.getByRole('button', { name: 'Add field' })
			.click()
		const method = delivery.locator('[data-config-path="method"]')
		await expect(method.getByRole('combobox'))
			.toBeVisible()
		await expect(method.getByRole('combobox')
			.locator('option'))
			.toHaveText(['pickup', 'courier'])

		await page.getByRole('button', { name: /rush : RushSurcharge/ })
			.click()
		await page.getByTestId('structure-editor')
			.getByRole('combobox', { name: 'Optional field to add to config' })
			.selectOption('enabled')
		await page.getByTestId('structure-editor')
			.getByRole('button', { name: 'Add field' })
			.click()
		await expect(page.getByTestId('structure-editor')
			.locator('[data-config-path="enabled"]')
			.getByRole('switch'))
			.toBeVisible()

		await page.getByRole('tab', { name: 'Catalog', exact: true })
			.click()
		const entry = page.getByTestId('author-catalog-VolumeDiscount')
		await expect(entry)
			.toContainText('Valibot schema through Standard Schema')
		const schema = page.getByTestId('author-catalog-schema-VolumeDiscount')
		await schema.locator('summary')
			.click()
		await expect(schema)
			.toContainText('"minItems": 1')
		await expect(schema)
			.toContainText('The percentage taken off the subtotal.')
	})
})

test.describe('a rule that throws', () => {
	test('the page survives, says the amounts are the last that worked, and lists the isolated exception; raising the quantity recovers', async ({ page }) => {
		const errors = trackUncaughtErrors(page)
		await openBuggy(page)
		const preview = previewFrame(page)
		await expectDocumentStatus(page, { valid: true })
		await expect(preview.getByTestId('quote-stale'))
			.toHaveCount(0)
		await expect(preview.getByTestId('quote-isolated'))
			.toHaveAttribute('data-count', '0')

		// 50 + 2 = 52 pieces: below the first tier (100), so the rule's code throws a TypeError.
		await quantity(page, 'flyers')
			.fill('50')

		await expect(preview.getByTestId('quote-stale'))
			.toBeVisible()
		await expect(quantity(page, 'flyers'))
			.toHaveValue('50')
		// What the page still shows is the last quote that worked.
		await expect(preview.getByTestId('quote-total'))
			.toHaveText('€45.75')
		const entries = preview.getByTestId('quote-isolated-entry')
		await expect(entries)
			.toHaveCount(1)
		await expect(entries.first())
			.toContainText('TypeError')
		await expect(entries.first())
			.toContainText('from volume.adjustment')
		await expect(widget(page, 'volume'))
			.toHaveAttribute('data-state', 'threw')
		// One alert for the whole page (the stale banner), not one per card.
		await expect(preview.locator('[role="alert"]'))
			.toHaveCount(1)
		// The worker, which read the same document and answers, threw the same exception: the two columns agree.
		await expect(preview.getByTestId('quote-browser-failure'))
			.toContainText('volume.adjustment threw TypeError')
		await expect(preview.getByTestId('quote-worker-failure'))
			.toHaveText(await preview.getByTestId('quote-browser-failure')
				.textContent() ?? '')
		await expect(preview.getByTestId('quote-comparison'))
			.toHaveAttribute('data-state', 'match')
		// Core handed the exception to the page's handler: nothing reached the page as an uncaught error.
		expect(errors)
			.toEqual([])

		await quantity(page, 'flyers')
			.fill('300')
		await expect(preview.getByTestId('quote-stale'))
			.toHaveCount(0)
		// 300 x 9 + 2900 = 5600; 5% = 280; taxable 5320; tax 21% = 1117; total 6437
		await expect(preview.getByTestId('quote-total'))
			.toHaveText('€64.37')
		await expect(widget(page, 'volume'))
			.toHaveAttribute('data-state', 'applied')
		await expect(entries)
			.toHaveCount(1)
		await preview.getByTestId('quote-isolated-clear')
			.click()
		await expect(preview.getByTestId('quote-isolated'))
			.toHaveAttribute('data-count', '0')
		expect(errors)
			.toEqual([])
	})

	test('the Lab cannot show the exception: the Runtime pane keeps the last completed value of the Property that threw', async ({ page }) => {
		await openBuggy(page)
		await quantity(page, 'flyers')
			.fill('50')
		await expect(previewFrame(page)
			.getByTestId('quote-stale'))
			.toBeVisible()

		await selectWidget(page, /volume : VolumeDiscount/)
		const row = runtimeRow(page, 'adjustment')
		await expect(row)
			.toBeVisible()
		// Core's inspection reports only a Property's latest completed result; a `compute` that threw completed nothing.
		await expect(row.getByTestId('value-summary'))
			.not
			.toContainText('Failed')
		await expect(row.getByTestId('value-summary'))
			.not
			.toContainText('Never evaluated')
	})
})

test.describe('theme', () => {
	test('paints from its own tokens and follows the Lab theme, light and dark', async ({ page }) => {
		await openQuote(page)
		const root = previewFrame(page)
			.locator('.quote')
		const background = (): Promise<string> => root.evaluate(element => getComputedStyle(element).backgroundColor)

		await setTheme(page, 'light')
		await expect(root)
			.toHaveAttribute('data-quote-theme', 'light')
		expect(await background())
			.toBe('rgb(246, 247, 249)')

		await setTheme(page, 'dark')
		await expect(root)
			.toHaveAttribute('data-quote-theme', 'dark')
		expect(await background())
			.toBe('rgb(20, 22, 26)')
	})
})

test.describe('accessibility minimums', () => {
	test('every control is labelled and at least 24px, text is at least 11px, there is one main landmark, and focus is visible', async ({ page }) => {
		await openQuote(page)
		const preview = previewFrame(page)

		// Keyboard first (a mouse click before it would make a later programmatic focus look like pointer focus): a
		// disclosure is a button that Enter toggles, and a focused control shows a focus ring.
		const toggle = preview.getByTestId('quote-browser-json-toggle')
		await expect(toggle)
			.toHaveAttribute('aria-expanded', 'false')
		await toggle.focus()
		const outline = await toggle.evaluate(element => getComputedStyle(element).outlineStyle)
		expect(outline)
			.not
			.toBe('none')
		await page.keyboard.press('Enter')
		await expect(toggle)
			.toHaveAttribute('aria-expanded', 'true')
		await preview.getByTestId('quote-worker-json-toggle')
			.click()

		const controls = preview.locator('input, select, button')
		expect(await controls.count())
			.toBeGreaterThan(8)
		const problems = await controls.evaluateAll(elements => elements.flatMap((element) => {
			const box = element.getBoundingClientRect()
			const labelled = element.tagName === 'BUTTON'
				? (element.textContent ?? '').trim() !== ''
				: ((element as HTMLInputElement).labels?.length ?? 0) > 0
			const issues: string[] = []
			if (!labelled)
				issues.push('unlabelled')
			// A checkbox is 18px but its label is the target; the label is at least 28px tall.
			const target = element instanceof HTMLInputElement && element.type === 'checkbox' ? element.labels?.[0]?.getBoundingClientRect() ?? box : box
			if (target.height < 24 || target.width < 24)
				issues.push(`target ${Math.round(target.width)}x${Math.round(target.height)}`)
			return issues.length === 0 ? [] : [`${element.outerHTML.slice(0, 80)}: ${issues.join(', ')}`]
		}))
		expect(problems)
			.toEqual([])

		const font = await preview.locator('.quote')
			.evaluateAll((roots) => {
				const sizes = new Set<number>()
				for (const element of roots[0]!.querySelectorAll('*')) {
					if ((element.textContent ?? '').trim() !== '' && element.children.length === 0)
						sizes.add(Number.parseFloat(getComputedStyle(element).fontSize))
				}
				return Math.min(...sizes)
			})
		expect(font)
			.toBeGreaterThanOrEqual(11)

		await expect(preview.getByRole('main'))
			.toHaveCount(1)
		await expect(preview.getByRole('heading', { level: 1 }))
			.toHaveCount(1)
		// The scrollable JSON is reachable by keyboard.
		await expect(preview.getByTestId('quote-browser-json'))
			.toHaveAttribute('tabindex', '0')
	})
})

test.describe('tutorial', () => {
	const RAIL = 'Tutorial'

	test('walks the same rules in a worker, the rules as widgets, the schema, the library\'s messages and the isolated exception with real interactions, then restarts', async ({ page }) => {
		await openQuote(page)
		await chooseTutorialMenuItem(page)
		const rail = page.getByRole('complementary', { name: RAIL })
		await expect(rail)
			.toBeVisible()
		const next = page.getByRole('button', { name: 'Next', exact: true })
		const preview = previewFrame(page)

		// 1 orient
		await expect(rail.getByText('This is a print shop quote: one JSON definition', { exact: false }))
			.toBeVisible()
		await expect(next)
			.toBeEnabled()
		await next.click()

		// 2 the same rules outside the page
		const sameObservation = rail.getByText('Both columns moved, and both show the same JSON.', { exact: false })
		await expect(sameObservation)
			.toHaveCount(0)
		await expect(next)
			.toBeDisabled()
		await expect(preview.locator('[data-tutorial-target="quote-same-rules"]'))
			.toHaveClass(/tutorial-spotlight/)
		await quantity(page, 'flyers')
			.fill('520')
		await expect(sameObservation)
			.toBeVisible()
		await rail.getByRole('button', { name: 'See answers and quote in Selected widget' })
			.click()
		await expect(page.getByRole('tab', { name: 'Selected widget', exact: true }))
			.toHaveAttribute('aria-selected', 'true')
		await next.click()

		// 3 rules are widgets: both answers are needed.
		const rulesObservation = rail.getByText('Each rule is its own plugin with its own State', { exact: false })
		await expect(rulesObservation)
			.toHaveCount(0)
		await expect(preview.locator('[data-tutorial-target="quote-rush"]'))
			.toHaveClass(/tutorial-spotlight/)
		await widget(page, 'rush')
			.getByTestId('quote-rush')
			.check()
		await expect(rulesObservation)
			.toHaveCount(0)
		await widget(page, 'delivery')
			.getByTestId('quote-delivery')
			.selectOption('courier')
		await expect(rulesObservation)
			.toBeVisible()
		await rail.getByRole('button', { name: 'Follow the chain in Relations' })
			.click()
		await expect(page.getByRole('tab', { name: 'Dependencies', exact: true }))
			.toHaveAttribute('aria-selected', 'true')
		await next.click()

		// 4 one schema, three jobs
		await expect(rail.getByText('The config of every rule is a Valibot schema used through Standard Schema.', { exact: false }))
			.toBeVisible()
		await rail.getByRole('button', { name: 'Open Author' })
			.click()
		await expect(page.getByRole('tab', { name: 'Author', exact: true }))
			.toHaveAttribute('aria-selected', 'true')
		await next.click()

		// 5 the library's own messages: the visitor loads the invalid preset.
		await expect(rail.getByText('Every message in Problems is Valibot\'s own', { exact: false }))
			.toBeVisible()
		await loadPreset(page, 'quote-invalid')
		await expectDocumentStatus(page, { problems: 6 })
		await next.click()

		// 6 a rule that throws: the visitor loads the buggy-rule preset, then lowers the quantity.
		await loadPreset(page, 'quote-buggy-rule')
		await expectDocumentStatus(page, { valid: true })
		await expect(previewFrame(page)
			.getByTestId('quote-total'))
			.toHaveText('€45.75')
		const throwObservation = rail.getByText('The write succeeded. But the volume rule', { exact: false })
		await expect(throwObservation)
			.toHaveCount(0)
		await expect(next)
			.toBeDisabled()
		await expect(preview.locator('[data-tutorial-target="quote-isolated"]'))
			.toHaveClass(/tutorial-spotlight/)
		await quantity(page, 'flyers')
			.fill('50')
		await expect(throwObservation)
			.toBeVisible()
		await expect(preview.getByTestId('quote-isolated-entry'))
			.toHaveCount(1)
		await next.click()

		// 7 map the views, 8 hand back
		await expect(rail.getByText('Dependencies (Relations, Graph)', { exact: false }))
			.toBeVisible()
		await rail.getByRole('button', { name: 'Runtime', exact: true })
			.click()
		await expect(page.getByRole('tab', { name: 'Runtime', exact: true }))
			.toHaveAttribute('aria-selected', 'true')
		await next.click()
		await page.getByRole('button', { name: 'Finish', exact: true })
			.click()
		await expect(rail)
			.toHaveCount(0)

		// Completed: the header offers a restart, which reloads the teaching example.
		await chooseTutorialMenuItem(page, 'Restart tutorial')
		await expect(page.getByRole('complementary', { name: RAIL }))
			.toBeVisible()
		await expect(quantity(page, 'flyers'))
			.toHaveValue('500')
	})

	test('starting it from the trip runs the trip tour, and leaving the quote ends the quote tour', async ({ page }) => {
		await page.goto('/?showcase=trip-budget')
		await chooseTutorialMenuItem(page)
		await expect(page.getByRole('complementary', { name: RAIL })
			.getByRole('heading', { name: 'This is the Trip budget splitter' }))
			.toBeVisible()
		await page.getByRole('button', { name: 'Skip tour', exact: true })
			.click()

		await selectShowcase(page, 'quote-rules')
		await chooseTutorialMenuItem(page)
		const rail = page.getByRole('complementary', { name: RAIL })
		await expect(rail.getByRole('heading', { name: 'This is the Quote rules showcase' }))
			.toBeVisible()

		await selectShowcase(page, 'survey')
		await expect(rail)
			.toHaveCount(0)
	})
})

test.describe('zh-TW', () => {
	test('translates the Examples menu entries, the tutorial and the Preview, while the quote\'s own texts follow the Lab language', async ({ page }) => {
		await page.goto('/?showcase=quote-rules&lang=zh-TW')
		await expect(previewFrame(page)
			.getByRole('heading', { name: '轉角印刷：印製報價', level: 1 }))
			.toBeVisible()
		await expect(page.getByTestId('examples-showcase'))
			.toHaveText('報價規則：瀏覽器與後端共用')
		const preview = previewFrame(page)
		await expect(preview.getByTestId('quote-start-over'))
			.toHaveText('重新開始')
		await expect(preview.getByRole('heading', { name: '同一組規則，執行兩次' }))
			.toBeVisible()
		await expect(preview.getByTestId('quote-worker-env'))
			.toHaveText('沒有 document，也沒有 window')
		await expect(preview.getByTestId('quote-comparison'))
			.toContainText('JSON 完全相同')

		await page.getByTestId('examples-menu')
			.click()
		await expect(page.getByRole('menuitemcheckbox', { name: '預設——轉角印刷的印製報價' }))
			.toBeVisible()
		await expect(page.getByRole('menuitemcheckbox', { name: '無效的設定——schema 函式庫的診斷' }))
			.toBeVisible()
		await expect(page.getByRole('menuitemcheckbox', { name: '有問題的規則——被隔離的例外' }))
			.toBeVisible()
		await page.keyboard.press('Escape')

		await chooseTutorialMenuItem(page, '教學')
		const rail = page.getByRole('complementary', { name: '教學' })
		await expect(rail.getByText('這是一份印刷店的報價：一份 JSON 定義', { exact: false }))
			.toBeVisible()
		await page.getByRole('button', { name: '下一步', exact: true })
			.click()
		await expect(rail.getByText('試試看：把 A5 傳單的數量從 500 改成別的數字。'))
			.toBeVisible()
		await setLocale(page, 'en')
		await expect(page.getByRole('complementary', { name: 'Tutorial' })
			.getByText('Try it: change the A5 flyers quantity from 500 to another number.'))
			.toBeVisible()
		await expect(preview.getByTestId('quote-start-over'))
			.toHaveText('Start over')
	})
})
