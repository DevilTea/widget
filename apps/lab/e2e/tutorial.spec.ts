import type { Page } from '@playwright/test'
import { expect, test } from './fixtures'

/**
 * Issue #25 P1 tutorial contract. `fixtures.ts` pre-dismisses the Welcome card for every test in this
 * file EXCEPT the "welcome card" describe block below, which opts back in via `welcomeDismissed: false`
 * to exercise the real first-load card — see `fixtures.ts`'s header comment for the mechanism.
 *
 * Starting the tour always begins on the Sandbox showcase (the app's default) and switches to Survey
 * through the deterministic-start pipeline (`use-tutorial.ts`), so every test below waits for the rail
 * to actually appear before interacting with Survey's own controls.
 */

const RAIL_LABEL = 'Tutorial'

async function startTourFromHeader(page: Page): Promise<void> {
	await page.getByRole('button', { name: 'Tutorial', exact: true })
		.click()
	await expect(page.getByRole('complementary', { name: RAIL_LABEL }))
		.toBeVisible()
}

test.describe('welcome card', () => {
	test.use({ welcomeDismissed: false })

	test('appears on first load with the locked copy, and dismissing it never blocks ordinary Lab use', async ({ page }) => {
		await page.goto('/')

		const dialog = page.getByRole('dialog', { name: 'Welcome to Widget Lab' })
		await expect(dialog)
			.toBeVisible()
		await expect(page.getByText('Widget Lab lets you change a real app, then see where that behavior comes from.'))
			.toBeVisible()
		await expect(page.getByText('Start with one small interaction; we\'ll show what changed and why.'))
			.toBeVisible()

		await page.getByRole('button', { name: 'Explore on my own' })
			.click()
		await expect(dialog)
			.toHaveCount(0)

		// Session-local: never reappears this session, even across a reload.
		await page.reload()
		await expect(page.getByRole('dialog', { name: 'Welcome to Widget Lab' }))
			.toHaveCount(0)

		// Never blocks ordinary Lab use.
		await expect(page.getByRole('tab', { name: 'Source' }))
			.toBeVisible()
		await page.getByRole('tab', { name: 'Blueprint' })
			.click()
		await expect(page.getByRole('tab', { name: 'Blueprint' }))
			.toHaveAttribute('aria-selected', 'true')
	})

	test('"Start the tour" dismisses the welcome card and begins the Survey tour', async ({ page }) => {
		await page.goto('/')
		await page.getByRole('button', { name: 'Start the tour' })
			.click()

		await expect(page.getByRole('dialog', { name: 'Welcome to Widget Lab' }))
			.toHaveCount(0)
		await expect(page.getByRole('complementary', { name: RAIL_LABEL }))
			.toBeVisible()
		await expect(page.getByLabel('Switch showcase'))
			.toHaveValue('survey')
	})
})

test('skipping the tour leaves the Lab fully usable', async ({ page }) => {
	await page.goto('/')
	await startTourFromHeader(page)

	await page.getByRole('button', { name: 'Skip tour' })
		.click()
	await expect(page.getByRole('complementary', { name: RAIL_LABEL }))
		.toHaveCount(0)

	for (const name of ['Source', 'Blueprint', 'Runtime', 'Graph', 'Preview']) {
		await expect(page.getByRole('tab', { name }))
			.toBeVisible()
	}
	await page.getByRole('tab', { name: 'Runtime' })
		.click()
	await expect(page.getByRole('tab', { name: 'Runtime' }))
		.toHaveAttribute('aria-selected', 'true')
	await expect(page.getByRole('button', { name: 'Apply' }))
		.toBeVisible()
})

test('dirty-draft confirmation appears before starting, and Cancel preserves the draft', async ({ page }) => {
	interface LabTestWindow { __WIDGET_LAB_TEST__?: { setDraftSourceText: (text: string) => void } }

	await page.goto('/?lab-test')
	await page.waitForFunction(() => typeof (window as unknown as LabTestWindow).__WIDGET_LAB_TEST__?.setDraftSourceText === 'function')

	// Dirty the (default Sandbox) draft via the issue #28 interaction seam — never touches Monaco.
	await page.evaluate((source) => {
		(window as unknown as LabTestWindow).__WIDGET_LAB_TEST__?.setDraftSourceText(source)
	}, '{ "id": "root", "type": "Text", "config": { "text": "dirtied by test" } }')
	await expect(page.getByRole('button', { name: 'Apply' }))
		.toBeEnabled()

	await page.getByRole('button', { name: 'Tutorial', exact: true })
		.click()
	const confirmDialog = page.getByRole('alertdialog', { name: 'Replace unapplied changes?' })
	await expect(confirmDialog)
		.toBeVisible()
	await expect(page.getByText('Starting the tutorial will load the Survey teaching example and replace your unapplied changes.'))
		.toBeVisible()

	await page.getByRole('button', { name: 'Cancel' })
		.click()
	await expect(confirmDialog)
		.toHaveCount(0)
	// Cancel touched nothing: the draft is still dirty and no tour started.
	await expect(page.getByRole('button', { name: 'Apply' }))
		.toBeEnabled()
	await expect(page.getByRole('complementary', { name: RAIL_LABEL }))
		.toHaveCount(0)
	await expect(page.getByText('Widget Lab sandbox DRAFT', { exact: false }))
		.toHaveCount(0) // draft was never applied, so Preview still shows the ORIGINAL applied text
	await expect(page.getByText('dirtied by test'))
		.toHaveCount(0) // ...and the dirtied draft was never applied either

	// Confirming proceeds with the deterministic reload.
	await page.getByRole('button', { name: 'Tutorial', exact: true })
		.click()
	await page.getByRole('button', { name: 'Start tour' })
		.click()
	await expect(page.getByRole('complementary', { name: RAIL_LABEL }))
		.toBeVisible()
	await expect(page.getByLabel('Switch showcase'))
		.toHaveValue('survey')
})

