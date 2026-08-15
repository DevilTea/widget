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

	await returnDate.fill('2027-04-20')
	await returnDate.press('Tab')
	await expect(page.getByText(issueText))
		.toHaveCount(0)

	// Live metrics recover: computeTripDays('2027-04-10', '2027-04-20') === 11 (survey/domain.ts).
	const tripDaysValue = page.locator('dt', { hasText: 'Trip days' })
		.locator('xpath=following-sibling::dd[1]')
	await expect(tripDaysValue)
		.toHaveText('11')
})

test.fixme('mutating an answer after Generate result shows an explicit stale-result state (issue #26)', async () => {
	// Today, `TripSurvey.result` (the "Recommendation" block) simply keeps whatever it last computed —
	// there is no explicit "stale" presentation once a later answer change would produce a different
	// result. Confirmed manually: changing Return date after Generate result leaves the Recommendation
	// block's trip-days figure showing the pre-change value while the live "Live estimate" section above
	// it already reflects the new answer.
})
