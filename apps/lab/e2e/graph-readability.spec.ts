import type { Page } from '@playwright/test'
import { expect, openDependenciesGraph, setLocale, test } from './fixtures'

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
	/** The font sizes of the widget type and of its id on a collapsed card, on screen. */
	cardTitlePx: number | null
	cardIdPx: number | null
	/** Whether the layer of the focus tags comes after (so is drawn above) every edge and card. */
	tagLayerAboveEdges: boolean
	cards: { id: string, rect: Rect }[]
	edges: {
		id: string
		d: string
		classes: string
		/** `markerLength` is the arrowhead's length in screen px as drawn at the current zoom. */
		marker: { id: string, fill: string, markerLength: number } | null
		points: Point[]
		opacity: number
		stroke: string
		/** The focus tag: its text, its box on screen, and its font size on screen. */
		/** `leader` is set for a tag beside its edge: where its leader line starts (on the edge) and ends (on the tag's box), on screen. */
		relationTag: { text: string, rect: Rect, fontPx: number, leader: { from: Point, to: Point } | null } | null
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
			const scaleNow = scale === null ? 1 : Number(scale[1])
			const tag = [...document.querySelectorAll<SVGGElement>('.graph-tag-layer .graph-tag')].find(candidate => candidate.dataset.edgeId === edge.dataset.id)
			const tagRect = tag?.querySelector('.graph-tag-bg')
				?.getBoundingClientRect()
			const tagText = tag?.querySelector('.graph-tag-text')
			const leaderLine = tag?.querySelector<SVGLineElement>('.graph-tag-leader') ?? null
			const leaderMatrix = leaderLine?.getScreenCTM() ?? null
			const leaderEnd = (x: string, y: string): { x: number, y: number } => {
				const point = new DOMPoint(Number(leaderLine!.getAttribute(x)), Number(leaderLine!.getAttribute(y)))
					.matrixTransform(leaderMatrix!)
				return { x: point.x, y: point.y }
			}
			return {
				id: edge.dataset.id!,
				d: path.getAttribute('d') ?? '',
				classes: edge.getAttribute('class') ?? '',
				marker: markerUrl === null || markerShape === null || markerShape === undefined
					? null
					: { id: markerUrl[1]!, fill: getComputedStyle(markerShape).fill, markerLength: Number(marker!.getAttribute('markerWidth')) * scaleNow },
				points,
				opacity: Number(getComputedStyle(edge).opacity),
				stroke: getComputedStyle(path).stroke,
				relationTag: tag === null || tagRect === undefined || tagText === null || tagText === undefined
					? null
					: { text: tagText.textContent?.trim() ?? '', rect: { x: tagRect.x, y: tagRect.y, width: tagRect.width, height: tagRect.height }, fontPx: Number.parseFloat(getComputedStyle(tagText).fontSize) * scaleNow, leader: leaderLine === null || leaderMatrix === null ? null : { from: leaderEnd('x1', 'y1'), to: leaderEnd('x2', 'y2') } },
			}
		})
		const title = document.querySelector('.graph-cluster-type')
		const idLabel = document.querySelector('.graph-cluster-id')
		const zoom = scale === null ? 1 : Number(scale[1])
		const layer = document.querySelector('.graph-tag-layer')
		// The layer follows (is drawn after, so above) a container when that container precedes it in the document.
		const precedes = (selector: string): boolean => layer !== null && (layer.compareDocumentPosition(document.querySelector(selector)!) & Node.DOCUMENT_POSITION_PRECEDING) !== 0
		return {
			zoom,
			cardTitlePx: title === null ? null : Number.parseFloat(getComputedStyle(title).fontSize) * zoom,
			cardIdPx: idLabel === null ? null : Number.parseFloat(getComputedStyle(idLabel).fontSize) * zoom,
			tagLayerAboveEdges: precedes('.vue-flow__edges') && precedes('.vue-flow__nodes'),
			cards,
			edges,
		}
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
			// The arrowhead is legible at the default Fit: at least 10px long on screen (a quarter of its nominal size before the fix).
			expect(edge.marker!.markerLength, `${edge.id} arrowhead length on screen`)
				.toBeGreaterThanOrEqual(10)

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

