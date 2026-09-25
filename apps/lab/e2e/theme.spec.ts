import { expect, previewFrame, test } from './fixtures'

const THEME_STORAGE_KEY = 'widget-lab:theme'

async function seedTheme(context: import('@playwright/test').BrowserContext, theme: 'light' | 'dark'): Promise<void> {
	await context.addInitScript(({ key, value }) => {
		if (localStorage.getItem(key) === null)
			localStorage.setItem(key, value)
	}, { key: THEME_STORAGE_KEY, value: theme })
}

test.describe('lab theme (issue #44)', () => {
	test('switches document, Monaco, and Dockview presentation without resetting Runtime state', async ({ context, page }) => {
		await seedTheme(context, 'light')
		await page.goto('/')

		const themeSelect = page.getByLabel('Theme')
		await expect(themeSelect)
			.toHaveValue('light')
		await expect(page.locator('html'))
			.toHaveAttribute('data-lab-theme', 'light')
		await expect(page.locator('.monaco-editor'))
			.toBeVisible()

		const monacoLight = await page.locator('.monaco-editor')
			.evaluate(element => getComputedStyle(element).backgroundColor)
		const dockviewBackgroundLight = await page.locator('.dockview-theme-lab')
			.evaluate(element => getComputedStyle(element)
				.getPropertyValue('--dv-group-view-background-color')
				.trim())
		const labBackgroundLight = await page.locator('html')
			.evaluate(element => getComputedStyle(element)
				.getPropertyValue('--lab-color-bg')
				.trim())
		expect(dockviewBackgroundLight)
			.toBe(labBackgroundLight)

		await previewFrame(page)
			.getByRole('button', { name: '+1', exact: true })
			.click()
		await expect(previewFrame(page)
			.getByText('count: 1 · doubled: 2', { exact: true }))
			.toBeVisible()

		await themeSelect.selectOption('dark')
		await expect(page.locator('html'))
			.toHaveAttribute('data-lab-theme', 'dark')
		await expect(previewFrame(page)
			.getByText('count: 1 · doubled: 2', { exact: true }))
			.toBeVisible()
		expect(await page.evaluate(key => localStorage.getItem(key), THEME_STORAGE_KEY))
			.toBe('dark')

		await expect.poll(async () => page.locator('.monaco-editor')
			.evaluate(element => getComputedStyle(element).backgroundColor))
			.not.toBe(monacoLight)
		const labBackgroundDark = await page.locator('html')
			.evaluate(element => getComputedStyle(element)
				.getPropertyValue('--lab-color-bg')
				.trim())
		expect(labBackgroundDark)
			.not.toBe(labBackgroundLight)
		const dockviewBackgroundDark = await page.locator('.dockview-theme-lab')
			.evaluate(element => getComputedStyle(element)
				.getPropertyValue('--dv-group-view-background-color')
				.trim())
		expect(dockviewBackgroundDark)
			.toBe(labBackgroundDark)

		await page.reload()
		await expect(themeSelect)
			.toHaveValue('dark')
	})

	test('rehighlights already-loaded Implementation source when theme changes without reloading source text', async ({ context, page, blockedRequestUrls }) => {
		await seedTheme(context, 'light')
		await page.goto('/')
		await page.getByRole('tab', { name: 'Blueprint' })
			.click()
		await page.getByRole('button', { name: 'title : Text' })
			.click()
		await page.getByTestId('blueprint-view-implementation')
			.click()

		const code = page.getByTestId('implementation-code')
		const pre = code.locator('pre')
		await expect(pre)
			.toBeVisible()
		await expect(code)
			.toContainText('createWidgetPlugin(\'Text\')')
		const textBefore = await code.textContent()
		const lightBackground = await pre.evaluate(element => getComputedStyle(element).backgroundColor)
		const importTokenColor = () => pre.evaluate((element) => {
			const token = Array.from(element.querySelectorAll<HTMLElement>('span'))
				.find(candidate => candidate.childElementCount === 0 && candidate.textContent === 'import')
			if (token === undefined)
				throw new Error('Could not find the exact Shiki import token')
			return getComputedStyle(token).color
		})
		const lightImportColor = await importTokenColor()

		await page.getByLabel('Theme')
			.selectOption('dark')
		await expect.poll(async () => pre.evaluate(element => getComputedStyle(element).backgroundColor))
			.not.toBe(lightBackground)
		// Shiki legitimately changes token segmentation between themes, so do not compare span counts.
		// Locate the same exact `import` token text and prove its computed foreground changed.
		await expect.poll(importTokenColor)
			.not.toBe(lightImportColor)
		expect(await code.textContent())
			.toBe(textBefore)
		expect(blockedRequestUrls)
			.toEqual([])
	})
})

