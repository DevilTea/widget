import type { Locator, Page } from '@playwright/test'
import { chooseTutorialMenuItem, expect, expectDocumentStatus, expectPreviewStatus, expectShowcase, loadPreset, previewFrame, selectShowcase, setLocale, setTheme, test } from './fixtures'

/**
 * Trip budget splitter acceptance contract (issue #230, showcase 1): the Lisbon weekend trip
 * (`showcases/trip-budget/presets.ts`, preset `trip-default`) in the Examples menu next to the survey.
 *
 * Covers selecting it (menu and `?showcase=`), filling data and watching the settlement follow (a Property chain
 * across widgets), validation at the expense, the invalid and run-time failure presets, what the Lab can show of
 * laziness (Runtime values `Never evaluated` until something reads them), `resetState`, the guided tour and zh-TW.
 *
 * The renderers write on the native `input`/`change` event, so a plain `.fill()`, `.check()` or `.selectOption()`
 * is enough: no blur is needed before asserting its effect.
 */

async function openTrip(page: Page): Promise<void> {
	await page.goto('/?showcase=trip-budget')
	await expect(previewFrame(page)
		.getByRole('heading', { name: 'Lisbon weekend', level: 1 }))
		.toBeVisible()
}

function expense(page: Page, id: string): Locator {
	return previewFrame(page)
		.locator(`[data-widget-id="${id}"]`)
}

async function transfers(page: Page): Promise<string[]> {
	return previewFrame(page)
		.getByTestId('trip-transfer')
		.evaluateAll(rows => rows.map(row => Array.from(row.querySelectorAll('span, strong'))
			.map(part => part.textContent?.trim() ?? '')
			.join(' ')))
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
	test('is listed in the Examples menu after the survey, which stays the default', async ({ page }) => {
		await page.goto('/')
		await expectShowcase(page, 'survey')

		await page.getByTestId('examples-menu')
			.click()
		const items = page.getByRole('menuitemcheckbox')
		await expect(items.filter({ hasText: 'Interactive Survey' }))
			.toBeVisible()
		await expect(items.filter({ hasText: 'Trip budget splitter' }))
			.toBeVisible()
		await page.keyboard.press('Escape')

		await selectShowcase(page, 'trip-budget')
		await expectShowcase(page, 'trip-budget')
		await expect(previewFrame(page)
			.getByRole('heading', { name: 'Lisbon weekend', level: 1 }))
			.toBeVisible()
		await expect(page.getByTestId('examples-menu'))
			.toHaveAttribute('data-preset-id', 'trip-default')
		await expectDocumentStatus(page, { valid: true })
		await expectPreviewStatus(page, 'current')
	})

	test('?showcase=trip-budget opens it directly, and a reload restores it', async ({ page }) => {
		await openTrip(page)
		await expectShowcase(page, 'trip-budget')
		await page.reload()
		await expect(previewFrame(page)
			.getByRole('heading', { name: 'Lisbon weekend', level: 1 }))
			.toBeVisible()
		await expectShowcase(page, 'trip-budget')
	})

	test('does not leak into the survey: switching back shows the survey, and the default URL still opens it', async ({ page }) => {
		await openTrip(page)
		await selectShowcase(page, 'survey')
		await expect(previewFrame(page)
			.getByRole('heading', { name: 'Maker Space open day: sign-up' }))
			.toBeVisible()
		await page.goto('/')
		await expectShowcase(page, 'survey')
	})
})