test('the default Survey Fit at 1440 x 900 keeps the card text at 11px or more', async ({ page }) => {
	await page.setViewportSize({ width: 1440, height: 900 })
	await openGraph(page, 'survey')
	const { zoom, cardTitlePx, cardIdPx } = await readGraph(page)
	expect(zoom)
		.toBeGreaterThanOrEqual(0.95)
	expect(cardTitlePx!)
		.toBeGreaterThanOrEqual(10.9)
	expect(cardIdPx!)
		.toBeGreaterThanOrEqual(10.9)
})

test('the default Survey Fit at 1280 x 800 keeps the card text close to 11px (it was 9.7px and 8.9px)', async ({ page }) => {
	await page.setViewportSize({ width: 1280, height: 800 })
	await openGraph(page, 'survey')
	const { zoom, cardTitlePx, cardIdPx } = await readGraph(page)
	expect(zoom)
		.toBeGreaterThanOrEqual(0.82)
	expect(cardTitlePx!)
		.toBeGreaterThanOrEqual(10.5)
	expect(cardIdPx!)
		.toBeGreaterThanOrEqual(9.8)
})

test('Fit reaches the whole expanded Trip budget, and a person cannot wheel a small graph down to a dot', async ({ page }) => {
	await page.setViewportSize({ width: 1440, height: 900 })
	await openGraph(page, 'trip-budget', { expanded: true })
	const canvas = (await page.locator('.vue-flow')
		.boundingBox())!
	const { zoom, cards } = await readGraph(page)
	expect(zoom)
		.toBeLessThan(0.1)
	for (const card of cards) {
		expect(card.rect.x, card.id)
			.toBeGreaterThanOrEqual(canvas.x - 1)
		expect(card.rect.x + card.rect.width, card.id)
			.toBeLessThanOrEqual(canvas.x + canvas.width + 1)
	}

	// The collapsed Survey fits at 0.95: Zoom out stops at about a quarter of that, not at 0.05.
	await page.goto('/?showcase=survey')
	await openDependenciesGraph(page)
	await expect(page.locator('.graph-node--cluster')
		.first())
		.toBeVisible({ timeout: 15_000 })
	for (let press = 0; press < 25; press++) {
		await page.getByRole('button', { name: 'Zoom out' })
			.click()
	}
	await expect(async () => {
		const { zoom: out } = await readGraph(page)
		expect(out)
			.toBeGreaterThanOrEqual(0.2)
		expect(out)
			.toBeLessThan(0.4)
	})
		.toPass()
})

interface FocusCase {
	showcase: 'survey' | 'trip-budget'
	/** Text of the widget's card identity (its cluster node is found from it). */
	identity: string
	/** The names the tags give the other ends, when the test checks them. */
	names?: Record<string, string>
	/** How many tags have room at the default Fit of 1440 x 900. */
	atLeast: number
}

const focusCases: FocusCase[] = [
	{ showcase: 'survey', identity: '#mode', names: { 'cluster:0': '#open-day', 'cluster:2': '#guests', 'cluster:3': '#sessions', 'cluster:4': '#phone' }, atLeast: 3 },
	{ showcase: 'survey', identity: '#guests', names: { 'cluster:0': '#open-day', 'cluster:1': '#mode', 'cluster:3': '#sessions', 'cluster:4': '#phone' }, atLeast: 3 },
	{ showcase: 'survey', identity: '#sessions', names: { 'cluster:0': '#open-day', 'cluster:1': '#mode', 'cluster:2': '#guests', 'cluster:4': '#phone' }, atLeast: 1 },
	{ showcase: 'trip-budget', identity: '#hotel', atLeast: 3 },
	{ showcase: 'trip-budget', identity: '#ana', atLeast: 3 },
	{ showcase: 'trip-budget', identity: '#settlement', atLeast: 3 },
	{ showcase: 'trip-budget', identity: '#currency', atLeast: 4 },
]

