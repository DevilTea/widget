import type { Page } from '@playwright/test'
import { expandGraphWidget, expect, graphWidgetCard, maximizeTools, openDependenciesGraph, setLocale, test } from './fixtures'

/**
 * Issue #230, "the Graph is hard to read": what a person sees in the real browser. The cards are spread out, every dependency
 * is a Bezier curve (not an orthogonal route with rounded corners) that ends in an arrowhead on the member it depends on,
 * and no curve disappears behind a card. The same properties are measured on the layout alone in
 * `src/graph/graph-readability.unit.test.ts`; here they are read from the rendered SVG, in screen coordinates.
 *
 * Since Lab UX phase 3B the Graph is an expert view in the Tools group below the Preview, which opens with half of the Preview's
 * column (there the collapsed Survey fits at about 0.37 at 1440 x 900). The Tools group has a Maximize action for that, and these
 * specs read the Graph the way a person reading it would: with the Tools group maximized over the workbench (`giveGraphTheWorkbench`).
 * The thresholds are issue #230's. Expanding a widget goes to a readable zoom on that widget (member text 11px) in both panes, and
 * the minimap shows where the viewport is; those are read in the default pane and maximized.
 */

/** Maximizes the Tools group, then asks the Graph to fit the room it has now. */
async function giveGraphTheWorkbench(page: Page): Promise<void> {
	await maximizeTools(page)
	await page.getByRole('button', { name: 'Fit graph' })
		.click()
}

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

