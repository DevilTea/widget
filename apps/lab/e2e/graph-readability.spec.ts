import type { Page } from '@playwright/test'
import { expect, openDependenciesGraph, test } from './fixtures'

/**
 * Issue #230, "the Graph is hard to read": what a person sees in the real browser. The cards are spread out, every dependency
 * is a Bezier curve (not an orthogonal route with rounded corners) that ends in an arrowhead on the member it depends on,
 * and no curve disappears behind a card. The same properties are measured on the layout alone in
 * `src/graph/graph-readability.unit.test.ts`; here they are read from the rendered SVG, in screen coordinates.
 */

interface Rect { x: number, y: number, width: number, height: number }
interface Point { x: number, y: number }

interface RenderedGraph {
	/** Screen pixels per flow unit. */
	zoom: number
	cards: { id: string, rect: Rect }[]
	edges: {
		id: string
		d: string
		classes: string
		marker: { id: string, fill: string } | null
		points: Point[]
		relationTag: string | null
	}[]
}

async function openGraph(page: Page, showcase: 'survey' | 'trip-budget', options: { expanded?: boolean } = {}): Promise<void> {
	await page.goto(`/?showcase=${showcase}`)
	await openDependenciesGraph(page)
	await expect(page.locator('.graph-node--cluster')
		.first())
		.toBeVisible({ timeout: 15_000 })
	if (options.expanded === true) {
		await page.getByRole('button', { name: 'Expand all' })
			.click()
		await expect(page.locator('.graph-node--member')
			.first())
			.toBeVisible({ timeout: 15_000 })
	}
	// The automatic fit has settled once the viewport stops changing between two frames.
	await expect(async () => {
		const first = await page.locator('.vue-flow__transformationpane')
			.getAttribute('style')
		await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))))
		expect(await page.locator('.vue-flow__transformationpane')
			.getAttribute('style'))
			.toBe(first)
	})
		.toPass()
}