for (const focus of focusCases) {
	test(`focusing ${focus.identity} (${focus.showcase}) fades the other edges, colours its own, and tags them in the Relations view's words, on nothing`, async ({ page }) => {
		await page.setViewportSize({ width: 1440, height: 900 })
		await openGraph(page, focus.showcase)
		await page.locator('.graph-cluster-identity--collapsed')
			.filter({ hasText: focus.identity })
			.click()
		await expect(page.locator('.graph-node--focused'))
			.toContainText(focus.identity)
		const clusterId = (await page.locator('.vue-flow__node')
			.filter({ has: page.locator('.graph-cluster-identity--collapsed', { hasText: focus.identity }) })
			.getAttribute('data-id'))!
		// The edges fade with a transition: wait until the unrelated ones have.
		await expect(page.locator('.graph-edge--dimmed'))
			.not
			.toHaveCount(0)
		await expect(async () => {
			const { edges } = await readGraph(page)
			expect(edges.filter(edge => edge.opacity < 0.35).length)
				.toBeGreaterThan(0)
			expect(edges.filter(edge => edge.opacity > 0.9 && edge.opacity < 1).length)
				.toBe(0)
		})
			.toPass()

		const { cards, edges, tagLayerAboveEdges } = await readGraph(page)
		// The tags are drawn in a layer after every edge and card, so no edge is drawn across their text.
		expect(tagLayerAboveEdges)
			.toBe(true)
		const focused = cards.find(card => card.id === clusterId)!.rect
		const leaving = edges.filter(edge => edge.classes.includes('graph-edge--depends-on'))
		const arriving = edges.filter(edge => edge.classes.includes('graph-edge--used-by'))
		// (#currency depends on nothing: its edges all arrive at it.)
		expect(leaving.length + arriving.length)
			.toBeGreaterThan(3)

		// Every edge that does not touch the focus is faded; every one that does is solid and in the accent colour (arrowhead too).
		const touches = (edge: { id: string }): boolean => (JSON.parse(edge.id.slice('edge:'.length)) as string[]).includes(clusterId)
		const unrelated = edges.filter(edge => !touches(edge))
		for (const edge of unrelated) {
			expect(edge.classes, edge.id)
				.toContain('graph-edge--dimmed')
			expect(edge.opacity, edge.id)
				.toBeLessThan(0.35)
		}
		const accent = await page.evaluate(() => {
			const probe = document.createElement('span')
			probe.style.color = 'var(--lab-color-accent)'
			document.body.append(probe)
			const colour = getComputedStyle(probe).color
			probe.remove()
			return colour
		})
		const related = edges.filter(touches)
		expect(related.length)
			.toBe(leaving.length + arriving.length)
		for (const edge of related) {
			expect(edge.opacity, edge.id)
				.toBe(1)
			expect(edge.stroke, edge.id)
				.toBe(accent)
			expect(edge.marker!.fill, edge.id)
				.toBe(accent)
		}

		// The tag says which, in the words of the Relations view, with the other end named so it cannot read backwards, and agrees
		// with where the arrowhead is. It sits on its edge in the half nearer the focused card, covers no card, no arrowhead of any
		// edge around the focus (its own included) and no other tag (a tag that does not fit is left out), and is 11px or more.
		const pane = (await page.locator('.vue-flow')
			.boundingBox())!
		const tagged = related.filter(edge => edge.relationTag !== null)
		expect(tagged.length)
			.toBeGreaterThanOrEqual(focus.atLeast)
		// Each direction that has edges has a tag, where the layout leaves room for one inside what Fit shows.
		if (focus.identity !== '#sessions' && focus.identity !== '#ana') {
			expect(tagged.some(edge => edge.classes.includes('graph-edge--depends-on')))
				.toBe(leaving.length > 0)
			expect(tagged.some(edge => edge.classes.includes('graph-edge--used-by')))
				.toBe(arriving.length > 0)
		}
		const intersect = (a: Rect, b: Rect): boolean => a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y
		const inside = (rect: Rect, point: Point): boolean => point.x > rect.x && point.x < rect.x + rect.width && point.y > rect.y && point.y < rect.y + rect.height
		// Points of the arrowhead drawn at the end of an edge: a triangle `length` long (on screen) and 0.8 as wide.
		const arrowhead = (edge: { points: Point[], marker: { markerLength: number } | null }): Point[] => {
			const tip = edge.points.at(-1)!
			let travelled = 0
			let back = tip
			// The point exactly `markerLength` back along the path (the samples are about 10px apart, so interpolate in the last segment).
			for (let index = edge.points.length - 1; index > 0; index--) {
				const previous = edge.points[index - 1]!
				const step = Math.hypot(edge.points[index]!.x - previous.x, edge.points[index]!.y - previous.y)
				if (travelled + step >= edge.marker!.markerLength) {
					const t = (edge.marker!.markerLength - travelled) / step
					back = { x: edge.points[index]!.x + (previous.x - edge.points[index]!.x) * t, y: edge.points[index]!.y + (previous.y - edge.points[index]!.y) * t }
					break
				}
				travelled += step
				back = previous
			}
			const length = Math.hypot(tip.x - back.x, tip.y - back.y) || 1
			const side = { x: -(tip.y - back.y) / length * edge.marker!.markerLength * 0.4, y: (tip.x - back.x) / length * edge.marker!.markerLength * 0.4 }
			const points: Point[] = []
			for (let along = 0; along <= 10; along++) {
				for (let across = -5; across <= 5; across++) {
					const t = along / 10
					points.push({ x: back.x + (tip.x - back.x) * t + side.x * (1 - t) * (across / 5), y: back.y + (tip.y - back.y) * t + side.y * (1 - t) * (across / 5) })
				}
			}
			return points
		}
		for (const edge of tagged) {
			const [source, target] = JSON.parse(edge.id.slice('edge:'.length)) as [string, string]
			const leavesFocus = source === clusterId
			const other = leavesFocus ? target : source
			const prefix = leavesFocus ? 'Depends on' : 'Used by'
			expect(edge.relationTag!.text, edge.id)
				.toBe(focus.names ? `${prefix} ${focus.names[other]}` : edge.relationTag!.text)
			expect(edge.relationTag!.text, edge.id)
				.toMatch(new RegExp(`^${prefix} #`))
			const near = leavesFocus ? edge.points[0]! : edge.points.at(-1)!
			expect(onBorder(focused, near, 3), `${edge.id} touches the focused widget at its ${leavesFocus ? 'start' : 'end'}`)
				.toBe(true)
			const rect = edge.relationTag!.rect
			const leader = edge.relationTag!.leader
			// A tag beside its edge (no room on it) is about the point its leader line starts from: that point is what is measured.
			const centre = leader?.from ?? { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 }
			if (leader !== null) {
				// The leader starts on the tag's own edge (the samples are about 10px apart), is short, ends on the tag's box and crosses no card.
				expect(Math.min(...edge.points.map(point => Math.hypot(point.x - leader.from.x, point.y - leader.from.y))), `${edge.id} leader starts on its edge`)
					.toBeLessThan(8)
				expect(Math.hypot(leader.to.x - leader.from.x, leader.to.y - leader.from.y), `${edge.id} leader length`)
					.toBeLessThanOrEqual(4 * edge.relationTag!.fontPx * 1.3 + 1)
				expect(leader.to.x >= rect.x - 1 && leader.to.x <= rect.x + rect.width + 1 && leader.to.y >= rect.y - 1 && leader.to.y <= rect.y + rect.height + 1, `${edge.id} leader ends on its tag`)
					.toBe(true)
				for (const card of cards) {
					const crosses = Array.from({ length: 21 }, (_, index) => ({ x: leader.from.x + (leader.to.x - leader.from.x) * index / 20, y: leader.from.y + (leader.to.y - leader.from.y) * index / 20 }))
						.some(point => inside(card.rect, point))
					expect(crosses, `${edge.id} leader crosses ${card.id}`)
						.toBe(false)
				}
			}
			// On its edge, in the half nearer the focused card: measured along the curve, at the sample nearest the tag.
			const along = [0]
			for (let index = 1; index < edge.points.length; index++)
				along.push(along[index - 1]! + Math.hypot(edge.points[index]!.x - edge.points[index - 1]!.x, edge.points[index]!.y - edge.points[index - 1]!.y))
			let nearest = 0
			for (let index = 1; index < edge.points.length; index++) {
				if (Math.hypot(edge.points[index]!.x - centre.x, edge.points[index]!.y - centre.y) < Math.hypot(edge.points[nearest]!.x - centre.x, edge.points[nearest]!.y - centre.y))
					nearest = index
			}
			const fromStart = along[nearest]! / along.at(-1)!
			expect(leavesFocus ? fromStart : 1 - fromStart, `${edge.id} tag is in the half of the edge nearer the focused card`)
				.toBeLessThanOrEqual(0.55)
			// Fit does not fit the tags, so they must lie where Fit always shows: inside the pane, not cut off at its edges.
			expect(rect.x, `${edge.id} tag left of the pane`)
				.toBeGreaterThanOrEqual(pane.x - 0.5)
			expect(rect.x + rect.width, `${edge.id} tag right of the pane`)
				.toBeLessThanOrEqual(pane.x + pane.width + 0.5)
			expect(rect.y, `${edge.id} tag top of the pane`)
				.toBeGreaterThanOrEqual(pane.y - 0.5)
			expect(rect.y + rect.height, `${edge.id} tag bottom of the pane`)
				.toBeLessThanOrEqual(pane.y + pane.height + 0.5)
			expect(edge.relationTag!.fontPx, `${edge.id} tag text on screen`)
				.toBeGreaterThanOrEqual(10.9)
			for (const card of cards) {
				expect(intersect(rect, card.rect), `${edge.id} tag covers ${card.id}`)
					.toBe(false)
			}
			for (const around of related) {
				expect(arrowhead(around)
					.some(point => inside(rect, point)), `${edge.id} tag covers the arrowhead of ${around.id}`)
					.toBe(false)
			}
			for (const otherEdge of tagged) {
				if (otherEdge !== edge) {
					expect(intersect(rect, otherEdge.relationTag!.rect), `${edge.id} tag covers the tag of ${otherEdge.id}`)
						.toBe(false)
				}
			}
		}
	})
}

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
			probe.style.color = 'color-mix(in srgb, var(--lab-color-text-muted) 82%, var(--lab-color-surface-alt))'
			document.body.append(probe)
			const colour = getComputedStyle(probe).color
			probe.remove()
			return colour
		})
		// The marker's fill is the stroke it ends, in the current theme's tokens (a mix of the muted text colour and the canvas).
		expect(reads.marker?.fill)
			.toBe(tokenColour)
		expect(reads.marker?.fill)
			.toBe(reads.stroke)
	})
}

