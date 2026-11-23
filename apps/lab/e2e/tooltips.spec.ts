import type { Page } from '@playwright/test'
import { editJson, expect, test, waitForLabTestSeam } from './fixtures'

/**
 * Keyboard users get the header buttons' tooltips (issue #230 PR 3b follow-up). A disabled edit button (Undo) explains
 * itself only in its tooltip, so tabbing onto it must always show that tooltip. Since Lab UX phase 3 the header's edit
 * buttons are Undo and, while the JSON text does not parse, "Discard JSON changes": the specs open the Lab in that state
 * so there are two tooltip buttons side by side to tab between.
 *
 * Root cause this pins: Reka keeps a closed tooltip's content mounted until its exit animation has ended, and a
 * mounted content hears the "a tooltip opened" event of the next open, including the one of its OWN trigger being
 * focused again, and closes that tooltip right away. On a page where animations are late (busy or throttled: closed
 * tooltips were seen mounted seconds later) a button reached with Tab sometimes showed nothing. `nuxt-ui.ts` removes
 * the tooltips' exit animation, so a closed tooltip unmounts at once. The first test makes the failure deterministic:
 * every tooltip animation is stretched to ten minutes, so without the fix a tooltip that was closed is still mounted
 * (and kills its own next open) when its button is reached again.
 */

const BUTTONS = [
	{ id: 'discard-json-button', tooltip: 'Throw away the JSON text that can\'t be applied and show the document again' },
	{ id: 'undo-button', tooltip: 'Fix or discard the JSON that can\'t be applied before undoing' },
] as const

const OPEN_TOOLTIP = '[data-slot="content"][data-state="delayed-open"], [data-slot="content"][data-state="instant-open"]'

async function openLab(page: Page): Promise<void> {
	await page.goto('/?lab-test&showcase=sandbox')
	await waitForLabTestSeam(page)
	await editJson(page, '{ "id": "root"')
	await expect(page.getByTestId('discard-json-button'))
		.toBeVisible()
	// The page has settled: Edit shows its first view (Structure since Lab UX phase 1).
	await expect(page.getByTestId('structure-editor'))
		.toBeVisible()
}

/** One real key press, then the button must hold focus and be the only open tooltip, with its own text. */
async function pressAndExpectTooltip(page: Page, key: 'Tab' | 'Shift+Tab', id: string, tooltip: string): Promise<void> {
	await page.keyboard.press(key)
	await expect(page.getByTestId(id), `${key} should land on ${id}`)
		.toBeFocused()
	const open = page.locator(OPEN_TOOLTIP)
	await expect(open, `${id}: exactly one tooltip is open`)
		.toHaveCount(1)
	await expect(open, `${id}: it is this button's tooltip`)
		.toHaveText(new RegExp(tooltip.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')))
	await expect(open)
		.toBeVisible()
}

/** Tab forward through the buttons, then back (Shift+Tab), `rounds` times; every stop must show its tooltip. */
async function tabThroughButtons(page: Page, rounds: number): Promise<void> {
	// Start the way a keyboard user does: from the control before the buttons, by key.
	await page.getByTestId('status-details')
		.focus()
	await pressAndExpectTooltip(page, 'Tab', BUTTONS[0].id, BUTTONS[0].tooltip)
	for (let round = 0; round < rounds; round++) {
		for (const button of BUTTONS.slice(1))
			await pressAndExpectTooltip(page, 'Tab', button.id, button.tooltip)
		for (const button of [...BUTTONS].reverse()
			.slice(1))
			await pressAndExpectTooltip(page, 'Shift+Tab', button.id, button.tooltip)
	}
}

test.describe('header button tooltips with the keyboard', () => {
	test('Tab and Shift+Tab always show the tooltip, even when tooltip animations are very late', async ({ page }) => {
		await openLab(page)
		// Stretch every tooltip animation to ten minutes: whatever would wait for an animation end never ends.
		await page.addStyleTag({ content: '[data-slot="content"] { animation-duration: 600s !important; animation-delay: 0s !important; }' })
		await tabThroughButtons(page, 5)
	})

	test('Tab and Shift+Tab show the tooltip at every stop over many rounds', async ({ page }) => {
		await openLab(page)
		await tabThroughButtons(page, 12)
	})

	test('a closed tooltip is gone at once, not left mounted for an exit animation', async ({ page }) => {
		await openLab(page)
		await page.getByTestId('status-details')
			.focus()
		await page.keyboard.press('Tab')
		await expect(page.getByTestId('discard-json-button'))
			.toBeFocused()
		await expect(page.locator(OPEN_TOOLTIP))
			.toHaveCount(1)
		await page.keyboard.press('Tab')
		await expect(page.getByTestId('undo-button'))
			.toBeFocused()
		// Exactly one tooltip element is in the DOM: Discard's closed one did not stay behind.
		await expect(page.locator('[data-reka-popper-content-wrapper]'))
			.toHaveCount(1)
	})
})