/** Reads the cards and every edge's curve (as screen points along the path) out of the rendered Graph. */
async function readGraph(page: Page): Promise<RenderedGraph> {
	return page.evaluate(() => {
		const pane = document.querySelector<HTMLElement>('.vue-flow__transformationpane')!
		const scale = /scale\(([-\d.]+)\)/.exec(pane.style.transform)
		const cards = [...document.querySelectorAll<HTMLElement>('.vue-flow__node')]
			// An expanded widget is only the shell around its member cards.
			.filter(node => node.querySelector('.graph-cluster-card--expanded') === null)
			.map((node) => {
				const rect = node.getBoundingClientRect()
				return { id: node.dataset.id!, rect: { x: rect.x, y: rect.y, width: rect.width, height: rect.height } }
			})
		const edges = [...document.querySelectorAll<SVGGElement>('.vue-flow__edge')].map((edge) => {
			const path = edge.querySelector<SVGPathElement>('.vue-flow__edge-path')!
			const matrix = path.getScreenCTM()!
			const length = path.getTotalLength()
			const points: { x: number, y: number }[] = []
			for (let step = 0; step <= 60; step++) {
				const point = path.getPointAtLength(length * step / 60)
				const mapped = new DOMPoint(point.x, point.y)
					.matrixTransform(matrix)
				points.push({ x: mapped.x, y: mapped.y })
			}
			const markerUrl = /^url\(["']?#(.*?)["']?\)$/.exec(path.getAttribute('marker-end') ?? '')
			const marker = markerUrl === null ? null : document.getElementById(markerUrl[1]!)
			const markerShape = marker?.querySelector('polyline, path')
			return {
				id: edge.dataset.id!,
				d: path.getAttribute('d') ?? '',
				classes: edge.getAttribute('class') ?? '',
				marker: markerUrl === null || markerShape === null || markerShape === undefined ? null : { id: markerUrl[1]!, fill: getComputedStyle(markerShape).fill },
				points,
				relationTag: edge.querySelector('.graph-edge-relation')?.textContent?.trim() ?? null,
			}
		})
		return { zoom: scale === null ? 1 : Number(scale[1]), cards, edges }
	})
}

function contains(rect: Rect, point: Point, margin: number): boolean {
	return point.x > rect.x + margin && point.x < rect.x + rect.width - margin && point.y > rect.y + margin && point.y < rect.y + rect.height - margin
}

function onBorder(rect: Rect, point: Point, tolerance: number): boolean {
	const withinX = point.x >= rect.x - tolerance && point.x <= rect.x + rect.width + tolerance
	const withinY = point.y >= rect.y - tolerance && point.y <= rect.y + rect.height + tolerance
	const onVertical = Math.abs(point.x - rect.x) <= tolerance || Math.abs(point.x - (rect.x + rect.width)) <= tolerance
	const onHorizontal = Math.abs(point.y - rect.y) <= tolerance || Math.abs(point.y - (rect.y + rect.height)) <= tolerance
	return withinX && withinY && (onVertical || onHorizontal)
}

function smallestGap(cards: RenderedGraph['cards']): number {
	let smallest = Number.POSITIVE_INFINITY
	for (let first = 0; first < cards.length; first++) {
		for (let second = first + 1; second < cards.length; second++) {
			const a = cards[first]!.rect
			const b = cards[second]!.rect
			smallest = Math.min(smallest, Math.max(b.x - (a.x + a.width), a.x - (b.x + b.width), b.y - (a.y + a.height), a.y - (b.y + b.height)))
		}
	}
	return smallest
}

/** Only `M` and cubic `C` commands: never a line, a rounded corner (`Q`/`A`) or a horizontal/vertical run (`H`/`V`). */
const BEZIER_PATH = /^M [-\d. ]+( C [-\d. ]+)+$/

for (const showcase of ['survey', 'trip-budget'] as const) {
	test(`${showcase} collapsed Graph: spread-out cards, Bezier edges with arrowheads, nothing behind a card`, async ({ page }) => {
		await openGraph(page, showcase)
		const { zoom, cards, edges } = await readGraph(page)

		// Spread out: at least the configured 72 flow units between two cards (2px of rounding in the screen measurement).
		expect(cards.length)
			.toBeGreaterThanOrEqual(5)
		expect(smallestGap(cards) / zoom)
			.toBeGreaterThanOrEqual(70)

		expect(edges.length)
			.toBeGreaterThanOrEqual(10)
		const cardById = new Map(cards.map(card => [card.id, card.rect]))
		for (const edge of edges) {
			// Curves, not orthogonal segments with rounded corners.
			expect(edge.d, edge.id)
				.toMatch(BEZIER_PATH)

			// Direction: the curve starts on the card that declares the dependency and its arrowhead is on the target.
			const [source, target] = JSON.parse(edge.id.slice('edge:'.length)) as [string, string]
			expect(onBorder(cardById.get(source)!, edge.points[0]!, 3), `${edge.id} starts on ${source}`)
				.toBe(true)
			expect(onBorder(cardById.get(target)!, edge.points.at(-1)!, 3), `${edge.id} ends on ${target}`)
				.toBe(true)
			expect(edge.marker, `${edge.id} has an arrowhead`)
				.not
				.toBeNull()

			// Never hidden behind a card that is not one of its two ends.
			for (const card of cards) {
				if (card.id === source || card.id === target)
					continue
				expect(edge.points.some(point => contains(card.rect, point, 2)), `${edge.id} passes through ${card.id}`)
					.toBe(false)
			}
		}
	})
}

test('survey expanded Graph: Bezier edges, each with an arrowhead', async ({ page }) => {
	await openGraph(page, 'survey', { expanded: true })
	const { edges } = await readGraph(page)
	expect(edges.length)
		.toBeGreaterThan(50)
	for (const edge of edges) {
		expect(edge.d, edge.id)
			.toMatch(BEZIER_PATH)
		expect(edge.marker, edge.id)
			.not
			.toBeNull()
	}
})

test('focusing a widget tags the edges that leave it "Depends on" and the edges that arrive at it "Used by"', async ({ page }) => {
	await openGraph(page, 'survey')
	await page.locator('.graph-cluster-identity--collapsed')
		.filter({ hasText: '#mode' })
		.click()
	await expect(page.locator('.graph-node--focused'))
		.toContainText('#mode')

	const { cards, edges } = await readGraph(page)
	const focused = cards.find(card => card.id === 'cluster:1')!.rect
	const leaving = edges.filter(edge => edge.classes.includes('graph-edge--depends-on'))
	const arriving = edges.filter(edge => edge.classes.includes('graph-edge--used-by'))
	expect(leaving.length)
		.toBeGreaterThan(0)
	expect(arriving.length)
		.toBeGreaterThan(0)

	// The tag says which, in the words of the Relations view, and agrees with where the arrowhead is.
	for (const edge of leaving) {
		expect(edge.relationTag)
			.toBe('Depends on')
		expect(onBorder(focused, edge.points[0]!, 3), `${edge.id} leaves the focused widget`)
			.toBe(true)
	}
	for (const edge of arriving) {
		expect(edge.relationTag)
			.toBe('Used by')
		expect(onBorder(focused, edge.points.at(-1)!, 3), `${edge.id} arrives at the focused widget`)
			.toBe(true)
	}
})

test('the key and the Legend state the direction convention', async ({ page }) => {
	await openGraph(page, 'survey')
	await expect(page.getByTestId('graph-key-direction'))
		.toHaveText('A → B: A depends on B')

	await page.getByRole('button', { name: 'Legend' })
		.click()
	const direction = page.getByTestId('graph-legend-direction')
	await expect(direction)
		.toContainText('The arrowhead is on the target: A → B means A depends on B')
	await expect(direction)
		.toContainText('"Depends on"')
	await expect(direction)
		.toContainText('"Used by"')
})

for (const theme of ['light', 'dark'] as const) {
	test(`the arrowheads take the ${theme} theme's colours`, async ({ context, page }) => {
		await context.addInitScript((value) => {
			localStorage.setItem('widget-lab:theme', value)
		}, theme)
		await openGraph(page, 'survey')
		await expect(page.locator('html'))
			.toHaveAttribute('data-lab-theme', theme)

		const { edges } = await readGraph(page)
		const reads = edges.find(edge => edge.classes.includes('graph-edge--reads'))!
		const tokenColour = await page.evaluate(() => {
			const probe = document.createElement('span')
			probe.style.color = 'var(--lab-color-text-muted)'
			document.body.append(probe)
			const colour = getComputedStyle(probe).color
			probe.remove()
			return colour
		})
		// The marker's fill is the Lab's muted text token as the current theme defines it.
		expect(reads.marker?.fill)
			.toBe(tokenColour)
	})
}
