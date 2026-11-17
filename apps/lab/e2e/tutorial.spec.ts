import type { Locator, Page } from '@playwright/test'
import { chooseTutorialMenuItem, expect, expectShowcase, previewFrame, test } from './fixtures'

/**
 * Issue #25 P1 tutorial contract. `fixtures.ts` pre-dismisses the Welcome card for every test in this
 * file EXCEPT the "welcome card" describe block below, which opts back in via `welcomeDismissed: false`
 * to exercise the real first-load card — see `fixtures.ts`'s header comment for the mechanism.
 *
 * Starting the tour from the default Survey showcase only reloads its `survey-default` preset; starting it from
 * the hidden Sandbox fixture (`?showcase=sandbox`, dirty-draft tests) switches to Survey through the deterministic-start
 * pipeline (`use-tutorial.ts`). Either way every test below waits for the rail to actually appear before
 * interacting with Survey's own controls.
 *
 * Merge-gate review (round 1) additions: dialog focus/Escape contracts (blocker 1), a real-interaction
 * 900px geometry contract (blocker 2), and a rapid-double-click re-entrancy contract (blocker 3).
 */

const RAIL_LABEL = 'Tutorial'
const WELCOME_TITLE = 'Widget Lab lets you change a real app, then see where that behavior comes from.'
const CONFIRM_TITLE = 'Starting the tutorial will load the Survey teaching example and replace your unapplied changes.'

async function startTourFromHeader(page: Page): Promise<void> {
	await chooseTutorialMenuItem(page)
	await expect(page.getByRole('complementary', { name: RAIL_LABEL }))
		.toBeVisible()
}

/**
 * Real, meaningful containment contract for a native `<dialog>`: `showModal()` makes the rest of the page `inert`, but
 * Tab past the dialog's last focusable control briefly rests focus on `document.body` before the next Tab
 * cycles back to the dialog's first control — so "focus is either inside the (one, currently open) dialog
 * or on `document.body`, never an outside interactive element" is what is actually sampled, across a few
 * Tab/Shift+Tab presses in both directions.
 */
async function modalFocusLocation(page: Page): Promise<'body' | 'dialog' | 'outside'> {
	return page.evaluate(() => {
		const active = document.activeElement
		const dialogEl = document.querySelector('dialog[open]')
		if (active === document.body)
			return 'body'
		if (dialogEl !== null && dialogEl.contains(active))
			return 'dialog'
		return 'outside'
	})
}

async function sampleTabContainment(page: Page): Promise<void> {
	for (let i = 0; i < 5; i++) {
		await page.keyboard.press('Tab')
		const location = await modalFocusLocation(page)
		expect(location)
			.not.toBe('outside')
		if (location === 'body') {
			// Chromium's native modal focus algorithm may transiently rest on BODY at the edge; the
			// very next Tab must recover into the dialog rather than leave focus there.
			await page.keyboard.press('Tab')
			expect(await modalFocusLocation(page))
				.toBe('dialog')
		}
	}
	for (let i = 0; i < 5; i++) {
		await page.keyboard.press('Shift+Tab')
		const location = await modalFocusLocation(page)
		expect(location)
			.not.toBe('outside')
		if (location === 'body') {
			await page.keyboard.press('Shift+Tab')
			expect(await modalFocusLocation(page))
				.toBe('dialog')
		}
	}
}

/**
 * WCAG 2.2 SC 2.5.8 "Target Size (Minimum)": the smallest pointer target a control may expose.
 */
const MIN_TARGET_SIZE_PX = 24

/**
 * Clicks a Preview control through the part of it the tutorial rail does NOT cover, after proving that
 * part is at least a minimum-size pointer target.
 *
 * At the 900px minimum-supported width the `position: fixed` rail overlays the right ~320px of the
 * persistent Preview by design (`TutorialRail.vue`'s viewport contract), so several required Survey
 * controls straddle the rail's left edge in every environment. A plain `locator.click()` hit-tests only
 * the control's center point, which made the old contract depend on whether font metrics happened to
 * put "Generate result"'s center left of the rail edge (CI) or ~0.7px right of it (macOS system font).
 * This measures the unobscured slice explicitly instead, then clicks inside it with Playwright's normal
 * actionability checks — the click still fails if the rail (or anything else) intercepts that point.
 */
