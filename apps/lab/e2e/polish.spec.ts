import type { Page } from '@playwright/test'
import { expect, loadPreset, openDependenciesGraph, previewFrame, setLocale, test } from './fixtures'

/**
 * Issue #230 PR 3c: Graph readability (U11), grouped cycle problems (U16), target size and text size (U19), visible
 * keyboard focus (U20), the Lab language in the chrome (U21), the Preview failure state (U22) and the first paint (U23).
 * Geometry and styles are read from the real DOM; nothing here retries an action until it passes.
 */

const THEME_STORAGE_KEY = 'widget-lab:theme'

async function openLab(page: Page, query = 'showcase=survey'): Promise<void> {
	await page.goto(`/?${query}`)
	await expect(page.getByRole('tab', { name: /^(Author|編寫)$/ }))
		.toBeVisible()
	await expect(previewFrame(page)
		.getByRole('heading', { name: 'Maker Space open day: sign-up' }))
		.toBeVisible()
}

test.describe('Graph readability (U11)', () => {
	test('explains W, E and the line styles in a key that is always visible, without the Legend', async ({ page }) => {
		await page.goto('/')
		await openDependenciesGraph(page)
		const key = page.getByTestId('graph-key')
		await expect(key)
			.toBeVisible()
		await expect(key)
			.toContainText('Wwrites State')
		await expect(key)
			.toContainText('Eemits an Event')
		await expect(key)
			.toContainText('in an invalid cycle')
		await expect(key)
			.toContainText('invokes')
		await expect(page.getByRole('group', { name: 'Graph legend' }))
			.toHaveCount(0)
	})

	test('no text of the Graph is under 11px, even expanded, and its controls are 24px targets', async ({ page }) => {
		await page.goto('/')
		await openDependenciesGraph(page)
		await expect(page.locator('.vue-flow__node')
			.first())
			.toBeVisible({ timeout: 15_000 })
		await page.getByRole('button', { name: 'Expand all' })
			.click()
		await expect(page.locator('.graph-member-card')
			.first())
			.toBeVisible({ timeout: 15_000 })

		const measured = await page.locator('.dependencies-graph-view')
			.evaluate((view) => {
				const tiny: string[] = []
				for (const element of view.querySelectorAll('*')) {
					const own = [...element.childNodes].some(node => node.nodeType === 3 && (node.textContent ?? '').trim() !== '')
					if (own && Number.parseFloat(getComputedStyle(element).fontSize) < 11) {
						tiny.push(`${element.tagName} ${getComputedStyle(element).fontSize} ${(element.textContent ?? '').trim()
							.slice(0, 20)}`)
					}
				}
				// Layout size (offsetWidth/offsetHeight), not the rendered rect: the canvas scales its nodes by the zoom.
				const small = [...view.querySelectorAll('button')]
					.filter(element => element.offsetWidth > 0)
					.filter(element => element.offsetWidth < 24 || element.offsetHeight < 24)
					.map(element => element.getAttribute('aria-label') ?? element.textContent ?? '')
				return { tiny, small }
			})
		expect(measured.tiny)
			.toEqual([])
		expect(measured.small)
			.toEqual([])
		// The toolbar above it as well.
		for (const name of ['Fit graph', 'Zoom in', 'Zoom out', 'Expand all', 'Collapse all', 'Legend']) {
			const box = (await page.getByRole('button', { name, exact: true })
				.boundingBox())!
			expect(box.height, `${name} is at least 24px high`)
				.toBeGreaterThanOrEqual(24)
		}
	})

	test('edge labels are not printed over each other: they show for the hovered edge only', async ({ page }) => {
		await page.goto('/')
		await openDependenciesGraph(page)
		await expect(page.locator('.vue-flow__node')
			.first())
			.toBeVisible({ timeout: 15_000 })
		const labels = page.locator('.graph-edge .vue-flow__edge-text')
		await expect(labels.first())
			.toBeAttached()
		const opacities = await labels.evaluateAll(elements => elements.map(element => getComputedStyle(element).opacity))
		expect(opacities.length)
			.toBeGreaterThan(0)
		expect(new Set(opacities))
			.toEqual(new Set(['0']))

		// Hovering a point of an edge's line that the pointer really meets (edges overlap, and parts run behind nodes)
		// shows that edge's label, and only that one.
		const target = await page.locator('.graph-edge')
			.evaluateAll((groups) => {
				for (const [index, group] of groups.entries()) {
					const path = group.querySelector('.vue-flow__edge-path') as SVGPathElement
					const matrix = path.getScreenCTM()!
					const length = path.getTotalLength()
					for (let step = 1; step < 40; step++) {
						const at = path.getPointAtLength(length * step / 40)
						const x = matrix.a * at.x + matrix.c * at.y + matrix.e
						const y = matrix.b * at.x + matrix.d * at.y + matrix.f
						if (document.elementFromPoint(x, y)
							?.closest('.vue-flow__edge') === group) {
							return { index, x, y }
						}
					}
				}
				return null
			})
		expect(target, 'an edge with a point the pointer can reach')
			.not
			.toBeNull()
		await page.mouse.move(target!.x, target!.y)
		const hovered = page.locator('.graph-edge')
			.nth(target!.index)
			.locator('.vue-flow__edge-text')
		await expect(hovered)
			.toHaveCSS('opacity', '1')
		expect(await labels.evaluateAll(elements => elements.filter(element => getComputedStyle(element).opacity === '1').length), 'only the hovered edge shows its label')
			.toBe(1)

		// Moving away hides it again.
		await page.mouse.move(0, 0)
		await expect(hovered)
			.toHaveCSS('opacity', '0')
	})

	test('the zoom buttons zoom the canvas, so a fitted large graph can be read from the keyboard', async ({ page }) => {
		await page.goto('/')
		await openDependenciesGraph(page)
		await expect(page.locator('.vue-flow__node')
			.first())
			.toBeVisible({ timeout: 15_000 })
		const scale = () => page.locator('.vue-flow__transformationpane')
			.evaluate(element => new DOMMatrix(getComputedStyle(element).transform).a)
		const before = await scale()
		await page.getByTestId('graph-zoom-in')
			.click()
		await expect.poll(scale)
			.toBeGreaterThan(before)
		const zoomedIn = await scale()
		await page.getByTestId('graph-zoom-out')
			.click()
		await expect.poll(scale)
			.toBeLessThan(zoomedIn)
	})

	test('Fit uses the canvas: after Expand all and Fit the graph fills most of it, not 40%', async ({ page }) => {
		await page.goto('/')
		await openDependenciesGraph(page)
		await expect(page.locator('.vue-flow__node')
			.first())
			.toBeVisible({ timeout: 15_000 })
		await page.getByRole('button', { name: 'Expand all' })
			.click()
		await expect(page.locator('.graph-member-card')
			.first())
			.toBeVisible({ timeout: 15_000 })
		await page.getByRole('button', { name: 'Fit graph' })
			.click()
		const canvas = (await page.locator('.vue-flow')
			.boundingBox())!
		await expect.poll(async () => {
			const boxes = await page.locator('.vue-flow__node')
				.evaluateAll(nodes => nodes.map((node) => {
					const box = node.getBoundingClientRect()
					return { left: box.left, top: box.top, right: box.right, bottom: box.bottom }
				}))
			const width = Math.max(...boxes.map(box => box.right)) - Math.min(...boxes.map(box => box.left))
			const height = Math.max(...boxes.map(box => box.bottom)) - Math.min(...boxes.map(box => box.top))
			return Math.max(width / canvas.width, height / canvas.height)
		})
			.toBeGreaterThan(0.75)
	})
})