/**
 * Keyboard access to the edges (issue #230 follow-up). They are one Tab stop: the arrow keys walk them, a focused edge shows
 * what a hovered one shows plus a focus band, Enter or Space selects it as a click does (its details open), Escape clears.
 */
test('the edges are one Tab stop: arrows walk them, focus shows the label, Enter opens the details, Escape clears', async ({ page }) => {
	await openGraph(page, 'survey')
	const edges = page.locator('.vue-flow__edge')
	const count = await edges.count()
	expect(count)
		.toBeGreaterThan(2)
	// One edge is in the Tab order, the others are focusable only from it.
	const tabStop = page.locator('.vue-flow__edge[tabindex="0"]')
	await expect(tabStop)
		.toHaveCount(1)
	await expect(page.locator('.vue-flow__edge[tabindex="-1"]'))
		.toHaveCount(count - 1)
	// Named by what it is and by its two ends, in the direction of the arrow.
	await expect(tabStop)
		.toHaveAttribute('aria-label', /^\d+ deps?: #\S+ → #\S+$/)

	// The edges come before the cards in the document, so Shift+Tab from the first card lands on the edges' Tab stop.
	await page.locator('.vue-flow__node')
		.first()
		.focus()
	await page.keyboard.press('Shift+Tab')
	await expect(tabStop)
		.toBeFocused()
	// Focus shows the focus band and the label a hover shows.
	await expect(tabStop.locator('.graph-edge-focus-ring'))
		.toHaveCSS('opacity', '1')
	await expect(tabStop.locator('.vue-flow__edge-text'))
		.toHaveCSS('opacity', '1')
	const firstId = await tabStop.getAttribute('data-id')

	// The arrow keys walk the edges and wrap around.
	await page.keyboard.press('ArrowDown')
	const focused = page.locator('.vue-flow__edge:focus')
	await expect(focused)
		.toHaveCount(1)
	const secondId = await focused.getAttribute('data-id')
	expect(secondId)
		.not.toBe(firstId)
	await expect(focused.locator('.graph-edge-focus-ring'))
		.toHaveCSS('opacity', '1')
	await expect(tabStop.locator('.graph-edge-focus-ring'))
		.toHaveCSS('opacity', '0')
	await page.keyboard.press('ArrowUp')
	await expect(tabStop)
		.toBeFocused()
	await page.keyboard.press('ArrowUp')
	expect(await focused.getAttribute('data-id'))
		.not.toBe(firstId)
	await page.keyboard.press('Home')
	await expect(tabStop)
		.toBeFocused()

	// Enter selects like a click: the edge is selected and its details open under the canvas.
	const details = page.locator('[data-graph-edge-details]')
	await expect(details)
		.toHaveCount(0)
	await page.keyboard.press('Enter')
	await expect(tabStop)
		.toHaveClass(/\bselected\b/)
	await expect(details)
		.toBeVisible()
	await expect(details)
		.toContainText('target:')

	// Escape clears the selection and the details; focus stays on the edge.
	await page.keyboard.press('Escape')
	await expect(tabStop)
		.not.toHaveClass(/\bselected\b/)
	await expect(details)
		.toHaveCount(0)
	await expect(tabStop)
		.toBeFocused()

	// Space selects as well.
	await page.keyboard.press('Space')
	await expect(tabStop)
		.toHaveClass(/\bselected\b/)
	await expect(details)
		.toBeVisible()
})

test('with a widget selected, the edges\' Tab stop is one of its own edges, and zh-TW names the edge', async ({ page }) => {
	await openGraph(page, 'survey')
	await page.locator('.graph-cluster-identity')
		.first()
		.click()
	await expect(page.locator('.graph-edge--dimmed')
		.first())
		.toBeVisible()
	const tabStop = page.locator('.vue-flow__edge[tabindex="0"]')
	await expect(tabStop)
		.toHaveCount(1)
	await expect(tabStop)
		.toHaveClass(/graph-edge--(depends-on|used-by)/)
	await expect(tabStop)
		.toHaveAttribute('aria-label', /^\d+ deps?: #\S+ → #\S+$/)

	await setLocale(page, 'zh-TW')
	await expect(tabStop)
		.toHaveAttribute('aria-label', /^\d+ 個依賴：#\S+ → #\S+$/)
})