async function clickBesideRail(page: Page, control: Locator): Promise<void> {
	await control.scrollIntoViewIfNeeded()
	const railBox = await page.getByRole('complementary', { name: RAIL_LABEL })
		.boundingBox()
	const controlBox = await control.boundingBox()
	expect(railBox)
		.not.toBeNull()
	expect(controlBox)
		.not.toBeNull()
	const unobscuredWidth = Math.min(controlBox!.x + controlBox!.width, railBox!.x) - controlBox!.x
	expect(unobscuredWidth, 'unobscured width left of the tutorial rail')
		.toBeGreaterThanOrEqual(MIN_TARGET_SIZE_PX)
	expect(controlBox!.height)
		.toBeGreaterThanOrEqual(MIN_TARGET_SIZE_PX)
	await control.click({ position: { x: unobscuredWidth / 2, y: controlBox!.height / 2 } })
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
		await page.getByTestId('overflow-menu')
			.click()
		await expect(page.getByRole('menuitem', { name: 'Tutorial', exact: true }))
			.toBeEnabled()
		await page.keyboard.press('Escape')

		// Lab use is fully unaffected.
		await expect(page.getByRole('tab', { name: 'Author' }))
			.toBeVisible()
	})

	test('"Start the tour" dismisses the welcome card and begins the Survey tour', async ({ page }) => {
		// Start from the hidden Sandbox fixture so the selector's final `survey` value proves the switch.
		await page.goto('/?showcase=sandbox')
		await expectShowcase(page, 'sandbox')
		await page.getByRole('button', { name: 'Start the tour' })
			.click()

		await expect(page.getByRole('dialog', { name: WELCOME_TITLE }))
			.toHaveCount(0)
		await expect(page.getByRole('complementary', { name: RAIL_LABEL }))
			.toBeVisible()
		await expectShowcase(page, 'survey')
	})
})