test.describe('the default trip', () => {
	test('shows the settlement the chain computes, and Relations lists the chain as declared dependencies', async ({ page }) => {
		await openTrip(page)
		const preview = previewFrame(page)

		await expect(preview.getByTestId('trip-total'))
			.toHaveText('€651.74')
		expect(await transfers(page))
			.toEqual(['Chloe pays Ana €119.22', 'Ben pays Ana €61.99', 'Dev pays Ana €56.23'])
		await expect(preview.locator('[data-widget-id="ana"] [data-testid="trip-person-status"]'))
			.toHaveText('+ gets back €237.44')

		// Relations (the default Dependencies view) follows the chain from the settlement back to the expenses.
		await page.getByRole('tab', { name: 'Dependencies', exact: true })
			.click()
		await page.getByRole('tab', { name: 'Blueprint', exact: true })
			.click()
		await page.getByRole('button', { name: /settlement : Settlement/ })
			.first()
			.click()
		await page.getByRole('tab', { name: 'Dependencies', exact: true })
			.click()
		await expect(page.getByRole('tablist', { name: 'Dependencies views' })
			.getByRole('tab', { name: 'Relations' }))
			.toHaveAttribute('aria-selected', 'true')
	})

	test('moves the whole settlement when the data is filled in: amount, currency, payer, who shares, rounding', async ({ page }) => {
		await openTrip(page)
		const preview = previewFrame(page)

		await expense(page, 'hotel')
			.getByTestId('trip-amount')
			.fill('520')
		await expect(preview.getByTestId('trip-total'))
			.toHaveText('€751.74')
		expect(await transfers(page))
			.toEqual(['Chloe pays Ana €144.22', 'Ben pays Ana €86.99', 'Dev pays Ana €81.23'])

		// A foreign amount shows its conversion; another currency changes it.
		await expect(expense(page, 'museum')
			.getByTestId('trip-converted'))
			.toHaveText('≈ €58.88')
		await expense(page, 'museum')
			.getByTestId('trip-currency')
			.selectOption('GBP')
		await expect(expense(page, 'museum')
			.getByTestId('trip-converted'))
			.toHaveText('≈ €74.88')

		// Who paid and who shares.
		await expense(page, 'dinner')
			.getByTestId('trip-paid-by')
			.selectOption('chloe')
		await expense(page, 'dinner')
			.getByTestId('trip-share-ben')
			.uncheck()
		await expect(preview.locator('[data-widget-id="ben"] [data-testid="trip-person-paid"]'))
			.toHaveText('€0.00')

		// Rounding is a read-only Method the settlement calls: the payments change and the gap is said aloud.
		await preview.getByTestId('trip-round-step')
			.selectOption('100')
		await expect(preview.getByTestId('trip-rounding-gap'))
			.toBeVisible()
		for (const line of await transfers(page)) {
			expect(line)
				.toMatch(/€\d+\.00$/)
		}
	})

	test('shows a negative amount as an error at the expense and leaves it out of the settlement', async ({ page }) => {
		await openTrip(page)
		const preview = previewFrame(page)
		await expense(page, 'hotel')
			.getByTestId('trip-amount')
			.fill('-5')

		await expect(expense(page, 'hotel')
			.getByTestId('trip-expense-error'))
			.toContainText('The amount cannot be negative.')
		await expect(expense(page, 'hotel')
			.getByTestId('trip-amount'))
			.toHaveAttribute('aria-invalid', 'true')
		await expect(preview.getByTestId('trip-total'))
			.toHaveText('€231.74')

		await expense(page, 'hotel')
			.getByTestId('trip-amount')
			.fill('420')
		await expect(expense(page, 'hotel')
			.getByTestId('trip-expense-error'))
			.toHaveCount(0)
		await expect(preview.getByTestId('trip-total'))
			.toHaveText('€651.74')
	})

	test('switches the trip language independently of the Lab language', async ({ page }) => {
		await openTrip(page)
		const preview = previewFrame(page)
		await preview.getByTestId('trip-language')
			.selectOption('zh-TW')
		await expect(preview.getByRole('heading', { name: '里斯本週末小旅行', level: 1 }))
			.toBeVisible()
		await expect(preview.getByTestId('trip-start-over'))
			.toHaveText('重新開始')
		await expect(page.getByRole('tab', { name: 'Author', exact: true }))
			.toBeVisible()
	})
})