test('rail geometry: at the 900px minimum-supported width, an open tour keeps the workbench usable', async ({ page }) => {
	await page.setViewportSize({ width: 900, height: 800 })
	await page.goto('/')
	await startTourFromHeader(page)

	await expect(page.getByText('Widget Lab is designed for a desktop-sized viewport.'))
		.toBeHidden()

	const hasHorizontalOverflow = await page.evaluate(
		() => document.documentElement.scrollWidth > document.documentElement.clientWidth,
	)
	expect(hasHorizontalOverflow)
		.toBe(false)

	for (const name of ['Source', 'Blueprint', 'Runtime', 'Graph', 'Preview']) {
		await expect(page.getByRole('tab', { name }))
			.toBeVisible()
	}
	await page.getByRole('tab', { name: 'Blueprint' })
		.click()
	await expect(page.getByRole('tab', { name: 'Blueprint' }))
		.toHaveAttribute('aria-selected', 'true')

	// The rail itself must also be fully on-screen, not clipped past the viewport's own right edge.
	const railBox = await page.getByRole('complementary', { name: RAIL_LABEL })
		.boundingBox()
	expect(railBox)
		.not.toBeNull()
	expect(railBox!.x + railBox!.width)
		.toBeLessThanOrEqual(900)
})

test('full Survey tour end-to-end via real interactions, each observation appearing only after its action, then restart from the header button', async ({ page }) => {
	await page.goto('/')
	await startTourFromHeader(page)

	const rail = page.getByRole('complementary', { name: RAIL_LABEL })
	// `exact: true`: step 8's disabled "Implementation (coming next)" link contains "next" as a
	// substring, which a non-exact match on "Next" would ambiguously also resolve to.
	const nextButton = page.getByRole('button', { name: 'Next', exact: true })
	const finishButton = page.getByRole('button', { name: 'Finish', exact: true })

	// Step 1 — orient: no action needed, reveals immediately.
	await expect(rail.getByText('This is the Interactive Survey — a trip-planning form.'))
		.toBeVisible()
	await expect(nextButton)
		.toBeEnabled()
	await nextButton.click()

	// Step 2 — State: observation must NOT be visible before the real action. Also confirms the spotlight
	// mechanism (CSS class toggling onto the step's `data-tutorial-target` element, never a
	// position-cloned overlay) actually reaches the real Preview DOM, not just the rail's own copy.
	const stateObservation = rail.getByText('The Live estimate just updated.', { exact: false })
	await expect(stateObservation)
		.toHaveCount(0)
	await expect(nextButton)
		.toBeDisabled()
	await expect(page.locator('[data-tutorial-target="survey-adults"]'))
		.toHaveClass(/tutorial-spotlight/)

	const adults = page.getByLabel('Adults', { exact: true })
	await adults.fill('5')
	await adults.press('Tab')

	await expect(stateObservation)
		.toBeVisible()
	await expect(nextButton)
		.toBeEnabled()

	await rail.getByRole('button', { name: 'See it in Runtime' })
		.click()
	await expect(page.getByRole('tab', { name: 'Runtime' }))
		.toHaveAttribute('aria-selected', 'true')
	await nextButton.click()

	// Step 3 — Property: no new action, reveals immediately on entry.
	await expect(rail.getByText('Trip days and costs recomputed by themselves.', { exact: false }))
		.toBeVisible()
	await expect(nextButton)
		.toBeEnabled()
	await nextButton.click()

	// Step 4 — failure, then recovery, inside the same step.
	const failureObservation = rail.getByText('Trip days fails with a reason', { exact: false })
	await expect(failureObservation)
		.toHaveCount(0)
	const returnDate = page.getByLabel('Return date')
	// Default Departure is 2027-04-10 (showcases/survey/presets.ts) — this is strictly before it.
	await returnDate.fill('2027-04-01')
	await returnDate.press('Tab')

	await expect(failureObservation)
		.toBeVisible()
	await expect(nextButton)
		.toBeDisabled()
	const recoveryObservation = rail.getByText('The same Properties recovered.', { exact: false })
	await expect(recoveryObservation)
		.toHaveCount(0)

	await returnDate.fill('2027-04-20')
	await returnDate.press('Tab')

	await expect(recoveryObservation)
		.toBeVisible()
	await expect(nextButton)
		.toBeEnabled()
	await nextButton.click()

	// Step 5 — dependency: appear, then disappear again (keeps the script submittable at step 6).
	const familyQuestion = page.getByText('What matters most while traveling with children?')
	await expect(familyQuestion)
		.toHaveCount(0)
	const appearObservation = rail.getByText('A new "Family preferences" section appeared.', { exact: false })
	await expect(appearObservation)
		.toHaveCount(0)

	const children = page.getByLabel('Children', { exact: true })
	await children.fill('2')
	await children.press('Tab')

	await expect(familyQuestion)
		.toBeVisible()
	await expect(appearObservation)
		.toBeVisible()
	await expect(nextButton)
		.toBeDisabled()

	await children.fill('0')
	await children.press('Tab')

	await expect(familyQuestion)
		.toHaveCount(0)
	await expect(rail.getByText('The section disappeared again', { exact: false }))
		.toBeVisible()
	await expect(nextButton)
		.toBeEnabled()
	await nextButton.click()

	// Step 6 — a direct State write vs. a Method: Submit, then Generate result.
	const methodObservation = rail.getByText('invoke named Methods', { exact: false })
	await expect(methodObservation)
		.toHaveCount(0)
	await expect(page.getByRole('heading', { name: 'Recommendation' }))
		.toHaveCount(0)

	// `exact: true` on purpose: the Runtime tab (activated via step 2's "See it in Runtime" link, and
	// still mounted though inactive) has its own "submit() writes ..." Method-row text, which a
	// non-exact substring match on "Submit" would ambiguously also match.
	await page.getByRole('button', { name: 'Submit', exact: true })
		.click()
	await page.getByRole('button', { name: 'Generate result', exact: true })
		.click()

	await expect(page.getByRole('heading', { name: 'Recommendation' }))
		.toBeVisible()
	await expect(methodObservation)
		.toBeVisible()
	await expect(nextButton)
		.toBeEnabled()
	await nextButton.click()

	// Step 7 — snapshot vs. live: mutating an answer after Generate result is the real interaction.
	// `{ exact: true }` on the Preview badge check on purpose: the rail's own reveal text for this step
	// mentions "Stale" too (in a longer sentence), and both are visible together once the action lands —
	// a non-exact substring match would ambiguously resolve to both elements.
	const staleObservation = rail.getByText('gained the Stale marker', { exact: false })
	await expect(staleObservation)
		.toHaveCount(0)
	await expect(page.getByText('Stale', { exact: true }))
		.toHaveCount(0)

	await adults.fill('6')
	await adults.press('Tab')

	await expect(page.getByText('Stale', { exact: true }))
		.toBeVisible()
	await expect(staleObservation)
		.toBeVisible()
	await expect(nextButton)
		.toBeEnabled()
	await nextButton.click()

	// Step 8 — map the views: each name is a real navigation affordance.
	await expect(rail.getByText('Source = the declarative definition you edit', { exact: false }))
		.toBeVisible()
	await rail.getByRole('button', { name: 'Runtime', exact: true })
		.click()
	await expect(page.getByRole('tab', { name: 'Runtime' }))
		.toHaveAttribute('aria-selected', 'true')
	await rail.getByRole('button', { name: 'Source', exact: true })
		.click()
	await expect(page.getByRole('tab', { name: 'Source' }))
		.toHaveAttribute('aria-selected', 'true')
	// "Implementation" is named but not yet wired (P3) — non-interactive, not a dead link.
	await expect(rail.getByRole('button', { name: 'Implementation', exact: false }))
		.toBeDisabled()
	await nextButton.click()

	// Step 9 — hand-back: "Finish" replaces "Next" on the last step.
	await expect(rail.getByText('Try the CRM tour, open any inspector, or edit the Source JSON and press Apply.'))
		.toBeVisible()
	await expect(finishButton)
		.toBeEnabled()
	await finishButton.click()

	await expect(rail)
		.toHaveCount(0)
	const tutorialButton = page.getByRole('button', { name: 'Restart tutorial' })
	await expect(tutorialButton)
		.toBeVisible()

	// Restart from the header button works after completion.
	await tutorialButton.click()
	await expect(rail)
		.toBeVisible()
	await expect(rail.getByText('This is the Interactive Survey — a trip-planning form.'))
		.toBeVisible()
	await expect(rail.getByText('Step 1 of 9'))
		.toBeVisible()
})