/** `expand`: the id of the one widget to expand (one widget is expanded at a time, issue #254). */
async function openGraph(page: Page, showcase: 'survey' | 'trip-budget', options: { expand?: string, maximize?: boolean } = {}): Promise<void> {
	await page.goto(`/?showcase=${showcase}`)
	await openDependenciesGraph(page)
	await expect(page.locator('.graph-node--cluster')
		.first())
		.toBeVisible({ timeout: 15_000 })
	if (options.maximize !== false)
		await giveGraphTheWorkbench(page)
	if (options.expand !== undefined) {
		await expandGraphWidget(page, options.expand)
		await expect(page.locator('.graph-node--member')
			.first())
			.toBeVisible({ timeout: 15_000 })
	}
	// The automatic fit has settled once the viewport stops changing between two frames.
	await settleViewport(page)
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

test('survey Graph with #sessions expanded: Bezier edges, each with an arrowhead', async ({ page }) => {
	await openGraph(page, 'survey', { expand: 'sessions' })
	const { edges } = await readGraph(page)
	// 25 edges: the 8 members of #sessions with their own dependencies, and the other widgets' as cards.
	expect(edges.length)
		.toBeGreaterThan(20)
	for (const edge of edges) {
		expect(edge.d, edge.id)
			.toMatch(BEZIER_PATH)
		expect(edge.marker, edge.id)
			.not
			.toBeNull()
	}
})

test('the Survey Fit at 1440 x 900 (Tools maximized) keeps the card text at 11px or more', async ({ page }) => {
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

// Not maximized, the Tools group has half of the Preview's column: the collapsed Survey fits at about 0.37 at 1440 x 900 (measured). The
// Graph is not meant to be read there (Maximize is), but this keeps that default from shrinking further unnoticed.
test('at the Tools group\'s default size the Survey Fit stays at 0.3 or more', async ({ page }) => {
	await page.setViewportSize({ width: 1440, height: 900 })
	await openGraph(page, 'survey', { maximize: false })
	const { zoom } = await readGraph(page)
	expect(zoom)
		.toBeGreaterThanOrEqual(0.3)
})

test('the Survey Fit at 1280 x 800 (Tools maximized) keeps the card text close to 11px (it was 9.7px and 8.9px)', async ({ page }) => {
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

/** Waits until the viewport stops changing between two frames (an automatic fit or a Fit graph has settled). */
async function settleViewport(page: Page): Promise<void> {
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

/** Every card (members included; not the shell of an expanded widget) lies inside the canvas. */
async function expectWholeLayoutInView(page: Page): Promise<void> {
	const canvas = (await page.locator('.vue-flow')
		.boundingBox())!
	const { cards } = await readGraph(page)
	// The collapsed Survey has five widgets.
	expect(cards.length)
		.toBeGreaterThanOrEqual(5)
	for (const card of cards) {
		expect(card.rect.x, card.id)
			.toBeGreaterThanOrEqual(canvas.x - 1)
		expect(card.rect.x + card.rect.width, card.id)
			.toBeLessThanOrEqual(canvas.x + canvas.width + 1)
		expect(card.rect.y, card.id)
			.toBeGreaterThanOrEqual(canvas.y - 1)
		expect(card.rect.y + card.rect.height, card.id)
			.toBeLessThanOrEqual(canvas.y + canvas.height + 1)
	}
}

/** The on-screen size of member text, and where the expanded widget's type and id are, relative to the canvas. */
async function readExpanded(page: Page): Promise<{ zoom: number, memberPx: number, title: Rect, collapse: Rect, canvas: Rect }> {
	return page.evaluate(() => {
		const pane = document.querySelector<HTMLElement>('.vue-flow__transformationpane')!
		const zoom = Number(/scale\(([-\d.]+)\)/.exec(pane.style.transform)?.[1] ?? 1)
		const member = document.querySelector('.graph-member-label')!
		const title = document.querySelector('.graph-cluster-card--expanded .graph-cluster-identity')!
			.getBoundingClientRect()
		const collapse = document.querySelector('.graph-cluster-card--expanded .graph-cluster-toggle')!
			.getBoundingClientRect()
		const canvas = document.querySelector('.vue-flow')!
			.getBoundingClientRect()
		return {
			zoom,
			memberPx: Number.parseFloat(getComputedStyle(member).fontSize) * zoom,
			title: { x: title.x, y: title.y, width: title.width, height: title.height },
			collapse: { x: collapse.x, y: collapse.y, width: collapse.width, height: collapse.height },
			canvas: { x: canvas.x, y: canvas.y, width: canvas.width, height: canvas.height },
		}
	})
}

// Issue #254: one widget is expanded at a time. The largest widgets (the lowest Fit, measured with the real ELK in
// `graph-readability.unit.test.ts`) are the Survey's #sessions and the Trip budget's #hotel. Fitting the whole layout with one of them
// expanded puts member text far under 11px (in issue #230's pane 0.415 and 0.196: about 5px and 2.4px), so expanding goes to the
// readable zoom instead (11 / 12, member text 11px on screen) and frames the expanded widget: its header at the top of the canvas.
// Fit graph afterwards returns to the whole layout. Maximized at 1440 x 900 that Fit is measured at 0.649 and 0.331, the centres of the
// bands below (a band on both sides, so a Fit that grows past the graph fails as well as one that shrinks).
const largestWidgets = [
	{ showcase: 'survey', widget: 'sessions', fit: 0.65, band: 0.05 },
	{ showcase: 'trip-budget', widget: 'hotel', fit: 0.33, band: 0.04 },
] as const
for (const size of [{ width: 1440, height: 900 }, { width: 1280, height: 800 }] as const) {
	for (const maximize of [false, true]) {
		for (const { showcase, widget, fit, band } of largestWidgets) {
			const pane = maximize ? 'Tools maximized' : 'the default Tools pane'
			test(`expanding #${widget} (${showcase}) at ${size.width} x ${size.height} in ${pane}: member text 11px, header in view; Fit graph shows the whole layout`, async ({ page }) => {
				await page.setViewportSize(size)
				await openGraph(page, showcase, { expand: widget, maximize })

				const expanded = await readExpanded(page)
				expect(expanded.zoom)
					.toBeCloseTo(11 / 12, 3)
				expect(expanded.memberPx)
					.toBeGreaterThanOrEqual(10.99)
				// The type and id of the expanded widget are in view, at the top of the canvas.
				expect(expanded.title.y)
					.toBeGreaterThanOrEqual(expanded.canvas.y)
				expect(expanded.title.y + expanded.title.height)
					.toBeLessThanOrEqual(expanded.canvas.y + 60)
				expect(expanded.title.x)
					.toBeGreaterThanOrEqual(expanded.canvas.x)
				expect(expanded.title.x)
					.toBeLessThan(expanded.canvas.x + expanded.canvas.width / 2)
				// So is its Collapse button, which has the keyboard focus after the expansion (the header keeps it at the left).
				expect(expanded.collapse.y)
					.toBeGreaterThanOrEqual(expanded.canvas.y)
				expect(expanded.collapse.x + expanded.collapse.width)
					.toBeLessThanOrEqual(expanded.canvas.x + expanded.canvas.width)
				await expect(graphWidgetCard(page, widget)
					.getByRole('button', { name: 'Collapse', exact: true }))
					.toBeFocused()

				await page.getByRole('button', { name: 'Fit graph' })
					.click()
				await settleViewport(page)
				const { zoom } = await readGraph(page)
				expect(zoom)
					.toBeLessThan(11 / 12)
				if (maximize && size.width === 1440) {
					expect(zoom)
						.toBeGreaterThan(fit - band)
					expect(zoom)
						.toBeLessThan(fit + band)
				}
				await expectWholeLayoutInView(page)
			})
		}
	}
}

test('collapsing, Collapse all and a new semantic graph fit the whole layout; re-expanding frames again; focus never zooms', async ({ page }) => {
	await page.setViewportSize({ width: 1440, height: 900 })
	await openGraph(page, 'survey', { expand: 'sessions' })
	const transform = page.locator('.vue-flow__transformationpane')
	expect((await readGraph(page)).zoom)
		.toBeCloseTo(11 / 12, 3)

	// Selecting a member (shared focus) neither refits nor zooms.
	const framed = await transform.getAttribute('style')
	await page.locator('.graph-member-card', { hasText: 'errors' })
		.click()
	await expect(page.locator('.graph-node--focused'))
		.toHaveCount(1)
	await expect(transform)
		.toHaveAttribute('style', framed ?? '')

	// Collapsing with the card's own button: the whole collapsed Survey (about 1.07 maximized).
	await graphWidgetCard(page, 'sessions')
		.getByRole('button', { name: 'Collapse', exact: true })
		.click()
	await expect(page.locator('.graph-member-card'))
		.toHaveCount(0)
	await settleViewport(page)
	expect((await readGraph(page)).zoom)
		.toBeGreaterThan(0.95)
	await expectWholeLayoutInView(page)

	// The same widget again: framed again.
	await expandGraphWidget(page, 'sessions')
	await settleViewport(page)
	expect((await readGraph(page)).zoom)
		.toBeCloseTo(11 / 12, 3)

	// A new semantic graph (a filter) with #sessions still expanded: a layout not caused by expanding, so the whole layout.
	await page.getByRole('checkbox', { name: 'Show isolated members' })
		.check()
	await expect(async () => {
		await settleViewport(page)
		expect((await readGraph(page)).zoom)
			.toBeLessThan(0.75)
	})
		.toPass()
	await expect(graphWidgetCard(page, 'sessions')
		.getByRole('button', { name: 'Collapse', exact: true }))
		.toBeVisible()
	await expectWholeLayoutInView(page)

	// Collapse all: the whole layout.
	await page.getByRole('checkbox', { name: 'Show isolated members' })
		.uncheck()
	await expandGraphWidget(page, 'mode')
	await page.getByRole('button', { name: 'Collapse all' })
		.click()
	await expect(page.locator('.graph-member-card'))
		.toHaveCount(0)
	await settleViewport(page)
	expect((await readGraph(page)).zoom)
		.toBeGreaterThan(0.95)
	await expectWholeLayoutInView(page)
})

/**
 * The minimap (`@vue-flow/minimap`): shown while part of the graph is out of view in a canvas of at least 320 x 160 and no focus tag
 * is under it, aria-hidden and without tab stops, in a corner of the canvas (so it covers neither the key nor the toolbar), themed with the Lab tokens.
 */
const minimap = (page: Page) => page.getByTestId('graph-minimap')

test('the minimap shows while the expanded widget is framed, and hides when the whole layout is in view', async ({ page }) => {
	await page.setViewportSize({ width: 1440, height: 900 })
	await openGraph(page, 'trip-budget', { expand: 'hotel' })
	await expect(minimap(page))
		.toBeVisible()
	await expect(minimap(page))
		.toHaveAttribute('aria-hidden', 'true')
	expect(await minimap(page)
		.locator('[tabindex], a, button, input')
		.count())
		.toBe(0)

	// In the canvas's bottom right corner: below the key and the toolbar, inside the canvas.
	const canvas = (await page.locator('.vue-flow')
		.boundingBox())!
	const map = (await minimap(page)
		.boundingBox())!
	const key = (await page.getByTestId('graph-key')
		.boundingBox())!
	expect(map.x)
		.toBeGreaterThan(canvas.x + canvas.width / 2)
	expect(map.y)
		.toBeGreaterThan(canvas.y + canvas.height / 2)
	expect(map.x + map.width)
		.toBeLessThanOrEqual(canvas.x + canvas.width)
	expect(map.y + map.height)
		.toBeLessThanOrEqual(canvas.y + canvas.height)
	expect(map.y)
		.toBeGreaterThan(key.y + key.height)

	// Fit graph: everything in view, nothing for the minimap to add.
	await page.getByRole('button', { name: 'Fit graph' })
		.click()
	await expect(minimap(page))
		.toHaveCount(0)

	// Zooming in on the whole layout brings it back.
	await page.getByTestId('graph-zoom-in')
		.click()
	await expect(minimap(page))
		.toBeVisible()
})

// The default Tools pane is where most people see the Graph, and where an expanded widget is framed in the least room: the minimap
// shows there too, sized to the canvas, in the bottom right corner, clear of the expanded widget's header (top left).
for (const size of [{ width: 1440, height: 900 }, { width: 1280, height: 800 }] as const) {
	test(`the minimap shows in the default Tools pane at ${size.width} x ${size.height}, sized to the canvas, clear of the expanded widget's header`, async ({ page }) => {
		await page.setViewportSize(size)
		await openGraph(page, 'trip-budget', { expand: 'hotel', maximize: false })
		await expect(minimap(page))
			.toBeVisible()
		const expanded = await readExpanded(page)
		const map = (await minimap(page)
			.boundingBox())!
		// About a fifth of the canvas wide (19%, plus its border), within 96 x 64 and 200 x 120.
		expect(map.width)
			.toBeGreaterThanOrEqual(96)
		expect(map.width)
			.toBeLessThanOrEqual(202)
		expect(Math.abs(map.width - 2 - expanded.canvas.width * 0.19))
			.toBeLessThan(2)
		expect(map.height)
			.toBeGreaterThanOrEqual(64)
		expect(map.height)
			.toBeLessThanOrEqual(122)
		expect(map.x + map.width)
			.toBeLessThanOrEqual(expanded.canvas.x + expanded.canvas.width)
		expect(map.y + map.height)
			.toBeLessThanOrEqual(expanded.canvas.y + expanded.canvas.height)
		for (const [name, rect] of [['type and id', expanded.title], ['Collapse button', expanded.collapse]] as const) {
			const overlaps = rect.x < map.x + map.width && map.x < rect.x + rect.width && rect.y < map.y + map.height && map.y < rect.y + rect.height
			expect(overlaps, `the minimap covers the ${name}`)
				.toBe(false)
		}
	})
}

test('the minimap is hidden in a canvas lower than 160px (a 1440 x 600 window)', async ({ page }) => {
	await page.setViewportSize({ width: 1440, height: 600 })
	await openGraph(page, 'trip-budget', { maximize: false })
	const canvas = (await page.locator('.vue-flow')
		.boundingBox())!
	expect(canvas.height)
		.toBeLessThan(160)
	const fitted = (await readGraph(page)).zoom
	for (let press = 0; press < 4; press++) {
		await page.getByTestId('graph-zoom-in')
			.click()
	}
	await settleViewport(page)
	// Zoomed in: part of the graph is out of view, so only the size of the canvas keeps the minimap away.
	expect((await readGraph(page)).zoom)
		.toBeGreaterThan(fitted * 2)
	await expect(minimap(page))
		.toHaveCount(0)
})

test('the minimap gives way to a focus tag that would be under it, and comes back when the tag is clear', async ({ page }) => {
	await page.setViewportSize({ width: 1440, height: 900 })
	await openGraph(page, 'trip-budget', { expand: 'hotel' })
	await page.locator('.graph-member-card', { hasText: 'shares' })
		.click()
	await expect(page.locator('.graph-tag-layer .graph-tag')
		.first())
		.toBeVisible()
	await expect(minimap(page))
		.toBeVisible()
	const map = (await minimap(page)
		.boundingBox())!
	const tag = (await page.locator('.graph-tag-layer .graph-tag .graph-tag-bg')
		.first()
		.boundingBox())!
	// Drag the canvas (from an empty spot of the pane) so the tag's centre lands on the minimap's centre, then back.
	const delta = { x: map.x + map.width / 2 - (tag.x + tag.width / 2), y: map.y + map.height / 2 - (tag.y + tag.height / 2) }
	await dragPane(page, delta)
	// Hidden (visibility, no pointer events) but still mounted, so a drag of it in progress could not lose it.
	await expect(minimap(page))
		.toHaveAttribute('data-covering', 'true')
	await expect(minimap(page))
		.toBeHidden()
	await expect(minimap(page))
		.toHaveCount(1)
	await dragPane(page, { x: -delta.x, y: -delta.y })
	await expect(minimap(page))
		.toBeVisible()
	await expect(minimap(page))
		.toHaveAttribute('data-covering', 'false')
})

/** Drags the Graph canvas by `delta` screen px, from an empty spot of the pane (not a card, not an edge). */
async function dragPane(page: Page, delta: Point): Promise<void> {
	const canvas = (await page.locator('.vue-flow')
		.boundingBox())!
	const start = await page.evaluate(({ canvas, delta }) => {
		for (let y = canvas.y + 10; y < canvas.y + canvas.height - 10; y += 7) {
			for (let x = canvas.x + 10; x < canvas.x + canvas.width - 10; x += 7) {
				const end = { x: x + delta.x, y: y + delta.y }
				const inside = end.x > canvas.x + 2 && end.x < canvas.x + canvas.width - 2 && end.y > canvas.y + 2 && end.y < canvas.y + canvas.height - 2
				if (inside && document.elementFromPoint(x, y)?.classList.contains('vue-flow__pane') === true)
					return { x, y }
			}
		}
		return null
	}, { canvas, delta })
	expect(start, 'an empty spot of the pane to drag from')
		.not
		.toBeNull()
	await page.mouse.move(start!.x, start!.y)
	await page.mouse.down()
	await page.mouse.move(start!.x + delta.x, start!.y + delta.y, { steps: 8 })
	await page.mouse.up()
}

/**
 * The Graph key folds away in a short pane (the view area under 360px): at the width of the default Tools pane it wraps to two lines
 * and took about 50 of the canvas's 300px. The Graph key button shows it; maximized, it is shown as before.
 */
test('the Graph key starts folded in the default Tools pane, its button shows it (drawn pressed), and maximized it is shown', async ({ page }) => {
	await page.setViewportSize({ width: 1440, height: 900 })
	await openGraph(page, 'survey', { maximize: false })
	const key = page.getByTestId('graph-key')
	const toggle = page.getByRole('button', { name: 'Graph key', exact: true })
	await expect(key)
		.toBeHidden()
	await expect(toggle)
		.toHaveAttribute('aria-expanded', 'false')
	expect(await toggle.getAttribute('aria-controls'))
		.toBe(await key.getAttribute('id'))
	const folded = (await page.locator('.vue-flow')
		.boundingBox())!
	expect(folded.height)
		.toBeGreaterThanOrEqual(295)

	await toggle.click()
	await expect(key)
		.toBeVisible()
	await expect(key)
		.toHaveAccessibleName('Graph key')
	await expect(toggle)
		.toHaveAttribute('aria-expanded', 'true')
	// Expanded, it is drawn pressed: its border is the accent colour (folded, the ordinary border).
	const accent = await page.evaluate(() => {
		const probe = document.createElement('span')
		probe.style.color = 'var(--lab-color-accent)'
		document.body.append(probe)
		const colour = getComputedStyle(probe).color
		probe.remove()
		return colour
	})
	await expect(toggle)
		.toHaveCSS('border-top-color', accent)
	await expect.poll(async () => (await page.locator('.vue-flow')
		.boundingBox())!.height)
		.toBeLessThan(folded.height - 20)
	await toggle.click()
	await expect(key)
		.toBeHidden()
	await expect(toggle)
		.not
		.toHaveCSS('border-top-color', accent)

	// A fresh Lab, maximized: the key is shown and the button says so.
	await page.goto('/?showcase=survey')
	await openDependenciesGraph(page)
	await maximizeTools(page)
	await expect(page.getByTestId('graph-key'))
		.toBeVisible()
	await expect(page.getByRole('button', { name: 'Graph key', exact: true }))
		.toHaveAttribute('aria-expanded', 'true')
})

test('dragging the minimap pans the canvas at the same zoom, and a click centres the viewport on that point', async ({ page }) => {
	await page.setViewportSize({ width: 1440, height: 900 })
	await openGraph(page, 'trip-budget', { expand: 'hotel' })
	await expect(minimap(page))
		.toBeVisible()
	const translate = async (): Promise<{ x: number, y: number, zoom: number }> => page.locator('.vue-flow__transformationpane')
		.evaluate((element) => {
			const matrix = new DOMMatrix(getComputedStyle(element).transform)
			return { x: matrix.e, y: matrix.f, zoom: matrix.a }
		})
	const before = await translate()
	const map = (await minimap(page)
		.boundingBox())!
	await page.mouse.move(map.x + map.width / 2, map.y + map.height / 2)
	await page.mouse.down()
	await page.mouse.move(map.x + map.width / 2 + 20, map.y + map.height / 2 + 10, { steps: 5 })
	await page.mouse.up()
	const dragged = await translate()
	// Dragging the viewport rectangle right and down moves the view right and down: the content moves left and up.
	expect(dragged.zoom)
		.toBeCloseTo(before.zoom, 5)
	expect(dragged.x)
		.toBeLessThan(before.x - 50)
	expect(dragged.y)
		.toBeLessThan(before.y)

	// A click centres the viewport on the point clicked, at the same zoom: the flow point under the pointer (mapped through the
	// minimap's viewBox, letterboxing included, by its screen matrix) ends up in the middle of the canvas.
	const target = await minimap(page)
		.locator('svg')
		.evaluate((svg) => {
			const rect = svg.getBoundingClientRect()
			// Whole pixels: the click reaches the page at whole pixels, and one minimap pixel is many canvas pixels.
			const screen = { x: Math.round(rect.x + rect.width * 0.25), y: Math.round(rect.y + rect.height * 0.3) }
			const flow = new DOMPoint(screen.x, screen.y)
				.matrixTransform((svg as SVGSVGElement).getScreenCTM()!.inverse())
			return { screen, flow: { x: flow.x, y: flow.y } }
		})
	await page.mouse.click(target.screen.x, target.screen.y)
	const canvas = (await page.locator('.vue-flow')
		.boundingBox())!
	await expect(async () => {
		const after = await translate()
		expect(after.zoom)
			.toBeCloseTo(before.zoom, 5)
		expect(Math.abs(canvas.x + target.flow.x * after.zoom + after.x - (canvas.x + canvas.width / 2)))
			.toBeLessThan(2)
		expect(Math.abs(canvas.y + target.flow.y * after.zoom + after.y - (canvas.y + canvas.height / 2)))
			.toBeLessThan(2)
	})
		.toPass()
})

test('dragging the minimap keeps the same minimap while a tag passes under it, and nothing moves after the release', async ({ page }) => {
	await page.setViewportSize({ width: 1440, height: 900 })
	await openGraph(page, 'trip-budget', { expand: 'hotel' })
	await page.locator('.graph-member-card', { hasText: 'shares' })
		.click()
	await expect(page.locator('.graph-tag-layer .graph-tag')
		.first())
		.toBeVisible()
	await expect(minimap(page))
		.toBeVisible()
	const translate = async (): Promise<{ x: number, y: number }> => page.locator('.vue-flow__transformationpane')
		.evaluate((element) => {
			const matrix = new DOMMatrix(getComputedStyle(element).transform)
			return { x: matrix.e, y: matrix.f }
		})
	// Mark this minimap element: a remount would be a new element without the mark.
	await minimap(page)
		.evaluate((element) => {
			(element as HTMLElement & { labProbe?: boolean }).labProbe = true
		})
	const sameMinimap = async (): Promise<boolean> => page.evaluate(() => {
		const element = document.querySelector('[data-testid="graph-minimap"]') as (HTMLElement & { labProbe?: boolean }) | null
		return element?.labProbe === true && element.isConnected
	})
	const map = (await minimap(page)
		.boundingBox())!
	const tag = (await page.locator('.graph-tag-layer .graph-tag:not(.graph-tag--hidden) .graph-tag-bg')
		.first()
		.boundingBox())!
	// The tag has to travel by this much (screen px) to sit on the minimap's centre.
	const needed = { x: map.x + map.width / 2 - (tag.x + tag.width / 2), y: map.y + map.height / 2 - (tag.y + tag.height / 2) }

	const start = { x: map.x + map.width / 2, y: map.y + map.height / 2 }
	await page.mouse.move(start.x, start.y)
	await page.mouse.down()
	// Dragging the minimap by one px moves the canvas the opposite way by many px: measure that ratio with a first small step.
	const origin = await translate()
	await page.mouse.move(start.x - 2, start.y - 2)
	const probe = await translate()
	const ratio = { x: (probe.x - origin.x) / 2, y: (probe.y - origin.y) / 2 }
	expect(ratio.x)
		.toBeGreaterThan(1)
	let passedUnder = false
	for (let step = 1; step <= 12; step++) {
		const pointer = { x: start.x - needed.x / ratio.x * step / 10, y: start.y - needed.y / ratio.y * step / 10 }
		await page.mouse.move(pointer.x, pointer.y)
		const state = await page.evaluate(({ map }) => {
			const element = document.querySelector('[data-testid="graph-minimap"]')
			const tags = [...document.querySelectorAll('.graph-tag-layer .graph-tag:not(.graph-tag--hidden) .graph-tag-bg')].map(node => node.getBoundingClientRect())
			const under = tags.some(rect => rect.x < map.x + map.width && map.x < rect.x + rect.width && rect.y < map.y + map.height && map.y < rect.y + rect.height)
			return { under, visible: element !== null && getComputedStyle(element).visibility === 'visible' }
		}, { map })
		if (state.under) {
			passedUnder = true
			// Frozen while dragged: the same minimap, still there and visible under the pointer.
			expect(state.visible)
				.toBe(true)
		}
		expect(await sameMinimap(), `the minimap was replaced at step ${step}`)
			.toBe(true)
	}
	expect(passedUnder, 'a tag passed under the minimap during the drag')
		.toBe(true)
	await page.mouse.up()
	expect(await sameMinimap())
		.toBe(true)

	// Released: nothing moves any more, whatever the pointer does.
	await settleViewport(page)
	const released = await translate()
	await page.mouse.move(start.x - 200, start.y - 150, { steps: 6 })
	await page.mouse.move(start.x + 50, start.y + 40, { steps: 6 })
	await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))))
	expect(await translate())
		.toEqual(released)
	// And with the tag now under it, it gives way, without being unmounted.
	await expect(minimap(page))
		.toHaveAttribute('data-covering', 'true')
	await expect(minimap(page))
		.toBeHidden()
	expect(await sameMinimap())
		.toBe(true)
})

for (const theme of ['light', 'dark'] as const) {
	test(`the minimap takes the ${theme} theme's tokens`, async ({ context, page }) => {
		await context.addInitScript((value) => {
			localStorage.setItem('widget-lab:theme', value)
		}, theme)
		await page.setViewportSize({ width: 1440, height: 900 })
		await openGraph(page, 'survey', { expand: 'sessions' })
		await expect(page.locator('html'))
			.toHaveAttribute('data-lab-theme', theme)
		await expect(minimap(page))
			.toBeVisible()
		const colours = await page.evaluate(() => {
			const resolve = (property: 'color' | 'backgroundColor', value: string): string => {
				const probe = document.createElement('span')
				probe.style[property] = value
				document.body.append(probe)
				const colour = getComputedStyle(probe)[property]
				probe.remove()
				return colour
			}
			const map = document.querySelector('[data-testid="graph-minimap"]')!
			const mask = map.querySelector('.vue-flow__minimap-mask')!
			return {
				background: getComputedStyle(map).backgroundColor,
				surface: resolve('backgroundColor', 'var(--lab-color-surface)'),
				viewport: getComputedStyle(mask).stroke,
				accent: resolve('color', 'var(--lab-color-accent)'),
			}
		})
		expect(colours.background)
			.toBe(colours.surface)
		expect(colours.viewport)
			.toBe(colours.accent)
	})
}

test('a person cannot wheel a small graph down to a dot', async ({ page }) => {
	await page.setViewportSize({ width: 1440, height: 900 })

	// The collapsed Survey fits at 0.95: Zoom out stops at about a quarter of that, not at 0.05.
	await page.goto('/?showcase=survey')
	await openDependenciesGraph(page)
	await expect(page.locator('.graph-node--cluster')
		.first())
		.toBeVisible({ timeout: 15_000 })
	await giveGraphTheWorkbench(page)
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
 * Keyboard access to the edges (issue #230 follow-up). They are one roving Tab stop: the arrow keys walk them, Tab and Shift+Tab
 * leave the group from whichever edge has focus, a focused edge shows what a hovered one shows plus a focus band, Enter or
 * Space selects it as a click does (its details open), Escape clears.
 */
function focusedEdgeId(page: Page): Promise<string | null> {
	return page.evaluate(() => document.activeElement?.classList.contains('vue-flow__edge') === true ? document.activeElement.getAttribute('data-id') : null)
}

function edgeTabStops(page: Page): Promise<(string | null)[]> {
	return page.locator('.vue-flow__edge[tabindex="0"]')
		.evaluateAll(elements => elements.map(element => element.getAttribute('data-id')))
}

test('the edges are one roving Tab stop: arrows walk them, Tab and Shift+Tab leave the group, Enter opens the details, Escape clears', async ({ page }) => {
	await openGraph(page, 'survey')
	const edges = page.locator('.vue-flow__edge')
	const count = await edges.count()
	expect(count)
		.toBeGreaterThan(2)
	// One edge is in the Tab order, the others are focusable only from it.
	const initialStop = page.locator('.vue-flow__edge[tabindex="0"]')
	await expect(initialStop)
		.toHaveCount(1)
	await expect(page.locator('.vue-flow__edge[tabindex="-1"]'))
		.toHaveCount(count - 1)
	// Named as a sentence about its two ends, with what it stands for; described by what the keys do, not by Vue Flow's
	// English "press delete to remove it".
	await expect(initialStop)
		.toHaveAttribute('aria-label', /^#\S+ depends on #\S+ \(\d+ deps?\)$/)
	await expect(initialStop)
		.toHaveAttribute('aria-roledescription', 'dependency')
	const describedBy = await initialStop.getAttribute('aria-describedby')
	expect(describedBy)
		.toBeTruthy()
	expect(await page.evaluate(id => document.getElementById(id)?.textContent ?? '', describedBy!))
		.toContain('Arrow keys move between the dependencies, Enter or Space shows the details, Escape clears the selection.')
	const firstId = await initialStop.getAttribute('data-id')

	// The edges come before the cards in the document, so Shift+Tab from the first card lands on the edges' Tab stop.
	await page.locator('.vue-flow__node')
		.first()
		.focus()
	await page.keyboard.press('Shift+Tab')
	expect(await focusedEdgeId(page))
		.toBe(firstId)
	// Focus shows the label a hover shows and the focus band, which is 7 screen px wide at any zoom.
	const focused = page.locator('.vue-flow__edge:focus')
	await expect(focused.locator('.graph-edge-focus-ring'))
		.toHaveCSS('opacity', '1')
	await expect(focused.locator('.graph-edge-focus-ring'))
		.toHaveCSS('stroke-width', '7px')
	await expect(focused.locator('.graph-edge-focus-ring'))
		.toHaveCSS('vector-effect', 'non-scaling-stroke')
	await expect(focused.locator('.vue-flow__edge-text'))
		.toHaveCSS('opacity', '1')

	// The arrow keys walk the edges, and the Tab stop goes with them: still exactly one.
	await page.keyboard.press('ArrowDown')
	const secondId = await focusedEdgeId(page)
	expect(secondId)
		.not.toBeNull()
	expect(secondId)
		.not.toBe(firstId)
	expect(await edgeTabStops(page))
		.toEqual([secondId])
	await page.keyboard.press('ArrowDown')
	const thirdId = await focusedEdgeId(page)
	expect([firstId, secondId])
		.not.toContain(thirdId)
	expect(await edgeTabStops(page))
		.toEqual([thirdId])

	// From an edge in the middle, Shift+Tab leaves the group (it does not jump to another edge), and Tab comes back to the
	// edge that was left.
	await page.keyboard.press('Shift+Tab')
	expect(await focusedEdgeId(page))
		.toBeNull()
	await page.keyboard.press('Tab')
	expect(await focusedEdgeId(page))
		.toBe(thirdId)
	// Tab leaves the group forwards, and Shift+Tab comes back to the same edge.
	await page.keyboard.press('Tab')
	expect(await focusedEdgeId(page))
		.toBeNull()
	await page.keyboard.press('Shift+Tab')
	expect(await focusedEdgeId(page))
		.toBe(thirdId)

	// Up goes back, Home goes to the first edge of the order.
	await page.keyboard.press('ArrowUp')
	expect(await focusedEdgeId(page))
		.toBe(secondId)
	await page.keyboard.press('Home')
	expect(await focusedEdgeId(page))
		.toBe(firstId)
	expect(await edgeTabStops(page))
		.toEqual([firstId])

	// Enter selects like a click: the edge is selected and its details open under the canvas.
	const details = page.locator('[data-graph-edge-details]')
	await expect(details)
		.toHaveCount(0)
	await page.keyboard.press('Enter')
	await expect(focused)
		.toHaveClass(/\bselected\b/)
	await expect(details)
		.toBeVisible()
	await expect(details)
		.toContainText('target:')

	// Escape clears the selection and the details; focus stays on the edge.
	await page.keyboard.press('Escape')
	await expect(page.locator('.vue-flow__edge.selected'))
		.toHaveCount(0)
	await expect(details)
		.toHaveCount(0)
	expect(await focusedEdgeId(page))
		.toBe(firstId)

	// Space selects as well.
	await page.keyboard.press('Space')
	await expect(focused)
		.toHaveClass(/\bselected\b/)
	await expect(details)
		.toBeVisible()
})

test('with a widget selected, the edges\' Tab stop is one of its own edges, and zh-TW names the edge', async ({ page }) => {
	await openGraph(page, 'survey')
	// #mode is related to some widgets and not to others, so the edges it is not part of are dimmed (the first widget in the
	// document, #open-day, has an edge to every other widget and dims none).
	await page.locator('.graph-cluster-identity--collapsed')
		.filter({ hasText: /#mode(?![\w-])/ })
		.click()
	await expect(page.locator('.graph-edge--dimmed')
		.first())
		.toBeVisible()
	const tabStop = page.locator('.vue-flow__edge[tabindex="0"]')
	await expect(tabStop)
		.toHaveCount(1)
	await expect(tabStop)
		.toHaveClass(/graph-edge--(depends-on|used-by)/)
	// Told from the selected widget: it depends on the other end, or is used by it.
	await expect(tabStop)
		.toHaveAttribute('aria-label', /^#\S+ (depends on|is used by) #\S+ \(\d+ deps?\)$/)

	await setLocale(page, 'zh-TW')
	await expect(tabStop)
		.toHaveAttribute('aria-label', /^#\S+ (依賴於 #\S+|被 #\S+ 使用)（\d+ 個依賴）$/)
	await expect(tabStop)
		.toHaveAttribute('aria-roledescription', '依賴')
	const describedBy = await tabStop.getAttribute('aria-describedby')
	expect(await page.evaluate(id => document.getElementById(id)?.textContent ?? '', describedBy!))
		.toContain('用方向鍵在各個依賴之間移動')
})

/**
 * The Graph is a readonly inspector. Vue Flow's default `deleteKeyCode` removes the selected cards and edges on Backspace
 * (a listener on the document), so the canvas turns it off; Delete is checked as well.
 */
test('Backspace and Delete remove nothing from the Graph, with an edge or a card selected', async ({ page }) => {
	await openGraph(page, 'survey')
	const cardCount = await page.locator('.vue-flow__node')
		.count()
	const edgeCount = await page.locator('.vue-flow__edge')
		.count()
	const settle = (): Promise<unknown> => page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))))
	const expectNothingRemoved = async (): Promise<void> => {
		for (const key of ['Backspace', 'Delete']) {
			await page.keyboard.press(key)
			await settle()
			await expect(page.locator('.vue-flow__node'), `cards after ${key}`)
				.toHaveCount(cardCount)
			await expect(page.locator('.vue-flow__edge'), `edges after ${key}`)
				.toHaveCount(edgeCount)
		}
	}

	// An edge, selected with the keyboard.
	await page.locator('.vue-flow__edge[tabindex="0"]')
		.focus()
	await page.keyboard.press('Enter')
	await expect(page.locator('.vue-flow__edge.selected'))
		.toHaveCount(1)
	await expectNothingRemoved()

	// A card, selected with the keyboard (Vue Flow selects a focused node on Enter).
	const card = page.locator('.vue-flow__node')
		.first()
	await card.focus()
	await page.keyboard.press('Enter')
	await expect(card)
		.toHaveClass(/\bselected\b/)
	await expectNothingRemoved()
})

/**
 * A tag beside its edge is really drawn somewhere: a line from the edge and a dot on it. The Trip budget's widgets have many
 * edges each, so at the default Fit some tag has no room on its own edge. Measured with the real ELK at 1440 x 900 (Fit at 0.386,
 * the Trip budget's font bucket of 32): the focused #settlement, #dev, #ana, #currency and #dinner each have one tag with a
 * leader, #hotel has none. #dev is the one named here.
 */
test('focusing #dev in the Trip budget puts a tag beside its edge, joined to it by a leader line with a dot', async ({ page }) => {
	await page.setViewportSize({ width: 1440, height: 900 })
	await openGraph(page, 'trip-budget')
	await page.locator('.graph-cluster-identity--collapsed')
		.filter({ hasText: /#dev(?![\w-])/ })
		.click()
	await expect(page.locator('.graph-node--focused'))
		.toContainText('#dev')
	const leaders = page.locator('.graph-tag-layer .graph-tag--leader')
	await expect(leaders)
		.not
		.toHaveCount(0)
	const leader = leaders.first()
	await expect(leader.locator('line.graph-tag-leader'))
		.toHaveCount(1)
	await expect(leader.locator('circle.graph-tag-leader-dot'))
		.toHaveCount(1)
	// The leader belongs to a tag of one of the edges that is drawn.
	const edgeId = await leader.getAttribute('data-edge-id')
	expect(edgeId)
		.toBeTruthy()
	const edgeIds = await page.locator('.vue-flow__edge')
		.evaluateAll(elements => elements.map(element => element.getAttribute('data-id')))
	expect(edgeIds)
		.toContain(edgeId)
})