test.describe('theme', () => {
	test('paints from its own tokens and follows the Lab theme, light and dark', async ({ page }) => {
		await openTrip(page)
		const root = previewFrame(page)
			.locator('.trip')
		const background = (): Promise<string> => root.evaluate(element => getComputedStyle(element).backgroundColor)

		await setTheme(page, 'light')
		await expect(root)
			.toHaveAttribute('data-trip-theme', 'light')
		expect(await background())
			.toBe('rgb(246, 247, 249)')

		await setTheme(page, 'dark')
		await expect(root)
			.toHaveAttribute('data-trip-theme', 'dark')
		expect(await background())
			.toBe('rgb(20, 22, 26)')
	})
})

test.describe('failures', () => {
	test('the draft with mistakes has four located problems, and the preview keeps the last working version', async ({ page }) => {
		await openTrip(page)
		await loadPreset(page, 'trip-invalid')

		await expectDocumentStatus(page, { problems: 4 })
		await expectPreviewStatus(page, 'stale')
		const problems = page.getByTestId('author-problems')
		await expect(problems)
			.toHaveAttribute('data-problem-count', '4')
		const rows = problems.getByTestId('problem-row')
		await expect(rows)
			.toHaveCount(4)
		await expect(rows.nth(0))
			.toContainText('config.rates.USD must be a number greater than 0.')
		await expect(rows.nth(0))
			.toContainText('widget "currency : Currency"')
		await expect(rows.nth(1))
			.toContainText('config.split.percents add up to 90, not 100.')
		await expect(rows.nth(2))
			.toContainText('config.amount must be a number that is not negative.')
		await expect(rows.nth(3))
			.toContainText('"zoe" is not a Person of this trip.')
		await expect(previewFrame(page)
			.getByRole('heading', { name: 'Lisbon weekend', level: 1 }))
			.toBeVisible()
	})

	test('a currency with no rate compiles, then fails when it runs: the failure follows the chain and shows in Selected widget', async ({ page }) => {
		await openTrip(page)
		await loadPreset(page, 'trip-unsupported-currency')
		const preview = previewFrame(page)

		await expectDocumentStatus(page, { valid: true })
		await expect(preview.getByTestId('trip-settlement-failed'))
			.toBeVisible()
		await expect(expense(page, 'museum')
			.getByTestId('trip-conversion-failed'))
			.toBeVisible()

		await selectWidget(page, /museum : Expense/)
		await expect(runtimeRow(page, 'amountBase')
			.getByTestId('value-summary'))
			.toContainText('Failed')
		await expect(runtimeRow(page, 'shares')
			.getByTestId('value-summary'))
			.toContainText('Failed')

		// An expense that is not counted is left out before its amount is read, so it cannot take the settlement down.
		for (const person of ['ana', 'chloe', 'dev']) {
			await expense(page, 'museum')
				.getByTestId(`trip-share-${person}`)
				.uncheck()
		}
		await expect(preview.getByTestId('trip-settlement-failed'))
			.toHaveCount(0)
		await expect(preview.getByTestId('trip-total'))
			.toHaveText('€592.86')
		await expect(expense(page, 'museum')
			.getByTestId('trip-expense-error'))
			.toContainText('Pick at least one person')
		for (const person of ['ana', 'chloe', 'dev']) {
			await expense(page, 'museum')
				.getByTestId(`trip-share-${person}`)
				.check()
		}
		await expect(preview.getByTestId('trip-settlement-failed'))
			.toBeVisible()

		// Choosing a currency the Currency knows brings the chain back.
		await expense(page, 'museum')
			.getByTestId('trip-currency')
			.selectOption('USD')
		await expect(preview.getByTestId('trip-total'))
			.toHaveText('€651.74')
		await expect(runtimeRow(page, 'amountBase')
			.getByTestId('value-summary'))
			.toHaveText('5888')
	})
})

