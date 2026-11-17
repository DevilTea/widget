import type { BrowserContext } from '@playwright/test'
import { expect, previewFrame, test } from './fixtures'

/**
 * Nuxt UI + Tailwind v4 foundation contract (issue #230 PR 2): the Lab shell uses them, the Preview frame
 * never does, the theme bridge keeps one source of truth, and nothing is fetched from off-origin.
 */

const THEME_STORAGE_KEY = 'widget-lab:theme'

async function seedTheme(context: BrowserContext, theme: 'light' | 'dark'): Promise<void> {
	await context.addInitScript(({ key, value }) => {
		if (localStorage.getItem(key) === null)
			localStorage.setItem(key, value)
	}, { key: THEME_STORAGE_KEY, value: theme })
}

test.describe('theme bridge (Lab theme store -> Nuxt UI .dark class)', () => {
	for (const initial of ['light', 'dark'] as const) {
		test(`starts from the stored ${initial} theme and follows the Theme control both ways`, async ({ context, page }) => {
			await seedTheme(context, initial)
			await page.goto('/?showcase=sandbox')
			const html = page.locator('html')
			const other = initial === 'light' ? 'dark' : 'light'

			await expect(html)
				.toHaveAttribute('data-lab-theme', initial)
			expect(await html.evaluate(element => element.classList.contains('dark')))
				.toBe(initial === 'dark')

			await page.getByLabel('Theme')
				.selectOption(other)
			await expect(html)
				.toHaveAttribute('data-lab-theme', other)
			expect(await html.evaluate(element => element.classList.contains('dark')))
				.toBe(other === 'dark')

			await page.getByLabel('Theme')
				.selectOption(initial)
			expect(await html.evaluate(element => element.classList.contains('dark')))
				.toBe(initial === 'dark')

			// Nuxt UI's own colour-mode persistence is not installed: only the Lab store writes a preference.
			expect(await page.evaluate(() => Object.keys(localStorage)
				.filter(key => key.includes('color-scheme') || key.includes('color-mode'))))
				.toEqual([])
		})
	}

	test('Nuxt UI semantic tokens resolve to the Lab palette in both themes', async ({ context, page }) => {
		await seedTheme(context, 'light')
		await page.goto('/?showcase=sandbox')
		const read = async (name: string) => page.locator('html')
			.evaluate((element, property) => getComputedStyle(element)
				.getPropertyValue(property)
				.trim(), name)

		await expect(page.locator('html'))
			.toHaveAttribute('data-lab-theme', 'light')
		const lightBg = await read('--ui-bg')
		const lightOk = await read('--lab-color-ok')
		expect(lightBg)
			.toBe(await read('--lab-color-bg'))
		expect(await read('--ui-primary'))
			.toBe(await read('--lab-color-accent'))

		await page.getByLabel('Theme')
			.selectOption('dark')
		await expect(page.locator('html'))
			.toHaveAttribute('data-lab-theme', 'dark')
		expect(await read('--ui-bg'))
			.toBe(await read('--lab-color-bg'))
		expect(await read('--ui-bg'))
			.not.toBe(lightBg)
		expect(await read('--ui-success'))
			.toBe(await read('--lab-color-ok'))

		// Audit U17: one success token name, defined in both themes (it used to exist only in light).
		const darkOk = await read('--lab-color-ok')
		expect(darkOk)
			.not.toBe('')
		expect(darkOk)
			.not.toBe(lightOk)
		expect(await read('--lab-color-success'))
			.toBe('')
	})
})

