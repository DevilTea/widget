import { expect, test } from './fixtures'

/** Issue #46: literal U+0009 tabs have one four-column presentation contract in both code surfaces. */
test.describe('code-view tab width (issue #46)', () => {
	test('Source Monaco renders one literal tab at the same visual indent as four spaces', async ({ page }) => {
		interface LabTestWindow { __WIDGET_LAB_TEST__?: { setDraftSourceText: (text: string) => void } }

		await page.goto('/?lab-test')
		await expect(page.locator('.monaco-editor'))
			.toBeVisible()
		await page.waitForFunction(() => typeof (window as unknown as LabTestWindow).__WIDGET_LAB_TEST__?.setDraftSourceText === 'function')

		const source = '{\n\t"tabbed": true,\n    "spaced": true\n}'
		await page.evaluate((text) => {
			(window as unknown as LabTestWindow).__WIDGET_LAB_TEST__?.setDraftSourceText(text)
		}, source)

		const viewLines = page.locator('.view-lines')
		await expect(viewLines)
			.toContainText('tabbed')
		await expect(viewLines)
			.toContainText('spaced')

		const positions = await viewLines.evaluate((root) => {
			function textLeft(label: string): number {
				for (const line of root.querySelectorAll<HTMLElement>('.view-line')) {
					const walker = document.createTreeWalker(line, NodeFilter.SHOW_TEXT)
					while (walker.nextNode()) {
						const node = walker.currentNode as Text
						const index = node.data.indexOf(label)
						if (index < 0)
							continue
						const range = document.createRange()
						range.setStart(node, index)
						range.setEnd(node, index + 1)
						return range.getBoundingClientRect().left
					}
				}
				throw new Error(`Could not find rendered Monaco token: ${label}`)
			}

			return {
				tabbed: textLeft('tabbed'),
				spaced: textLeft('spaced'),
			}
		})

		// This is deliberately a geometry assertion rather than a source-text assertion: with the old
		// 2-column Monaco option, or the browser/default 8-column behavior, these token positions differ.
		expect(Math.abs(positions.tabbed - positions.spaced))
			.toBeLessThan(1)
	})

	test('readonly Implementation/Shiki source inherits the four-column CSS tab width', async ({ page }) => {
		await page.goto('/')
		await page.getByRole('tab', { name: 'Blueprint' })
			.click()
		await page.getByRole('button', { name: 'title : Text' })
			.click()
		await page.getByTestId('blueprint-view-implementation')
			.click()

		const code = page.getByTestId('implementation-code')
		await expect(code)
			.toBeVisible()
		await expect(code)
			.toContainText('createWidgetPlugin')

		const tabSize = await code.locator('pre')
			.evaluate(element => getComputedStyle(element).tabSize)
		expect(tabSize)
			.toBe('4')
	})
})