test.describe('laziness, as far as the Lab can show it', () => {
	test('breakdown is Never evaluated until the Preview opens it, and keeps its last result when it is closed', async ({ page }) => {
		await openTrip(page)
		await selectWidget(page, /hotel : Expense/)

		// What the page shows is evaluated; the breakdown nobody has opened is not.
		await expect(runtimeRow(page, 'amountBase')
			.getByTestId('value-summary'))
			.toHaveText('42000')
		await expect(runtimeRow(page, 'breakdown')
			.getByTestId('value-summary'))
			.toHaveText('Never evaluated')

		const toggle = expense(page, 'hotel')
			.getByTestId('trip-breakdown-toggle')
		await toggle.click()
		await expect(expense(page, 'hotel')
			.getByTestId('trip-breakdown'))
			.toBeVisible()
		await expect(runtimeRow(page, 'breakdown')
			.getByTestId('value-summary'))
			.toContainText('"totalCents": 42000')

		// Closed again: nothing reads it, so Core does not run it; the Lab shows the latest result a reader produced.
		await toggle.click()
		await expect(expense(page, 'hotel')
			.getByTestId('trip-breakdown'))
			.toHaveCount(0)
		await expense(page, 'hotel')
			.getByTestId('trip-amount')
			.fill('600')
		await expect(runtimeRow(page, 'amountBase')
			.getByTestId('value-summary'))
			.toHaveText('60000')
		await expect(runtimeRow(page, 'breakdown')
			.getByTestId('value-summary'))
			.toContainText('"totalCents": 42000')

		// Opening it again reads it again, with the current State.
		await toggle.click()
		await expect(runtimeRow(page, 'breakdown')
			.getByTestId('value-summary'))
			.toContainText('"totalCents": 60000')
	})

	test('a person\'s ledger is Never evaluated until it is opened', async ({ page }) => {
		await openTrip(page)
		await selectWidget(page, /ben : Person/)
		await expect(runtimeRow(page, 'balance')
			.getByTestId('value-summary'))
			.toHaveText('-6199')
		await expect(runtimeRow(page, 'ledger')
			.getByTestId('value-summary'))
			.toHaveText('Never evaluated')
		await previewFrame(page)
			.locator('[data-widget-id="ben"]')
			.getByTestId('trip-ledger-toggle')
			.click()
		await expect(runtimeRow(page, 'ledger')
			.getByTestId('value-summary'))
			.not
			.toHaveText('Never evaluated')
	})
})

test.describe('resetState', () => {
	test('"Reset this expense" restores that expense to the authored values, and "Start over" restores everything but the language', async ({ page }) => {
		await openTrip(page)
		const preview = previewFrame(page)
		await selectWidget(page, /hotel : Expense/)
		const hotelAmount = expense(page, 'hotel')
			.getByTestId('trip-amount')

		await hotelAmount.fill('999')
		await expense(page, 'dinner')
			.getByTestId('trip-amount')
			.fill('1')
		await expect(runtimeRow(page, 'amount')
			.getByTestId('value-summary'))
			.toHaveText('999')

		await expense(page, 'hotel')
			.getByTestId('trip-reset-expense')
			.click()
		await expect(hotelAmount)
			.toHaveValue('420')
		await expect(runtimeRow(page, 'amount')
			.getByTestId('value-summary'))
			.toHaveText('420')
		// Only that expense was reset.
		await expect(expense(page, 'dinner')
			.getByTestId('trip-amount'))
			.toHaveValue('1')

		await preview.getByTestId('trip-language')
			.selectOption('zh-TW')
		await preview.getByTestId('trip-round-step')
			.selectOption('500')
		await preview.getByTestId('trip-start-over')
			.click()
		await expect(expense(page, 'dinner')
			.getByTestId('trip-amount'))
			.toHaveValue('96.5')
		await expect(preview.getByTestId('trip-round-step'))
			.toHaveValue('1')
		await expect(preview.getByRole('heading', { name: '里斯本週末小旅行', level: 1 }))
			.toBeVisible()
		await expect(preview.getByTestId('trip-total'))
			.toHaveText('€651.74')
	})
})

