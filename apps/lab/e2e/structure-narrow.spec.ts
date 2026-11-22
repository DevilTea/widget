import { chooseTutorialMenuItem, expect, test } from './fixtures'

/** Lab UX phase 2, report item 15: Structure stays usable at 1280x800 with the tutorial rail open. */

test.describe('Structure with the tutorial rail open at 1280x800 (report item 15)', () => {
	test.use({ viewport: { width: 1280, height: 800 } })

	test('fields keep at least 120px, and no control covers another', async ({ page }) => {
		await page.goto('/?showcase=survey')
		await chooseTutorialMenuItem(page)
		await expect(page.getByRole('complementary', { name: 'Tutorial' }))
			.toBeVisible()
		const editor = page.getByTestId('structure-editor')
		await expect(editor)
			.toBeVisible()
		// The tour selects `open-day` as its first step is entered: wait for that before selecting another widget.
		await expect(page.getByRole('complementary', { name: 'Tutorial' })
			.getByText('Step 1 of 10'))
			.toBeVisible()

		for (const [widget, heading] of [[/^open-day : Survey/, 'open-day : Survey'], [/^guests : Numeric/, 'guests : Numeric']] as const) {
			await page.getByRole('button', { name: widget })
				.click()
			await expect(editor.getByRole('heading', { name: heading }))
				.toBeVisible()
			const boxes = editor.locator('input[type="text"], select, textarea')
			const count = await boxes.count()
			expect(count)
				.toBeGreaterThan(2)
			for (let index = 0; index < count; index++) {
				const box = await boxes.nth(index)
					.boundingBox()
				expect(box, `control ${index}`)
					.not
					.toBeNull()
				expect(box!.width, `control ${index} of ${String(widget)}`)
					.toBeGreaterThanOrEqual(119.5)
			}
			// No two controls (boxes and buttons) of the editor overlap.
			const rects = await editor.locator('input, select, textarea, button')
				.evaluateAll(elements => elements
					.filter(element => (element as HTMLElement).offsetParent !== null)
					.map((element) => {
						const rect = element.getBoundingClientRect()
						return { name: element.getAttribute('aria-label') ?? element.textContent?.trim() ?? element.tagName, left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom }
					}))
			const overlaps: string[] = []
			for (let a = 0; a < rects.length; a++) {
				for (let b = a + 1; b < rects.length; b++) {
					const first = rects[a]!
					const second = rects[b]!
					const overlapX = Math.min(first.right, second.right) - Math.max(first.left, second.left)
					const overlapY = Math.min(first.bottom, second.bottom) - Math.max(first.top, second.top)
					if (overlapX > 1 && overlapY > 1)
						overlaps.push(`${first.name} / ${second.name}`)
				}
			}
			expect(overlaps)
				.toEqual([])
			// Nothing is pushed out sideways.
			expect(await editor.evaluate(element => element.scrollWidth <= element.clientWidth + 1))
				.toBe(true)
		}
	})
})
