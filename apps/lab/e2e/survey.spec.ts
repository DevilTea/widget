import { expect, test } from './fixtures'

/**
 * Issue #28 Interactive Survey contract, against the default preset (`survey-default` —
 * `showcases/survey/presets.ts`: every answer has a default, so `TripReadiness.ready`/Submit/Generate
 * result all succeed).
 *
 * `<input type="number">`/`<input type="date">` question renderers write `answer` on the native
 * `change` event (`SurveyNumberQuestionRenderer.vue`/`SurveyDateQuestionRenderer.vue`), which only fires
 * on blur for a real user — `.fill()` alone does not blur, so every fill below is followed by a Tab
 * press to commit the value before asserting on its effect.
 */

test.beforeEach(async ({ page }) => {
	await page.goto('/')
	await page.getByLabel('Switch showcase')
		.selectOption('survey')
})

test('conditional Family preferences question reveals/hides with Children', async ({ page }) => {
	const familyQuestion = page.getByText('What matters most while traveling with children?')
	await expect(familyQuestion)
		.toHaveCount(0)

	const children = page.getByLabel('Children', { exact: true })
	await children.fill('2')
	await children.press('Tab')
	await expect(familyQuestion)
		.toBeVisible()

	await children.fill('0')
	await children.press('Tab')
	await expect(familyQuestion)
		.toHaveCount(0)
})

test('valid flow: Submit then Generate result renders the Recommendation block', async ({ page }) => {
	await page.getByRole('button', { name: 'Submit' })
		.click()
	await page.getByRole('button', { name: 'Generate result' })
		.click()
	await expect(page.getByRole('heading', { name: 'Recommendation' }))
		.toBeVisible()
})

test('invalid date flow surfaces the issue and correcting it recovers live metrics', async ({ page }) => {
	const issueText = 'Return date must be strictly after the departure date.'
	await expect(page.getByText(issueText))
		.toHaveCount(0)

	// Default Departure date is 2027-04-10 (showcases/survey/presets.ts) — this is strictly before it.
	const returnDate = page.getByLabel('Return date')
	await returnDate.fill('2027-04-01')
	await returnDate.press('Tab')
	await expect(page.getByText(issueText)
		.first())
		.toBeVisible()

	// The dependent metrics (issue #26 Finding 2) must show an explicit "Unavailable" representation,
	// never a fabricated `0.00` — and (Finding 3) their own line is an attributed "Unavailable because
	// Trip days failed." rather than a repeat of the root-cause message.
	const budgetPerPersonPerDayValue = page.locator('dt', { hasText: 'Budget / person / day' })
		.locator('xpath=following-sibling::dd[1]')
	const estimatedBaselineCostValue = page.locator('dt', { hasText: 'Estimated baseline cost' })
		.locator('xpath=following-sibling::dd[1]')
	await expect(budgetPerPersonPerDayValue)
		.toHaveText('Unavailable')
	await expect(estimatedBaselineCostValue)
		.toHaveText('Unavailable')
	await expect(page.getByText('Unavailable because Trip days failed.'))
		.toHaveCount(2)
	await expect(page.getByText('0.00'))
		.toHaveCount(0)

	await returnDate.fill('2027-04-20')
	await returnDate.press('Tab')
	await expect(page.getByText(issueText))
		.toHaveCount(0)

	// Live metrics recover: computeTripDays('2027-04-10', '2027-04-20') === 11 (survey/domain.ts).
	const tripDaysValue = page.locator('dt', { hasText: 'Trip days' })
		.locator('xpath=following-sibling::dd[1]')
	await expect(tripDaysValue)
		.toHaveText('11')
	await expect(budgetPerPersonPerDayValue)
		.not.toHaveText('Unavailable')
})

