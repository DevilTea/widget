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

function parseCssColor(color: string): RgbaColor {
	const trimmed = color
		.trim()
		.toLowerCase()

	const rgbMatch = trimmed.match(/^rgba?\(\s*([0-9.]+%?)[,\s]+([0-9.]+%?)[,\s]+([0-9.]+%?)(?:[,\s/]+([0-9.]+%?))?\s*\)$/i)
	if (rgbMatch && rgbMatch[1] !== undefined && rgbMatch[2] !== undefined && rgbMatch[3] !== undefined) {
		const parseChannel = (val: string): number => (val.endsWith('%') ? (Number.parseFloat(val) / 100) * 255 : Number.parseFloat(val))
		const parseAlpha = (val?: string): number => {
			if (val === undefined)
				return 1
			return val.endsWith('%') ? Number.parseFloat(val) / 100 : Number.parseFloat(val)
		}
		return {
			r: parseChannel(rgbMatch[1]),
			g: parseChannel(rgbMatch[2]),
			b: parseChannel(rgbMatch[3]),
			a: parseAlpha(rgbMatch[4]),
		}
	}

	const srgbMatch = trimmed.match(/^color\(\s*srgb\s+([0-9.]+%?)\s+([0-9.]+%?)\s+([0-9.]+%?)(?:\s*\/\s*([0-9.]+%?))?\s*\)$/i)
	if (srgbMatch && srgbMatch[1] !== undefined && srgbMatch[2] !== undefined && srgbMatch[3] !== undefined) {
		const parseChannel = (val: string): number => (val.endsWith('%') ? (Number.parseFloat(val) / 100) * 255 : Number.parseFloat(val) * 255)
		const parseAlpha = (val?: string): number => {
			if (val === undefined)
				return 1
			return val.endsWith('%') ? Number.parseFloat(val) / 100 : Number.parseFloat(val)
		}
		return {
			r: parseChannel(srgbMatch[1]),
			g: parseChannel(srgbMatch[2]),
			b: parseChannel(srgbMatch[3]),
			a: parseAlpha(srgbMatch[4]),
		}
	}

	if (trimmed.startsWith('#')) {
		const hex = trimmed.slice(1)
		const h0 = hex[0]
		const h1 = hex[1]
		const h2 = hex[2]
		const h3 = hex[3]
		if ((hex.length === 3 || hex.length === 4) && h0 !== undefined && h1 !== undefined && h2 !== undefined) {
			const a = hex.length === 4 && h3 !== undefined ? Number.parseInt(h3 + h3, 16) / 255 : 1
			return {
				r: Number.parseInt(h0 + h0, 16),
				g: Number.parseInt(h1 + h1, 16),
				b: Number.parseInt(h2 + h2, 16),
				a,
			}
		}
		if (hex.length === 6 || hex.length === 8) {
			const r = Number.parseInt(hex.slice(0, 2), 16)
			const g = Number.parseInt(hex.slice(2, 4), 16)
			const b = Number.parseInt(hex.slice(4, 6), 16)
			const a = hex.length === 8 ? Number.parseInt(hex.slice(6, 8), 16) / 255 : 1
			return { r, g, b, a }
		}
	}

	const named: Record<string, RgbaColor> = {
		white: { r: 255, g: 255, b: 255, a: 1 },
		black: { r: 0, g: 0, b: 0, a: 1 },
		transparent: { r: 0, g: 0, b: 0, a: 0 },
	}
	const namedColor = named[trimmed]
	if (namedColor !== undefined)
		return namedColor

	throw new Error(`Unsupported CSS color format: ${color}`)
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
		test(`welcome dialog inherits readable foreground in ${selectedTheme} theme`, async ({ context, page }) => {
			await seedTheme(context, selectedTheme)
			await page.goto('/')

			const dialog = page.getByRole('dialog')
			await expect(dialog)
				.toBeVisible()
			const heading = dialog.getByRole('heading')
			await expect(heading)
				.toBeVisible()
			const colors = await heading.evaluate((element) => {
				let surface: HTMLElement | null = element.parentElement
				let surfaceColor = ''
				while (surface) {
					const bg = getComputedStyle(surface).backgroundColor
					if (bg && bg !== 'transparent' && bg !== 'rgba(0, 0, 0, 0)') {
						surfaceColor = bg
						break
					}
					surface = surface.parentElement
				}
				if (!surfaceColor)
					surfaceColor = getComputedStyle(document.body).backgroundColor

				return {
					heading: getComputedStyle(element).color,
					body: getComputedStyle(document.body).color,
					surface: surfaceColor,
				}
			})
			expect(colors.heading)
				.toBe(colors.body)

			const headingColor = parseCssColor(colors.heading)
			const surfaceColor = parseCssColor(colors.surface)
			expect(surfaceColor.a)
				.toBe(1)
			const contrast = contrastRatio(headingColor, surfaceColor)
			expect(contrast)
				.toBeGreaterThanOrEqual(4.5)
		})
	}
})