test('skipping the tour leaves the Lab fully usable', async ({ page }) => {
	await page.goto('/')
	await startTourFromHeader(page)

	await page.getByRole('button', { name: 'Skip tour' })
		.click()
	await expect(page.getByRole('complementary', { name: RAIL_LABEL }))
		.toHaveCount(0)

	for (const name of ['Author', 'Blueprint', 'Runtime', 'Dependencies', 'Preview']) {
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
		await page.goto('/?lab-test&showcase=sandbox')
		await page.waitForFunction(() => typeof (window as unknown as LabTestWindow).__WIDGET_LAB_TEST__?.setDraftSourceText === 'function')
		// Dirty the (hidden Sandbox fixture) draft via the issue #28 interaction seam — never touches Monaco.
		await page.evaluate((source) => {
			(window as unknown as LabTestWindow).__WIDGET_LAB_TEST__?.setDraftSourceText(source)
		}, '{ "id": "root", "type": "Text", "config": { "text": "dirtied by test" } }')
		await expect(page.getByRole('button', { name: 'Apply' }))
			.toBeEnabled()
	}

	test('appears before starting, moves focus in, keeps the background out of the keyboard focus order, and Cancel preserves the draft while restoring focus to the header button', async ({ page }) => {
		await dirtyTheDraft(page)

		const initiator = page.getByTestId('overflow-menu')
		await chooseTutorialMenuItem(page)

		const confirmDialog = page.getByRole('alertdialog', { name: CONFIRM_TITLE })
		await expect(confirmDialog)
			.toBeVisible()

		// Opening moves focus into the dialog, to its first control ("Start tour").
		const startTourButton = page.getByRole('button', { name: 'Start tour' })
		await expect(startTourButton)
			.toBeFocused()

		// Background workbench controls (including the header menu that opened this) are not
		// keyboard-reachable while this is modal.
		await sampleTabContainment(page)

		await page.getByRole('button', { name: 'Cancel' })
			.click()
		await expect(confirmDialog)
			.toHaveCount(0)
		// Closing restores focus to the initiating control (the header menu's trigger: the Tutorial item
		// itself is gone once its menu closed).
		await expect(initiator)
			.toBeFocused()

		// Cancel touched nothing: the draft is still dirty and no tour started.
		await expect(page.getByRole('button', { name: 'Apply' }))
			.toBeEnabled()
		await expect(page.getByRole('complementary', { name: RAIL_LABEL }))
			.toHaveCount(0)
		await expect(previewFrame(page)
			.getByText('Widget Lab sandbox', { exact: true }))
			.toBeVisible() // Preview still shows the ORIGINAL applied text — the draft was never applied
		// Scoped to Preview on purpose: the dirty draft's text legitimately appears in the Source
		// panel's Monaco DOM (that IS the preserved draft) — asserting a page-wide count of 0 was a
		// race against Monaco's async render (it passed only before the editor painted the new text,
		// which is exactly what slower CI exposed). The contract is "never APPLIED": Preview must not
		// render it, while the Source editor visibly retaining it proves preservation.
		await expect(previewFrame(page)
			.getByText('dirtied by test'))
			.toHaveCount(0)
		await expect(page.locator('.view-lines')
			.getByText('dirtied by test'))
			.toBeVisible()
	})

	test('Escape is the safe Cancel path — preserves the draft and restores focus, same as the Cancel button', async ({ page }) => {
		await dirtyTheDraft(page)

		const initiator = page.getByTestId('overflow-menu')
		await chooseTutorialMenuItem(page)

		const confirmDialog = page.getByRole('alertdialog', { name: CONFIRM_TITLE })
		await expect(confirmDialog)
			.toBeVisible()

		await page.keyboard.press('Escape')
		await expect(confirmDialog)
			.toHaveCount(0)
		await expect(initiator)
			.toBeFocused()

		await expect(page.getByRole('button', { name: 'Apply' }))
			.toBeEnabled()
		await expect(page.getByRole('complementary', { name: RAIL_LABEL }))
			.toHaveCount(0)
		// Same Preview-scoped assertion as the Cancel-button test above (see the comment there): the
		// draft text belongs in the Source editor's DOM; only Preview must never show it un-applied.
		await expect(previewFrame(page)
			.getByText('dirtied by test'))
			.toHaveCount(0)
		await expect(page.locator('.view-lines')
			.getByText('dirtied by test'))
			.toBeVisible()

		// The guard was released by Escape/Cancel — a fresh request is accepted, not coalesced away.
		await chooseTutorialMenuItem(page)
		await page.getByRole('button', { name: 'Start tour' })
			.click()
		await expect(page.getByRole('complementary', { name: RAIL_LABEL }))
			.toBeVisible()
		await expectShowcase(page, 'survey')
	})
})