test.describe('accessibility minimums', () => {
	test('every control is labelled and at least 24px, every disclosure is a button with aria-expanded, and focus is visible', async ({ page }) => {
		await openTrip(page)
		const preview = previewFrame(page)
		const controls = preview.locator('input, select, button')
		const count = await controls.count()
		expect(count)
			.toBeGreaterThan(30)
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

		const font = await preview.locator('.trip')
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

		// Keyboard: a disclosure opens with Enter, and a focused control shows a focus ring.
		const toggle = preview.locator('[data-widget-id="hotel"] [data-testid="trip-breakdown-toggle"]')
		await toggle.focus()
		const outline = await toggle.evaluate(element => getComputedStyle(element).outlineStyle)
		expect(outline)
			.not
			.toBe('none')
		await page.keyboard.press('Enter')
		await expect(toggle)
			.toHaveAttribute('aria-expanded', 'true')
		await expect(preview.getByTestId('trip-breakdown'))
			.toBeVisible()
	})
})

test.describe('tutorial', () => {
	const RAIL = 'Tutorial'

	test('walks the Property chain, the read-only Method, laziness and resetState with real interactions, then restarts', async ({ page }) => {
		await openTrip(page)
		await chooseTutorialMenuItem(page)
		const rail = page.getByRole('complementary', { name: RAIL })
		await expect(rail)
			.toBeVisible()
		const next = page.getByRole('button', { name: 'Next', exact: true })
		const preview = previewFrame(page)

		// 1 orient
		await expect(rail.getByText('This is the Trip budget splitter — four friends, five expenses and a settlement, rendered from one JSON definition.'))
			.toBeVisible()
		await expect(next)
			.toBeEnabled()
		await next.click()

		// 2 chain
		const chainObservation = rail.getByText('The settlement moved, and nobody told it to.', { exact: false })
		await expect(chainObservation)
			.toHaveCount(0)
		await expect(next)
			.toBeDisabled()
		await expect(preview.locator('[data-tutorial-target="trip-hotel"]'))
			.toHaveClass(/tutorial-spotlight/)
		await expense(page, 'hotel')
			.getByTestId('trip-amount')
			.fill('520')
		await expect(chainObservation)
			.toBeVisible()
		await rail.getByRole('button', { name: 'Follow the chain in Relations' })
			.click()
		await expect(page.getByRole('tab', { name: 'Dependencies', exact: true }))
			.toHaveAttribute('aria-selected', 'true')
		await next.click()

		// 3 read-only Method: the observation waits for the scripted currency.
		const methodObservation = rail.getByText('Core only lets a Property depend on a Method that is read-only', { exact: false })
		await expect(methodObservation)
			.toHaveCount(0)
		await expect(preview.locator('[data-tutorial-target="trip-museum"]'))
			.toHaveClass(/tutorial-spotlight/)
		await expense(page, 'museum')
			.getByTestId('trip-currency')
			.selectOption('EUR')
		await expect(methodObservation)
			.toHaveCount(0)
		await expense(page, 'museum')
			.getByTestId('trip-currency')
			.selectOption('GBP')
		await expect(methodObservation)
			.toBeVisible()
		await next.click()

		// 4 rounding
		const roundingObservation = rail.getByText('Settlement.transfers calls the Currency\'s second read-only Method', { exact: false })
		await expect(roundingObservation)
			.toHaveCount(0)
		await preview.getByTestId('trip-round-step')
			.selectOption('100')
		await expect(roundingObservation)
			.toBeVisible()
		await next.click()

		// 5 laziness: the first observation is narration, the second waits for the breakdown to be opened.
		await expect(rail.getByText('Properties are lazy', { exact: false }))
			.toBeVisible()
		const lazyObservation = rail.getByText('Now breakdown has a value.', { exact: false })
		await expect(lazyObservation)
			.toHaveCount(0)
		await expect(next)
			.toBeDisabled()
		await expense(page, 'hotel')
			.getByTestId('trip-breakdown-toggle')
			.click()
		await expect(lazyObservation)
			.toBeVisible()
		await next.click()

		// 6 resetState: the hotel is still at 520, so the first stage is already revealed.
		await expect(rail.getByText('The Hotel amount is not the 420 the document authored.'))
			.toBeVisible()
		const resetObservation = rail.getByText('Hotel went back to 420', { exact: false })
		await expect(resetObservation)
			.toHaveCount(0)
		await expect(next)
			.toBeDisabled()
		await expense(page, 'hotel')
			.getByTestId('trip-reset-expense')
			.click()
		await expect(resetObservation)
			.toBeVisible()
		await next.click()

		// 7 diagnostics, 8 map, 9 hand back
		await expect(rail.getByText('Draft with mistakes has four located diagnostics', { exact: false }))
			.toBeVisible()
		await next.click()
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
		await expect(expense(page, 'hotel')
			.getByTestId('trip-amount'))
			.toHaveValue('420')
	})

	test('starting it from the survey runs the survey tour, and leaving the trip ends the trip tour', async ({ page }) => {
		await page.goto('/')
		await chooseTutorialMenuItem(page)
		await expect(page.getByRole('complementary', { name: RAIL })
			.getByRole('heading', { name: 'This is the Interactive Survey' }))
			.toBeVisible()
		await page.getByRole('button', { name: 'Skip tour', exact: true })
			.click()

		await selectShowcase(page, 'trip-budget')
		await chooseTutorialMenuItem(page)
		const rail = page.getByRole('complementary', { name: RAIL })
		await expect(rail.getByRole('heading', { name: 'This is the Trip budget splitter' }))
			.toBeVisible()

		// Another showcase opening ends the trip tour: the rail never describes a showcase that is not open.
		await selectShowcase(page, 'survey')
		await expect(rail)
			.toHaveCount(0)
	})
})