interface RgbaColor {
	r: number
	g: number
	b: number
	a: number
}

// Chromium serializes the computed RGB values used here as rgb() or rgba().
function parseRgbColor(color: string): RgbaColor {
	const trimmed = color.trim()
	const match = /^rgba?\(\s*(\d+(?:\.\d+)?)\s*,\s*(\d+(?:\.\d+)?)\s*,\s*(\d+(?:\.\d+)?)(?:\s*,\s*(\d+(?:\.\d+)?))?\s*\)$/i.exec(trimmed)
	if (!match || match[1] === undefined || match[2] === undefined || match[3] === undefined)
		throw new Error(`Unsupported Chromium computed RGB color: ${color}`)

	return {
		r: Number(match[1]),
		g: Number(match[2]),
		b: Number(match[3]),
		a: match[4] === undefined ? 1 : Number(match[4]),
	}
}

function relativeLuminance(color: RgbaColor): number {
	const adjust = (channel: number): number => {
		const srgb = channel / 255
		return srgb <= 0.04045
			? srgb / 12.92
			: ((srgb + 0.055) / 1.055) ** 2.4
	}
	return (
		0.2126 * adjust(color.r)
		+ 0.7152 * adjust(color.g)
		+ 0.0722 * adjust(color.b)
	)
}

function contrastRatio(color1: RgbaColor, color2: RgbaColor): number {
	const l1 = relativeLuminance(color1)
	const l2 = relativeLuminance(color2)
	const lighter = Math.max(l1, l2)
	const darker = Math.min(l1, l2)
	return (lighter + 0.05) / (darker + 0.05)
}

test.describe('native dialog theme foreground (issue #44)', () => {
	test.use({ welcomeDismissed: false })

	for (const selectedTheme of ['light', 'dark'] as const) {
		test(`welcome dialog keeps an opaque heading over its solid card surface in ${selectedTheme} theme`, async ({ context, page }) => {
			await seedTheme(context, selectedTheme)
			await page.goto('/')

			const dialog = page.getByRole('dialog')
			await expect(dialog)
				.toBeVisible()
			const heading = dialog.getByRole('heading')
			await expect(heading)
				.toBeVisible()
			const colors = await heading.evaluate((element) => {
				const dialogElement = element.closest('dialog')
				const cardSurface = element.parentElement
				if (!dialogElement || !cardSurface || cardSurface.parentElement !== dialogElement || cardSurface.tagName !== 'DIV')
					throw new Error('Expected the WelcomeCard heading inside its direct child div card surface')

				const opacityViolations: string[] = []
				let ancestor: HTMLElement | null = element as HTMLElement
				while (ancestor) {
					const opacity = getComputedStyle(ancestor).opacity
					if (opacity !== '1')
						opacityViolations.push(`${ancestor.tagName.toLowerCase()} opacity=${opacity}`)
					ancestor = ancestor.parentElement
				}

				const surfaceStyle = getComputedStyle(cardSurface)
				return {
					heading: getComputedStyle(element).color,
					body: getComputedStyle(document.body).color,
					surface: surfaceStyle.backgroundColor,
					surfaceElement: cardSurface.tagName.toLowerCase(),
					surfaceImage: surfaceStyle.backgroundImage,
					opacityViolations,
				}
			})
			expect(colors.heading)
				.toBe(colors.body)

			// The supported WelcomeCard surface is a fully opaque solid color. Alpha, ancestor opacity,
			// or an image changes the rendered pixels, so reject those inputs instead of estimating them
			// or falling back to an unrelated ancestor such as body.
			expect(colors.surfaceElement)
				.toBe('div')
			expect(colors.surfaceImage)
				.toBe('none')
			expect(colors.opacityViolations)
				.toEqual([])

			const headingColor = parseRgbColor(colors.heading)
			const surfaceColor = parseRgbColor(colors.surface)
			expect(headingColor.a, `WelcomeCard heading foreground must be opaque; got ${colors.heading}`)
				.toBe(1)
			expect(surfaceColor.a, `WelcomeCard card surface must be opaque; got ${colors.surface}`)
				.toBe(1)
			const contrast = contrastRatio(headingColor, surfaceColor)
			expect(contrast)
				.toBeGreaterThanOrEqual(4.5)
		})
	}
})