test.describe('cascade layers', () => {
	test('Tailwind layers sit below the PikaCSS layers, which sit below utilities, and unlayered CSS beats all', async ({ page }) => {
		await page.goto('/?showcase=sandbox')
		// Probe the real layer order the browser resolved: each pair declares `color` on the same element in
		// two layers (red in the lower, blue in the higher), so the winner shows which layer ranks higher.
		const winners = await page.evaluate(() => {
			const probe = document.createElement('div')
			probe.className = 'layer-probe'
			document.body.append(probe)
			const style = document.createElement('style')
			const pairs: Array<[string, string]> = [
				['theme', 'base'],
				['base', 'preflights'],
				['preflights', 'components'],
				['components', 'utilities'],
			]
			document.head.append(style)
			const result: Record<string, string> = {}
			for (const [low, high] of pairs) {
				style.textContent = `@layer ${low} { .layer-probe { color: red } } @layer ${high} { .layer-probe { color: blue } }`
				result[`${low}<${high}`] = getComputedStyle(probe).color === 'rgb(0, 0, 255)' ? 'higher wins' : 'lower wins'
			}
			style.textContent = '@layer utilities { .layer-probe { color: red } } .layer-probe { color: blue }'
			result.unlayered = getComputedStyle(probe).color === 'rgb(0, 0, 255)' ? 'unlayered wins' : 'layer wins'
			style.remove()
			probe.remove()
			return result
		})
		expect(winners)
			.toEqual({
				'theme<base': 'higher wins',
				'base<preflights': 'higher wins',
				'preflights<components': 'higher wins',
				'components<utilities': 'higher wins',
				'unlayered': 'unlayered wins',
			})
	})

	test('the chrome keeps UA text metrics: no Tailwind preflight reached it', async ({ page }) => {
		await page.goto('/?showcase=sandbox')
		const metrics = await page.locator('html')
			.evaluate(element => ({
				lineHeight: getComputedStyle(element).lineHeight,
				tabSize: getComputedStyle(element).tabSize,
			}))
		expect(metrics)
			.toEqual({ lineHeight: 'normal', tabSize: '8' })
	})
})

test.describe('Preview frame isolation', () => {
	test('the frame document loads no Tailwind or Nuxt UI CSS and receives no dark class', async ({ context, page }) => {
		await seedTheme(context, 'dark')
		await page.goto('/?showcase=sandbox')
		await expect(previewFrame(page)
			.getByRole('button', { name: '+1', exact: true }))
			.toBeVisible()
		const frameHandle = await page.locator('[data-testid="preview-frame"]')
			.elementHandle()
		const frame = await frameHandle!.contentFrame()
		const report = await frame!.evaluate(() => {
			const root = document.documentElement
			const style = getComputedStyle(root)
			const cssText = [...document.styleSheets]
				.flatMap(sheet => [...sheet.cssRules].map(rule => rule.cssText.slice(0, 200)))
				.join('\n')
			return {
				htmlClass: root.className,
				labTheme: root.dataset.labTheme,
				uiToken: style.getPropertyValue('--ui-bg'),
				twToken: style.getPropertyValue('--color-red-500'),
				hasTailwindCss: /--tw-|@layer (?:theme|properties)|--ui-/.test(cssText),
				lineHeight: style.lineHeight,
			}
		})
		expect(report)
			.toEqual({
				htmlClass: '',
				labTheme: 'dark',
				uiToken: '',
				twToken: '',
				hasTailwindCss: false,
				// `styles/preview-frame.css` owns the frame's own base rules.
				lineHeight: '24px',
			})
	})
})

test.describe('migrated surface: panel description bar dismiss button', () => {
	test('is a Nuxt UI button with a locally bundled icon, a >=24px target and a focus indicator, and works offline', async ({ page, offOriginRequestUrls }) => {
		await page.goto('/?showcase=sandbox')
		const dismiss = page.getByRole('button', { name: 'Dismiss' })
			.first()
		await expect(dismiss)
			.toBeVisible()
		// Nuxt UI renders `data-slot`, and the iconify icon is an inline svg with real path data (bundled at build
		// time), not an empty placeholder waiting for a remote API.
		await expect(dismiss)
			.toHaveAttribute('data-slot', 'base')
		const iconPath = dismiss.locator('svg path')
		await expect(iconPath)
			.toHaveAttribute('d', /.+/)
		const box = await dismiss.boundingBox()
		expect(box!.width)
			.toBeGreaterThanOrEqual(24)
		expect(box!.height)
			.toBeGreaterThanOrEqual(24)

		// Keyboard focus shows an outline (focus-visible), not only a colour change.
		await dismiss.focus()
		await page.keyboard.press('Shift+Tab')
		await page.keyboard.press('Tab')
		await expect(dismiss)
			.toBeFocused()
		expect(await dismiss.evaluate(element => getComputedStyle(element).outlineStyle))
			.not.toBe('none')

		const barsBefore = await page.getByRole('button', { name: 'Dismiss' })
			.count()
		await dismiss.click()
		await expect(page.getByRole('button', { name: 'Dismiss' }))
			.toHaveCount(barsBefore - 1)

		expect(offOriginRequestUrls)
			.toEqual([])
	})
})