test.describe('grouped cycle problems (U16)', () => {
	test('four diagnostics of one cycle are one collapsed entry; opening it lists Core\'s four, verbatim', async ({ page }) => {
		await openLab(page)
		await loadPreset(page, 'survey-cycle')
		const problems = page.getByTestId('author-problems')
		await expect(problems)
			.toBeVisible()
		// The count is Core's, in every place that shows a count.
		await expect(problems)
			.toHaveAttribute('data-problem-count', '4')
		await expect(problems.getByTestId('author-problems-summary'))
			.toHaveText('4 problems')
		await expect(page.getByTestId('document-status'))
			.toHaveAttribute('data-problem-count', '4')

		const group = problems.getByTestId('problem-group')
		await expect(group)
			.toHaveCount(1)
		await expect(group)
			.toHaveAttribute('aria-expanded', 'false')
		await expect(group)
			.toContainText('property-evaluation-cycle')
		await expect(problems.getByTestId('problem-cycle-members'))
			.toContainText('guests.visible')
		await expect(problems.getByTestId('problem-cycle-members'))
			.toContainText('sessions.options')
		// Collapsed: the member rows exist but are not shown.
		for (const row of await problems.getByTestId('problem-row')
			.all()) {
			await expect(row)
				.toBeHidden()
		}

		await group.click()
		await expect(group)
			.toHaveAttribute('aria-expanded', 'true')
		const rows = problems.getByTestId('problem-row')
		await expect(rows)
			.toHaveCount(4)
		await expect(rows.first())
			.toContainText('Property "visible" participates in an evaluation cycle.')
		for (const code of await rows.evaluateAll(elements => elements.map(element => element.getAttribute('data-problem-code')))) {
			expect(code)
				.toBe('property-evaluation-cycle')
		}

		// A member still jumps to its place in the source.
		await rows.first()
			.click()
		await expect(page.getByTestId('json-editor')
			.locator('.monaco-editor'))
			.toHaveClass(/focused/)
	})

	test('the Blueprint panel\'s "All diagnostics" view still lists every diagnostic as Core reports them', async ({ page }) => {
		await openLab(page)
		await loadPreset(page, 'survey-cycle')
		await page.getByRole('tab', { name: 'Blueprint', exact: true })
			.click()
		await page.getByRole('button', { name: /All diagnostics/ })
			.click()
		await expect(page.locator('[data-testid^="blueprint-diagnostic-"]:not([data-testid*="navigate"]):not([data-testid*="location"])'))
			.toHaveCount(4)
	})

	test('other diagnostics are never grouped', async ({ page }) => {
		await openLab(page)
		await loadPreset(page, 'survey-ai-draft')
		const problems = page.getByTestId('author-problems')
		await expect(problems.getByTestId('problem-row'))
			.toHaveCount(5)
		await expect(problems.getByTestId('problem-group'))
			.toHaveCount(0)
	})
})