test('rapid double-click on the header Tutorial button starts the tour exactly once and never resets it mid-interaction', async ({ page }) => {
	await page.goto('/')

	// Two synthetic clicks dispatched in the SAME synchronous browser-side task — this is the realistic
	// race `start-request.ts`'s guard exists for: a second activation landing before the menu has closed
	// and Vue has patched the real DOM, not merely two well-spaced Playwright `.click()` calls.
	await page.getByTestId('overflow-menu')
		.click()
	await expect(page.getByRole('menuitem', { name: 'Tutorial', exact: true }))
		.toBeVisible()
	await page.evaluate(() => {
		const item = Array.from(document.querySelectorAll('[role="menuitem"]'))
			.find(candidate => candidate.textContent?.trim() === 'Tutorial') as HTMLElement | undefined
		item?.click()
		item?.click()
	})

	const rail = page.getByRole('complementary', { name: RAIL_LABEL })
	await expect(rail)
		.toBeVisible()
	await expectShowcase(page, 'survey')
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

	for (const name of ['Author', 'Blueprint', 'Runtime', 'Dependencies', 'Preview']) {
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
	 * occlusion, this runs the real, representative action-bearing tour path — "On site", Guests error and
	 * recovery, Online and back, a session, Phone number, Submit — with the rail open the entire time, using the exact
	 * same real `getByLabel()`/`getByRole()` locators the full walkthrough test uses. Each control is
	 * pointer-targeted through `clickBesideRail()`, which requires a minimum-size slice of it to remain
	 * uncovered by the rail and clicks inside that slice with Playwright's actionability checks (visible,
	 * enabled, stable, and not obscured at the click point) — so this passes only if every required
	 * control stays reachable, independent of where font metrics put the control's center relative to
	 * the rail's left edge.
	 */
	const nextButton = page.getByRole('button', { name: 'Next', exact: true })
	await nextButton.click() // step 1 -> 2

	const preview = previewFrame(page)
	await clickBesideRail(page, preview.getByLabel('On site', { exact: true }))
	await expect(rail.getByText('Guests and Phone reacted.', { exact: false }))
		.toBeVisible()
	await expect(nextButton)
		.toBeEnabled()
	await nextButton.click() // step 2 -> 3
	await nextButton.click() // step 3 -> 4

	const guests = preview.getByLabel('Guests coming with you')
	await clickBesideRail(page, guests)
	await guests.fill('5')
	await expect(rail.getByText('Guests reports an error, yet your number is still stored', { exact: false }))
		.toBeVisible()
	await guests.fill('2')
	await expect(rail.getByText('The error is gone.', { exact: false }))
		.toBeVisible()
	await expect(nextButton)
		.toBeEnabled()
	await nextButton.click() // step 4 -> 5

	await clickBesideRail(page, preview.getByLabel('Online', { exact: true }))
	await expect(preview.getByText('Guests coming with you'))
		.toHaveCount(0)
	await clickBesideRail(page, preview.getByLabel('On site', { exact: true }))
	await expect(preview.getByText('Guests coming with you'))
		.toBeVisible()
	await expect(nextButton)
		.toBeEnabled()
	await nextButton.click() // step 5 -> 6

	await clickBesideRail(page, preview.getByLabel('3D printing basics'))
	const phone = preview.getByLabel('Phone number')
	await clickBesideRail(page, phone)
	await phone.fill('0912 345 678')
	await clickBesideRail(page, preview.getByRole('button', { name: 'Submit', exact: true }))
	await expect(preview.getByTestId('survey-submitted'))
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
	const preview = previewFrame(page)

	// Step 1 — orient: no action needed, reveals immediately.
	await expect(rail.getByText('This is the Interactive Survey — a sign-up form rendered from one JSON definition.'))
		.toBeVisible()
	await expect(nextButton)
		.toBeEnabled()
	await nextButton.click()

	// Step 2 — State: observation must NOT be visible before the real action. Also confirms the spotlight
	// mechanism (CSS class toggling onto the step's `data-tutorial-target` element, never a
	// position-cloned overlay) actually reaches the real Preview DOM, not just the rail's own copy.
	const stateObservation = rail.getByText('Guests and Phone reacted.', { exact: false })
	await expect(stateObservation)
		.toHaveCount(0)
	await expect(nextButton)
		.toBeDisabled()
	await expect(preview.locator('[data-tutorial-target="survey-mode"]'))
		.toHaveClass(/tutorial-spotlight/)

	// "Online" is not the scripted answer: the observation must wait for "On site".
	await preview.getByLabel('Online', { exact: true })
		.check()
	await expect(preview.getByLabel('Online', { exact: true }))
		.toBeChecked()
	await expect(stateObservation)
		.toHaveCount(0)
	await preview.getByLabel('On site', { exact: true })
		.check()

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
	await expect(rail.getByText('The required message under "How will you join?" disappeared, and Phone now says it is required.', { exact: false }))
		.toBeVisible()
	await expect(nextButton)
		.toBeEnabled()
	await nextButton.click()

	// Step 4 — an answer error, then recovery, inside the same step.
	const errorObservation = rail.getByText('Guests reports an error, yet your number is still stored', { exact: false })
	await expect(errorObservation)
		.toHaveCount(0)
	await expect(preview.locator('[data-tutorial-target="survey-guests"]'))
		.toHaveClass(/tutorial-spotlight/)
	const guests = preview.getByLabel('Guests coming with you')
	await guests.fill('5')

	await expect(errorObservation)
		.toBeVisible()
	await expect(preview.getByTestId('survey-question-error')
		.filter({ hasText: 'at most 3' }))
		.toBeVisible()
	await expect(nextButton)
		.toBeDisabled()
	const recoveryObservation = rail.getByText('The error is gone.', { exact: false })
	await expect(recoveryObservation)
		.toHaveCount(0)

	await guests.fill('2')

	await expect(recoveryObservation)
		.toBeVisible()
	await expect(nextButton)
		.toBeEnabled()
	await nextButton.click()

	// Step 5 — dependency: disappear, then come back still holding 2 (keeps the script submittable at step 6).
	const guestsQuestion = preview.getByText('Guests coming with you')
	await expect(guestsQuestion)
		.toBeVisible()
	const hiddenObservation = rail.getByText('Guests disappeared.', { exact: false })
	await expect(hiddenObservation)
		.toHaveCount(0)

	await preview.getByLabel('Online', { exact: true })
		.check()

	await expect(guestsQuestion)
		.toHaveCount(0)
	await expect(hiddenObservation)
		.toBeVisible()
	await expect(nextButton)
		.toBeDisabled()

	await preview.getByLabel('On site', { exact: true })
		.check()

	await expect(guestsQuestion)
		.toBeVisible()
	await expect(guests)
		.toHaveValue('2')
	await expect(rail.getByText('Guests is back, still holding your answer', { exact: false }))
		.toBeVisible()
	await expect(nextButton)
		.toBeEnabled()
	await nextButton.click()

	// Step 6 — a direct State write vs. a Method: the answers, then Submit.
	const methodObservation = rail.getByText('Submit invokes a named Method', { exact: false })
	await expect(methodObservation)
		.toHaveCount(0)
	await expect(preview.getByTestId('survey-submitted'))
		.toHaveCount(0)

	await preview.getByLabel('3D printing basics')
		.check()
	await preview.getByLabel('Phone number')
		.fill('0912 345 678')
	// `exact: true` on purpose: the Runtime tab (activated via step 2's "See it in Runtime" link, and
	// still mounted though inactive) has its own "submit() writes ..." Method-row text, which a
	// non-exact substring match on "Submit" would ambiguously also match.
	await preview.getByRole('button', { name: 'Submit', exact: true })
		.click()

	await expect(preview.getByTestId('survey-submitted'))
		.toBeVisible()
	await expect(methodObservation)
		.toBeVisible()
	await expect(nextButton)
		.toBeEnabled()
	await nextButton.click()

	// Step 7 — snapshot vs. live: mutating an answer after Submit is the real interaction. The rail's own
	// reveal text mentions the marker too (in a longer sentence), so the Preview check is scoped to its
	// test id.
	const staleObservation = rail.getByText('gained the "Answers changed since you submitted" marker', { exact: false })
	await expect(staleObservation)
		.toHaveCount(0)
	await expect(preview.getByTestId('survey-changed-since-submit'))
		.toHaveCount(0)

	await guests.fill('1')

	await expect(preview.getByTestId('survey-changed-since-submit'))
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
	// for whichever widget is currently held in shared focus — `open-day` (a `Survey`), from step 7's
	// `onEnter`. The locator is scoped to the Implementation panel on purpose: the plain word "Survey"
	// also appears elsewhere on the page.
	await rail.getByRole('button', { name: 'Implementation', exact: true })
		.click()
	await expect(page.getByRole('tab', { name: 'Implementation' }))
		.toHaveAttribute('aria-selected', 'true')
	const implementationPanel = page.getByRole('tabpanel', { name: 'Implementation' })
	await expect(implementationPanel.getByText('Survey', { exact: true }))
		.toBeVisible()
	await expect(implementationPanel.getByRole('button', { name: 'SurveyRootRenderer.vue', exact: true }))
		.toBeVisible()
	await nextButton.click()

	// Step 9 — hand-back: "Finish" replaces "Next" on the last step.
	await expect(rail.getByText('Open any inspector, or edit the Author JSON and press Apply.'))
		.toBeVisible()
	await expect(finishButton)
		.toBeEnabled()
	await finishButton.click()

	await expect(rail)
		.toHaveCount(0)
	await page.getByTestId('overflow-menu')
		.click()
	await expect(page.getByRole('menuitem', { name: 'Restart tutorial', exact: true }))
		.toBeVisible()
	await page.keyboard.press('Escape')

	// Restart from the header menu works after completion.
	await chooseTutorialMenuItem(page, 'Restart tutorial')
	await expect(rail)
		.toBeVisible()
	await expect(rail.getByText('This is the Interactive Survey — a sign-up form rendered from one JSON definition.'))
		.toBeVisible()
	await expect(rail.getByText('Step 1 of 9'))
		.toBeVisible()
})
