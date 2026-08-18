import { defaultSandboxPreset } from '../src/sandbox/presets'
import { expect, test } from './fixtures'

const GATE_TEXT = 'Widget Lab is designed for a desktop-sized viewport. Widen the window to continue.'

interface LabTestWindow {
	__WIDGET_LAB_TEST__?: {
		setDraftSourceText: (text: string) => void
	}
}

test.describe('narrow-viewport native-dialog ownership (issue #45)', () => {
	test.describe('first-entry welcome', () => {
		test.use({ welcomeDismissed: false })

		test('the gate suppresses the top-layer welcome without dismissing it, then widening restores it', async ({ page }) => {
			await page.setViewportSize({ width: 375, height: 667 })
			await page.goto('/')

			await expect(page.getByText(GATE_TEXT))
				.toBeVisible()
			await expect(page.getByRole('dialog'))
				.toBeHidden()

			await page.setViewportSize({ width: 1280, height: 800 })
			await expect(page.getByText(GATE_TEXT))
				.toBeHidden()
			await expect(page.getByRole('dialog'))
				.toBeVisible()

			// Shrink again: the same welcome remains pending rather than being interpreted as Cancel.
			await page.setViewportSize({ width: 375, height: 667 })
			await expect(page.getByRole('dialog'))
				.toBeHidden()
			await page.setViewportSize({ width: 1280, height: 800 })
			await expect(page.getByRole('dialog'))
				.toBeVisible()
		})
	})

	test('the dirty-draft confirmation survives shrink/widen without applying or losing the draft', async ({ page }) => {
		await page.goto('/?lab-test')
		await page.waitForFunction(() => typeof (window as unknown as LabTestWindow).__WIDGET_LAB_TEST__?.setDraftSourceText === 'function')

		// Use a known-valid Source fixture through the same LabStore seam as the Apply contracts. Reading
		// Monaco's tokenized DOM to reconstruct Source would couple this viewport test to editor painting
		// and could produce invalid JSON before the modal contract is even exercised.
		const draft = defaultSandboxPreset.sourceText.replace('Widget Lab sandbox', 'Widget Lab sandbox dirtied by viewport test')
		await page.evaluate((source) => {
			const seam = (window as unknown as LabTestWindow).__WIDGET_LAB_TEST__
			seam?.setDraftSourceText(source)
		}, draft)

		await page.getByRole('button', { name: 'Tutorial', exact: true })
			.click()
		const confirm = page.getByRole('alertdialog')
		await expect(confirm)
			.toBeVisible()

		await page.setViewportSize({ width: 375, height: 667 })
		await expect(page.getByText(GATE_TEXT))
			.toBeVisible()
		await expect(confirm)
			.toBeHidden()

		await page.setViewportSize({ width: 1280, height: 800 })
		await expect(confirm)
			.toBeVisible()
		await confirm.getByRole('button', { name: 'Cancel' })
			.click()

		// Cancel kept the draft intact and unapplied: Source still contains the marker after the top-layer
		// suppression/reopen cycle, while Preview must still render the prior applied snapshot.
		await expect(page.locator('.view-lines'))
			.toContainText('dirtied by viewport test')
		await expect(page.locator('[data-tutorial-target="preview"]')
			.getByText('Widget Lab sandbox dirtied by viewport test', { exact: true }))
			.toHaveCount(0)
	})
})

test('Implementation owns long-line overflow locally at the 900px minimum supported width', async ({ page }) => {
	await page.setViewportSize({ width: 900, height: 800 })
	await page.goto('/')
	await page.getByRole('button', { name: 'Implementation', exact: true })
		.click()

	const catalog = page.getByRole('navigation', { name: 'Registered plugins' })
	await expect(catalog)
		.toBeVisible()
	await catalog.getByRole('button', { name: 'Summary', exact: true })
		.click()

	const code = page.getByTestId('implementation-code')
	await expect(code)
		.toBeVisible()
	await expect(code)
		.toContainText('createWidgetPlugin')

	const documentOverflow = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth)
	expect(documentOverflow)
		.toBe(false)

	const sourceScroll = code.locator('..')
	const overflow = await sourceScroll.evaluate(element => ({
		clientWidth: element.clientWidth,
		scrollWidth: element.scrollWidth,
	}))
	expect(overflow.scrollWidth)
		.toBeGreaterThan(overflow.clientWidth)
})