test.describe('visible keyboard focus (U20)', () => {
	test('a Dockview tab reached with the keyboard gets a 2px accent ring', async ({ page }) => {
		await openLab(page)
		const tab = page.getByRole('tab', { name: 'Blueprint', exact: true })
		// A key press first makes the next focus a keyboard focus (`:focus-visible`), as Tab would.
		await page.keyboard.press('Shift')
		await tab.focus()
		const ring = await tab.evaluate((element) => {
			const style = getComputedStyle(element, '::after')
			return { width: style.outlineWidth, style: style.outlineStyle, color: style.outlineColor }
		})
		const accent = await page.evaluate(() => {
			const probe = document.createElement('i')
			probe.style.color = 'var(--lab-color-accent)'
			document.body.append(probe)
			const color = getComputedStyle(probe).color
			probe.remove()
			return color
		})
		expect(ring)
			.toEqual({ width: '2px', style: 'solid', color: accent })
	})

	test('the Graph\'s expand buttons and the view switch show a focus ring', async ({ page }) => {
		await page.goto('/')
		await openDependenciesGraph(page)
		const toggle = page.locator('.graph-cluster-toggle')
			.first()
		await expect(toggle)
			.toBeVisible({ timeout: 15_000 })
		await page.keyboard.press('Shift')
		await toggle.focus()
		await expect(toggle)
			.toHaveCSS('outline-style', 'solid')
		await expect(toggle)
			.toHaveCSS('outline-width', '2px')
	})
})

