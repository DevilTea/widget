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
 *
 * Merge-gate review (round 1) additions: dialog focus/Escape contracts (blocker 1, mirroring
 * `crm.spec.ts`'s "Change stage dialog" test), a real-interaction 900px geometry contract (blocker 2),
 * and a rapid-double-click re-entrancy contract (blocker 3).
 */

const RAIL_LABEL = 'Tutorial'
const WELCOME_TITLE = 'Widget Lab lets you change a real app, then see where that behavior comes from.'
const CONFIRM_TITLE = 'Starting the tutorial will load the Survey teaching example and replace your unapplied changes.'

async function startTourFromHeader(page: Page): Promise<void> {
	await page.getByRole('button', { name: 'Tutorial', exact: true })
		.click()
	await expect(page.getByRole('complementary', { name: RAIL_LABEL }))
		.toBeVisible()
}

/**
 * Same real, meaningful containment contract `crm.spec.ts`'s "Change stage dialog" test already pins for
 * `ModalRenderer.vue`: a native `<dialog>` shown via `showModal()` makes the rest of the page `inert`, but
 * Tab past the dialog's last focusable control briefly rests focus on `document.body` before the next Tab
 * cycles back to the dialog's first control — so "focus is either inside the (one, currently open) dialog
 * or on `document.body`, never an outside interactive element" is what is actually sampled, across a few
 * Tab/Shift+Tab presses in both directions.
 */
async function focusStaysWithinModalBoundary(page: Page): Promise<boolean> {
	return page.evaluate(() => {
		const active = document.activeElement
		const dialogEl = document.querySelector('dialog[open]')
		return active === document.body || (dialogEl !== null && dialogEl.contains(active))
	})
}

async function sampleTabContainment(page: Page): Promise<void> {
	for (let i = 0; i < 5; i++) {
		await page.keyboard.press('Tab')
		expect(await focusStaysWithinModalBoundary(page))
			.toBe(true)
	}
	for (let i = 0; i < 5; i++) {
		await page.keyboard.press('Shift+Tab')
		expect(await focusStaysWithinModalBoundary(page))
			.toBe(true)
	}
}

test.describe('welcome card', () => {
	test.use({ welcomeDismissed: false })

	test('appears on first load, moves focus in, keeps the background out of the keyboard focus order, and dismissing it never blocks ordinary Lab use', async ({ page }) => {
		await page.goto('/')

		const dialog = page.getByRole('dialog', { name: WELCOME_TITLE })
		await expect(dialog)
			.toBeVisible()
		await expect(page.getByText('Start with one small interaction; we\'ll show what changed and why.'))
			.toBeVisible()

		// Opening moves focus into the dialog, to its first control ("Start the tour").
		const startButton = page.getByRole('button', { name: 'Start the tour' })
		await expect(startButton)
			.toBeFocused()

		// Background workbench controls are not keyboard-reachable while this is modal.
		await sampleTabContainment(page)

		await page.getByRole('button', { name: 'Explore on my own' })
			.click()
		await expect(dialog)
			.toHaveCount(0)

		// Session-local: never reappears this session, even across a reload.
		await page.reload()
		await expect(page.getByRole('dialog', { name: WELCOME_TITLE }))
			.toHaveCount(0)

		// Never blocks ordinary Lab use.
		await expect(page.getByRole('tab', { name: 'Author' }))
			.toBeVisible()
		await page.getByRole('tab', { name: 'Blueprint' })
			.click()
		await expect(page.getByRole('tab', { name: 'Blueprint' }))
			.toHaveAttribute('aria-selected', 'true')
	})

	test('Escape is a safe dismiss equivalent to "Explore on my own" — never leaves tutorial state inconsistent with the closed DOM', async ({ page }) => {
		await page.goto('/')
		const dialog = page.getByRole('dialog', { name: WELCOME_TITLE })
		await expect(dialog)
			.toBeVisible()

		await page.keyboard.press('Escape')
		await expect(dialog)
			.toHaveCount(0)

		// The dismissal is the real `dismissWelcome()` (not just a DOM close): never reappears this
		// session, and the header reflects ordinary idle state (never a stuck "welcome still pending").
		await page.reload()
		await expect(page.getByRole('dialog', { name: WELCOME_TITLE }))
			.toHaveCount(0)
		const tutorialButton = page.getByRole('button', { name: 'Tutorial', exact: true })
		await expect(tutorialButton)
			.toBeEnabled()

		// Lab use is fully unaffected.
		await expect(page.getByRole('tab', { name: 'Author' }))
			.toBeVisible()
	})

	test('"Start the tour" dismisses the welcome card and begins the Survey tour', async ({ page }) => {
		await page.goto('/')
		await page.getByRole('button', { name: 'Start the tour' })
			.click()

		await expect(page.getByRole('dialog', { name: WELCOME_TITLE }))
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

	for (const name of ['Author', 'Blueprint', 'Runtime', 'Graph', 'Preview']) {
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

test.describe('dirty-draft confirmation dialog', () => {
	interface LabTestWindow { __WIDGET_LAB_TEST__?: { setDraftSourceText: (text: string) => void } }

	async function dirtyTheDraft(page: Page): Promise<void> {
		await page.goto('/?lab-test')
		await page.waitForFunction(() => typeof (window as unknown as LabTestWindow).__WIDGET_LAB_TEST__?.setDraftSourceText === 'function')
		// Dirty the (default Sandbox) draft via the issue #28 interaction seam — never touches Monaco.
		await page.evaluate((source) => {
			(window as unknown as LabTestWindow).__WIDGET_LAB_TEST__?.setDraftSourceText(source)
		}, '{ "id": "root", "type": "Text", "config": { "text": "dirtied by test" } }')
		await expect(page.getByRole('button', { name: 'Apply' }))
			.toBeEnabled()
	}

	test('appears before starting, moves focus in, keeps the background out of the keyboard focus order, and Cancel preserves the draft while restoring focus to the header button', async ({ page }) => {
		await dirtyTheDraft(page)

		const tutorialButton = page.getByRole('button', { name: 'Tutorial', exact: true })
		await tutorialButton.click()

		const confirmDialog = page.getByRole('alertdialog', { name: CONFIRM_TITLE })
		await expect(confirmDialog)
			.toBeVisible()

		// Opening moves focus into the dialog, to its first control ("Start tour").
		const startTourButton = page.getByRole('button', { name: 'Start tour' })
		await expect(startTourButton)
			.toBeFocused()

		// Background workbench controls (including the header button that opened this) are not
		// keyboard-reachable while this is modal.
		await sampleTabContainment(page)

		await page.getByRole('button', { name: 'Cancel' })
			.click()
		await expect(confirmDialog)
			.toHaveCount(0)
		// Closing restores focus to the initiating control (the header Tutorial button).
		await expect(tutorialButton)
			.toBeFocused()

		// Cancel touched nothing: the draft is still dirty and no tour started.
		await expect(page.getByRole('button', { name: 'Apply' }))
			.toBeEnabled()
		await expect(page.getByRole('complementary', { name: RAIL_LABEL }))
			.toHaveCount(0)
		await expect(page.getByText('Widget Lab sandbox', { exact: true }))
			.toBeVisible() // Preview still shows the ORIGINAL applied text — the draft was never applied
		// Scoped to Preview on purpose: the dirty draft's text legitimately appears in the Source
		// panel's Monaco DOM (that IS the preserved draft) — asserting a page-wide count of 0 was a
		// race against Monaco's async render (it passed only before the editor painted the new text,
		// which is exactly what slower CI exposed). The contract is "never APPLIED": Preview must not
		// render it, while the Source editor visibly retaining it proves preservation.
		await expect(page.locator('[data-tutorial-target="preview"]')
			.getByText('dirtied by test'))
			.toHaveCount(0)
		await expect(page.locator('.view-lines')
			.getByText('dirtied by test'))
			.toBeVisible()
	})

	test('Escape is the safe Cancel path — preserves the draft and restores focus, same as the Cancel button', async ({ page }) => {
		await dirtyTheDraft(page)

		const tutorialButton = page.getByRole('button', { name: 'Tutorial', exact: true })
		await tutorialButton.click()

		const confirmDialog = page.getByRole('alertdialog', { name: CONFIRM_TITLE })
		await expect(confirmDialog)
			.toBeVisible()

		await page.keyboard.press('Escape')
		await expect(confirmDialog)
			.toHaveCount(0)
		await expect(tutorialButton)
			.toBeFocused()

		await expect(page.getByRole('button', { name: 'Apply' }))
			.toBeEnabled()
		await expect(page.getByRole('complementary', { name: RAIL_LABEL }))
			.toHaveCount(0)
		// Same Preview-scoped assertion as the Cancel-button test above (see the comment there): the
		// draft text belongs in the Source editor's DOM; only Preview must never show it un-applied.
		await expect(page.locator('[data-tutorial-target="preview"]')
			.getByText('dirtied by test'))
			.toHaveCount(0)
		await expect(page.locator('.view-lines')
			.getByText('dirtied by test'))
			.toBeVisible()

		// The guard was released by Escape/Cancel — a fresh request is accepted, not coalesced away.
		await tutorialButton.click()
		await page.getByRole('button', { name: 'Start tour' })
			.click()
		await expect(page.getByRole('complementary', { name: RAIL_LABEL }))
			.toBeVisible()
		await expect(page.getByLabel('Switch showcase'))
			.toHaveValue('survey')
	})
})

test('rapid double-click on the header Tutorial button starts the tour exactly once and never resets it mid-interaction', async ({ page }) => {
	await page.goto('/')

	// Two synthetic clicks dispatched in the SAME synchronous browser-side task — this is the realistic
	// race `start-request.ts`'s guard exists for: a second click landing before Vue's reactive
	// `:disabled` binding has actually patched the real DOM, not merely two well-spaced Playwright
	// `.click()` calls (which the button's own `disabled` attribute would already block on its own).
	await page.evaluate(() => {
		const button = Array.from(document.querySelectorAll('button'))
			.find(candidate => candidate.textContent?.trim() === 'Tutorial')
		button?.click()
		button?.click()
	})

	const rail = page.getByRole('complementary', { name: RAIL_LABEL })
	await expect(rail)
		.toBeVisible()
	await expect(page.getByLabel('Switch showcase'))
		.toHaveValue('survey')
	await expect(rail.getByText('Step 1 of 9'))
		.toBeVisible()

	const nextButton = page.getByRole('button', { name: 'Next', exact: true })
	await expect(nextButton)
		.toBeEnabled()
	await nextButton.click()
	await expect(rail.getByText('Step 2 of 9'))
		.toBeVisible()

	// Give a (coalesced, and therefore nonexistent) second start() call every chance to have landed —
	// the step must never be silently reset back to step 1 by a later-completing duplicate request.
	await page.waitForTimeout(500)
	await expect(rail.getByText('Step 2 of 9'))
		.toBeVisible()
	await expect(rail.getByText('Step 1 of 9'))
		.toHaveCount(0)
})

test('rail geometry: at the 900px minimum-supported width, the real action-bearing Survey controls stay usable with the tour open', async ({ page }) => {
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

	for (const name of ['Author', 'Blueprint', 'Runtime', 'Graph', 'Preview']) {
		await expect(page.getByRole('tab', { name }))
			.toBeVisible()
	}
	await page.getByRole('tab', { name: 'Blueprint' })
		.click()
	await expect(page.getByRole('tab', { name: 'Blueprint' }))
		.toHaveAttribute('aria-selected', 'true')

	// The rail itself must also be fully on-screen, not clipped past the viewport's own right edge.
	const rail = page.getByRole('complementary', { name: RAIL_LABEL })
	const railBox = await rail.boundingBox()
	expect(railBox)
		.not.toBeNull()
	expect(railBox!.x + railBox!.width)
		.toBeLessThanOrEqual(900)

	/**
	 * The geometry claims above are necessary but not sufficient (merge-gate review blocker 2): the rail
	 * is a `position: fixed` 320px overlay directly over the persistent Preview, which at 900px leaves
	 * only ~220px of Preview's own ~540px width actually unclipped. Rather than assert around that
	 * occlusion, this runs the real, representative action-bearing tour path — Adults, Return date
	 * break+fix, Children, Submit, Generate result — with the rail open the entire time, using the exact
	 * same real `getByLabel()`/`getByRole()` interactions the full walkthrough test uses. Playwright's
	 * actionability checks (an element must be visible AND not obscured by another element at its click
	 * point) would fail/timeout here if the rail actually covered any of these controls — this test
	 * passing IS the proof the required controls stay usable, not an assumption.
	 */
	const nextButton = page.getByRole('button', { name: 'Next', exact: true })
	await nextButton.click() // step 1 -> 2

	const adults = page.getByLabel('Adults', { exact: true })
	await adults.fill('5')
	await adults.press('Tab')
	await expect(rail.getByText('The Live estimate just updated.', { exact: false }))
		.toBeVisible()
	await expect(nextButton)
		.toBeEnabled()
	await nextButton.click() // step 2 -> 3
	await nextButton.click() // step 3 -> 4

	const returnDate = page.getByLabel('Return date')
	await returnDate.fill('2027-04-01')
	await returnDate.press('Tab')
	await expect(rail.getByText('Trip days fails with a reason', { exact: false }))
		.toBeVisible()
	await returnDate.fill('2027-04-20')
	await returnDate.press('Tab')
	await expect(rail.getByText('The same Properties recovered.', { exact: false }))
		.toBeVisible()
	await expect(nextButton)
		.toBeEnabled()
	await nextButton.click() // step 4 -> 5

	const children = page.getByLabel('Children', { exact: true })
	await children.fill('2')
	await children.press('Tab')
	await expect(page.getByText('What matters most while traveling with children?'))
		.toBeVisible()
	await children.fill('0')
	await children.press('Tab')
	await expect(nextButton)
		.toBeEnabled()
	await nextButton.click() // step 5 -> 6

	await page.getByRole('button', { name: 'Submit', exact: true })
		.click()
	await page.getByRole('button', { name: 'Generate result', exact: true })
		.click()
	await expect(page.getByRole('heading', { name: 'Recommendation' }))
		.toBeVisible()
	await expect(nextButton)
		.toBeEnabled()
})

test('full Survey tour end-to-end via real interactions, each observation appearing only after its action, then restart from the header button', async ({ page }) => {
	await page.goto('/')
	await startTourFromHeader(page)

	const rail = page.getByRole('complementary', { name: RAIL_LABEL })
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
	await expect(rail.getByText('Author = the declarative definition and structure you edit', { exact: false }))
		.toBeVisible()
	await rail.getByRole('button', { name: 'Runtime', exact: true })
		.click()
	await expect(page.getByRole('tab', { name: 'Runtime' }))
		.toHaveAttribute('aria-selected', 'true')
	await rail.getByRole('button', { name: 'Author', exact: true })
		.click()
	await expect(page.getByRole('tab', { name: 'Author' }))
		.toHaveAttribute('aria-selected', 'true')
	// "Implementation" is a real affordance now (issue #25 P3): opens the closable Implementation panel
	// for whichever widget is currently held in shared focus — `trip-survey`, from step 7's `onEnter`.
	await rail.getByRole('button', { name: 'Implementation', exact: true })
		.click()
	await expect(page.getByRole('tab', { name: 'Implementation' }))
		.toHaveAttribute('aria-selected', 'true')
	await expect(page.getByText('TripSurvey', { exact: true }))
		.toBeVisible()
	await nextButton.click()

	// Step 9 — hand-back: "Finish" replaces "Next" on the last step.
	await expect(rail.getByText('Try the CRM tour, open any inspector, or edit the Author JSON and press Apply.'))
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