test.describe('zh-TW', () => {
	test('translates the Examples menu entries and the tutorial, while the trip keeps its own language', async ({ page }) => {
		await page.goto('/?showcase=trip-budget&lang=zh-TW')
		await expect(previewFrame(page)
			.getByRole('heading', { name: 'Lisbon weekend', level: 1 }))
			.toBeVisible()
		await expect(page.getByTestId('examples-showcase'))
			.toHaveText('旅行分帳')

		await page.getByTestId('examples-menu')
			.click()
		await expect(page.getByRole('menuitemcheckbox', { name: '預設——里斯本週末' }))
			.toBeVisible()
		await expect(page.getByRole('menuitemcheckbox', { name: '有錯誤的草稿——四個問題' }))
			.toBeVisible()
		await expect(page.getByRole('menuitemcheckbox', { name: '執行時失敗——沒有匯率的幣別' }))
			.toBeVisible()
		await page.keyboard.press('Escape')

		await chooseTutorialMenuItem(page, '教學')
		const rail = page.getByRole('complementary', { name: '教學' })
		await expect(rail.getByText('這是旅行分帳——四位朋友、五筆支出和一份結算，由單一 JSON 定義渲染出來。'))
			.toBeVisible()
		await page.getByRole('button', { name: '下一步', exact: true })
			.click()
		await expect(rail.getByText('試試看：把 Hotel 的金額從 420 改成別的數字。'))
			.toBeVisible()
		await setLocale(page, 'en')
		await expect(page.getByRole('complementary', { name: 'Tutorial' })
			.getByText('Try it: change the Hotel amount from 420 to anything else.'))
			.toBeVisible()
	})
})