test.describe('the Lab language in the chrome (U21)', () => {
	test('panel, view and Graph names are Taiwan Chinese in zh-TW, and Widget vocabulary stays English', async ({ page }) => {
		await openLab(page, 'showcase=survey&lang=zh-TW')
		for (const name of ['編寫', '選取的 widget', '相依性', 'Blueprint', 'Runtime', 'Preview']) {
			await expect(page.getByRole('tab', { name, exact: true }))
				.toBeVisible()
		}
		for (const name of ['Author', 'Dependencies']) {
			await expect(page.getByRole('tab', { name, exact: true }))
				.toHaveCount(0)
		}

		await page.getByRole('tab', { name: '編寫', exact: true })
			.click()
		for (const name of ['目錄', '結構', 'JSON']) {
			await expect(page.getByRole('tab', { name, exact: true }))
				.toBeVisible()
		}

		await page.getByRole('tab', { name: '相依性', exact: true })
			.click()
		const views = page.getByRole('tablist', { name: '相依性檢視' })
		await expect(views.getByRole('tab', { name: '關聯' }))
			.toBeVisible()
		await views.getByRole('tab', { name: '關係圖' })
			.click()
		await expect(page.getByTestId('graph-key'))
			.toContainText('寫入 State')
	})

	test('the tab titles follow a language switch', async ({ page }) => {
		await openLab(page)
		await setLocale(page, 'zh-TW')
		await expect(page.getByRole('tab', { name: '編寫', exact: true }))
			.toBeVisible()
		await setLocale(page, 'en')
		await expect(page.getByRole('tab', { name: 'Author', exact: true }))
			.toBeVisible()
	})
})

test.describe('a Preview that cannot load (U22)', () => {
	test('says so, with the cause and a retry that brings the Preview back', async ({ page }) => {
		let blocked = true
		await page.route('**/preview-frame.html**', async (route) => {
			if (blocked)
				await route.abort('blockedbyclient')
			else
				await route.continue()
		})
		await page.goto('/?lab-test&showcase=survey&preview-timeout-ms=1500')

		const error = page.getByTestId('preview-error')
		await expect(error)
			.toBeVisible()
		await expect(error)
			.toHaveAttribute('role', 'alert')
		await expect(error)
			.toContainText('The preview could not be loaded')
		await expect(page.getByTestId('preview-error-detail'))
			.toContainText('did not become ready within 1500 ms')
		await expect(page.getByTestId('preview-status'))
			.toHaveAttribute('data-state', 'failed')
		await expect(page.getByTestId('preview-status'))
			.toHaveText('Preview failed to load')
		// The dead frame is not left on screen.
		await expect(page.getByTestId('preview-frame'))
			.toBeHidden()

		blocked = false
		await page.getByTestId('preview-retry')
			.click()
		await expect(error)
			.toHaveCount(0)
		await expect(previewFrame(page)
			.getByRole('heading', { name: 'Maker Space open day: sign-up' }))
			.toBeVisible()
		await expect(page.getByTestId('preview-status'))
			.toHaveAttribute('data-state', 'current')
	})

	test('the failure state is announced in Taiwan Chinese too', async ({ page }) => {
		await page.route('**/preview-frame.html**', route => route.abort('blockedbyclient'))
		await page.goto('/?lab-test&showcase=survey&lang=zh-TW&preview-timeout-ms=1500')
		await expect(page.getByTestId('preview-error'))
			.toContainText('無法載入預覽')
		await expect(page.getByTestId('preview-retry'))
			.toHaveText('再試一次')
	})
})

test.describe('first paint (U23)', () => {
	for (const theme of ['light', 'dark'] as const) {
		test(`a ${theme} user never sees the other palette: the theme is on <html> before the app has loaded`, async ({ context, page }) => {
			await context.addInitScript(({ key, value }) => localStorage.setItem(key, value), { key: THEME_STORAGE_KEY, value: theme })
			// Hold the app's entry module: until it is released nothing of the app has run, only index.html.
			const held: (() => Promise<void>)[] = []
			await page.route('**/assets/lab-*.js', (route) => {
				held.push(() => route.continue())
			})
			// `commit`: the document's own load waits for the held module, so DOMContentLoaded would never come.
			await page.goto('/', { waitUntil: 'commit' })

			await expect(page.locator('html'))
				.toHaveAttribute('data-lab-theme', theme)
			await expect(page.locator('#app'))
				.toBeEmpty()
			const background = await page.evaluate(() => getComputedStyle(document.body).backgroundColor)
			expect(background)
				.toBe(theme === 'light'
					? 'rgb(246, 247, 249)'
					: await page.evaluate(() => {
							const probe = document.createElement('i')
							probe.style.color = 'var(--lab-color-bg)'
							document.body.append(probe)
							const color = getComputedStyle(probe).color
							probe.remove()
							return color
						}))
			expect(await page.evaluate(() => document.documentElement.style.colorScheme))
				.toBe(theme)

			for (const release of held)
				await release()
			await expect(page.getByRole('tab', { name: 'Author', exact: true }))
				.toBeVisible()
		})
	}
})