test('mutating an answer after Generate result shows an explicit stale-result state, including while the current answers are also invalid (issue #26)', async ({ page }) => {
	await page.getByRole('button', { name: 'Submit' })
		.click()
	await page.getByRole('button', { name: 'Generate result' })
		.click()
	await expect(page.getByRole('heading', { name: 'Recommendation' }))
		.toBeVisible()

	const tripDaysLine = page.getByText('Trip days: 5 · travelers:')
	await expect(tripDaysLine)
		.toBeVisible()
	await expect(page.getByText('Stale'))
		.toHaveCount(0)

	// Finding 4 coexistence check: change Return date to an INVALID date (before Departure,
	// 2027-04-10) so current-answer failures and the retained stale Recommendation are visible at the
	// same time — all three facts must hold together, not just whichever one a narrower test would have
	// exercised in isolation.
	const returnDate = page.getByLabel('Return date')
	await returnDate.fill('2027-04-01')
	await returnDate.press('Tab')

	// (1) current metric issue + explicit "Unavailable" representation (issue #26 Finding 2/3) — never a
	// fabricated `0.00`. Both dependent metrics fail (tripDays cascades to both), so each is checked for
	// its exact text rather than a page-wide "0.00" substring search — "Estimated baseline cost" can
	// legitimately read e.g. "1500.00" elsewhere on this same page, which would falsely match a loose
	// substring check even though it is a real, unrelated success value.
	const issueText = 'Return date must be strictly after the departure date.'
	await expect(page.getByText(issueText)
		.first())
		.toBeVisible()
	const budgetPerPersonPerDayValue = page.locator('dt', { hasText: 'Budget / person / day' })
		.locator('xpath=following-sibling::dd[1]')
	const estimatedBaselineCostValue = page.locator('dt', { hasText: 'Estimated baseline cost' })
		.locator('xpath=following-sibling::dd[1]')
	await expect(budgetPerPersonPerDayValue)
		.toHaveText('Unavailable')
	await expect(estimatedBaselineCostValue)
		.toHaveText('Unavailable')

	// (2) the stale marker/copy on the retained Recommendation.
	await expect(page.getByText('Stale'))
		.toBeVisible()
	await expect(page.getByText('Generated from previous answers'))
		.toBeVisible()

	// (3) the old snapshot's figures remain visibly retained, unaffected by the current-answer failure.
	await expect(tripDaysLine)
		.toBeVisible()

	// Correct the date to another valid-but-different value: the current-answer issue clears and live
	// metrics recover, but the Recommendation stays stale (still generated from the original answers).
	await returnDate.fill('2027-04-24')
	await returnDate.press('Tab')
	await expect(page.getByText(issueText))
		.toHaveCount(0)
	await expect(budgetPerPersonPerDayValue)
		.not.toHaveText('Unavailable')
	await expect(page.getByText('Stale'))
		.toBeVisible()

	await page.getByRole('button', { name: 'Submit' })
		.click()
	await page.getByRole('button', { name: 'Generate result' })
		.click()

	await expect(page.getByText('Stale'))
		.toHaveCount(0)
	await expect(page.getByText('Generated from previous answers'))
		.toHaveCount(0)
	// computeTripDays('2027-04-10', '2027-04-24') === 15 (survey/domain.ts).
	await expect(page.getByText('Trip days: 15 · travelers:'))
		.toBeVisible()
})

test('clearing Budget makes the dependent metric Unavailable, never a fabricated 0.00 (issue #26 Finding 2)', async ({ page }) => {
	const budgetPerPersonPerDayValue = page.locator('dt', { hasText: 'Budget / person / day' })
		.locator('xpath=following-sibling::dd[1]')
	await expect(budgetPerPersonPerDayValue)
		.not.toHaveText('Unavailable')

	const budget = page.getByLabel('Total trip budget (USD, illustrative)')
	await budget.fill('')
	await budget.press('Tab')

	// Exact-text assertion, not a page-wide "0.00" substring search: "Estimated baseline cost" stays a
	// real, unrelated success value (e.g. "1500.00") elsewhere in this same view, which a loose substring
	// check would falsely flag even though nothing here is fabricated.
	await expect(budgetPerPersonPerDayValue)
		.toHaveText('Unavailable')
})
