/**
 * Where the focus tags ("Depends on #sessions", "Used by #phone") of the edges around the focused widget or member sit.
 *
 * A tag belongs to the focused card, so it sits on its edge a short way from that card, never past the middle of the edge. But
 * the edges of one card attach next to each other (about 20px apart) and a tag is 100px or more wide, so tags placed at a fixed
 * distance land on top of each other, and a tag next to the card is where the arrowheads are. They are therefore placed
 * together: each takes the first spot along its edge, going away from the card, where its box lies inside the content (the
 * cards and curves, which Fit always shows: a tag is not part of what Fit fits, so one outside it would be cut off by the pane),
 * meets no card, no arrowhead of an edge and no tag placed before it (the tag stays centred on its edge: a tag shifted aside
 * would not be read as that edge's). The two directions take turns, the rarer one first, so each gets a tag when any fits.
 *
 * A tag with no such spot on its edge gets a second chance beside it (issue #230 follow-up): its box is set a short way off the
 * edge, across the edge's direction (left or right of an edge that runs down, above or below one that runs across), and a
 * leader line joins the box to the point of the edge it is about (`leader`). The same rules hold for the box (inside the
 * content, on no card, no arrowhead and no other tag), the leader crosses no card, no arrowhead and no tag, and no later
 * tag is set on an earlier leader. Every tag is tried on its edge first, so a leader never takes a spot an on-edge tag could
 * have had. A tag with no spot either way is not drawn: on a dense graph at a low zoom (the Trip budget's Expense has a dozen
 * edges) text of 11 screen px simply does not fit, and the accent colour, the dimming and the arrowheads still say which edges
 * are the focus's, while the Relations view lists them all. Pure geometry in canvas px, so the tests can measure the result on
 * the real layouts.
 */

import type { GraphEdgeRoute, GraphPoint } from './edge-geometry'
import { routeLength, routePointAtDistance } from './edge-geometry'

export interface TagInput {
	readonly id: string
	readonly route: GraphEdgeRoute
	readonly relation: 'depends-on' | 'used-by'
	readonly text: string
}

export interface TagRect {
	readonly x: number
	readonly y: number
	readonly width: number
	readonly height: number
}

/** The box of a tag: its centre, and its size for text of `font` px in the Lab's monospace face. */
export interface TagPlacement extends TagRect {
	readonly text: string
	readonly relation: TagInput['relation']
	/**
	 * Set when the tag found no room on its edge and sits beside it: the line from the point of the edge the tag is about
	 * (`from`) to the middle of the side of the box that faces the edge (`to`).
	 */
	readonly leader?: { readonly from: GraphPoint, readonly to: GraphPoint }
}

/** What the placement needs of the zoom bucket: the text size, and the length of an arrowhead (both in canvas px). */
export interface TagScale {
	readonly font: number
	readonly arrow: number
}

/** Widths and heights of a tag box as multiples of its font size: a bold mono glyph is about 0.66em wide; the box adds padding. */
const GLYPH_WIDTH = 0.66
const BOX_PADDING_X = 0.5
const BOX_HEIGHT = 1.75

/** The arrowhead (`<marker>` in `GraphCanvas.vue`) is 0.8 as high as it is long: half of that is how far it reaches to each side. */
const ARROW_HALF_WIDTH = 0.4

/** Share of the edge, from the focused card, a tag may be at: never past the middle, so it is nearer to the focus than to the other end. */
const FRACTIONS = [0.08, 0.12, 0.16, 0.2, 0.24, 0.28, 0.32, 0.36, 0.4, 0.44, 0.5]

/** How far beside its edge a tag with a leader may sit, as multiples of the font size (nearest first): the leader stays short. */
export const LEADER_LENGTHS = [1.5, 2.5, 4]

/** The width of the band a leader line occupies, as a multiple of the font size (the line itself is thinner). */
const LEADER_BAND = 0.2

export function tagSize(text: string, font: number): { width: number, height: number } {
	return { width: text.length * GLYPH_WIDTH * font + 2 * BOX_PADDING_X * font, height: BOX_HEIGHT * font }
}

/** The box around the arrowhead at the end of a route (by its centre), for an arrowhead `arrow` canvas px long. */
export function arrowheadBox(route: GraphEdgeRoute, arrow: number): TagRect {
	const tip = route.at(-1)!
	const back = routePointAtDistance(route, arrow, 'end')
	const length = Math.hypot(tip.x - back.x, tip.y - back.y) || 1
	const side = { x: -(tip.y - back.y) / length * arrow * ARROW_HALF_WIDTH, y: (tip.x - back.x) / length * arrow * ARROW_HALF_WIDTH }
	const xs = [tip.x, back.x + side.x, back.x - side.x]
	const ys = [tip.y, back.y + side.y, back.y - side.y]
	const x0 = Math.min(...xs)
	const y0 = Math.min(...ys)
	return { x: (x0 + Math.max(...xs)) / 2, y: (y0 + Math.max(...ys)) / 2, width: Math.max(...xs) - x0, height: Math.max(...ys) - y0 }
}

function overlapArea(a: TagRect, b: TagRect): number {
	const width = Math.min(a.x + a.width / 2, b.x + b.width / 2) - Math.max(a.x - a.width / 2, b.x - b.width / 2)
	const height = Math.min(a.y + a.height / 2, b.y + b.height / 2) - Math.max(a.y - a.height / 2, b.y - b.height / 2)
	return width > 0 && height > 0 ? width * height : 0
}

export interface TagPlacementOptions {
	/** The box (by its top-left corner) every tag must lie inside: what Fit shows. */
	readonly bounds?: TagRect
	/** The routes of the other edges (the dimmed ones): their arrowheads are not covered either. */
	readonly otherRoutes?: readonly GraphEdgeRoute[]
}

/** The box (by its top-left corner) around cards and routes, which is what Fit fits; `undefined` when there is nothing. */
export function contentBounds(cards: readonly TagRect[], routes: readonly GraphEdgeRoute[]): TagRect | undefined {
	const xs = [...cards.flatMap(card => [card.x, card.x + card.width]), ...routes.flatMap(route => route.map(point => point.x))]
	const ys = [...cards.flatMap(card => [card.y, card.y + card.height]), ...routes.flatMap(route => route.map(point => point.y))]
	if (xs.length === 0)
		return undefined
	const x = Math.min(...xs)
	const y = Math.min(...ys)
	return { x, y, width: Math.max(...xs) - x, height: Math.max(...ys) - y }
}

/**
 * `obstacles` are boxes by their top-left corner (the cards); the result's boxes are by their centre (what an edge label is
 * positioned by).
 */
export function placeTags(tags: readonly TagInput[], obstacles: readonly TagRect[], scale: TagScale, options: TagPlacementOptions = {}): Map<string, TagPlacement> {
	const fixed: TagRect[] = [
		...obstacles.map(rect => ({ x: rect.x + rect.width / 2, y: rect.y + rect.height / 2, width: rect.width, height: rect.height })),
		...[...tags.map(tag => tag.route), ...(options.otherRoutes ?? [])].filter(route => route.length >= 2)
			.map(route => arrowheadBox(route, scale.arrow)),
	]
	const { bounds } = options
	const isInside = (rect: TagRect): boolean => bounds === undefined
		|| (rect.x - rect.width / 2 >= bounds.x && rect.x + rect.width / 2 <= bounds.x + bounds.width && rect.y - rect.height / 2 >= bounds.y && rect.y + rect.height / 2 <= bounds.y + bounds.height)
	const focusEnd = (tag: TagInput): GraphPoint => (tag.relation === 'depends-on' ? tag.route[0]! : tag.route.at(-1)!)
	const leftToRight = (relation: TagInput['relation']): TagInput[] => tags.filter(tag => tag.relation === relation && tag.route.length >= 2)
		.sort((a, b) => focusEnd(a).x - focusEnd(b).x || a.id.localeCompare(b.id))
	const leaving = leftToRight('depends-on')
	const arriving = leftToRight('used-by')
	// The two directions take turns, the rarer first (a tie starts with "Depends on"), each left to right.
	const [first, second] = leaving.length <= arriving.length ? [leaving, arriving] : [arriving, leaving]
	const ordered: TagInput[] = []
	for (let index = 0; index < Math.max(first.length, second.length); index++) {
		if (first[index])
			ordered.push(first[index]!)
		if (second[index])
			ordered.push(second[index]!)
	}

	const placed = new Map<string, TagPlacement>()
	const placedRects: TagRect[] = []
	for (const tag of ordered) {
		const size = tagSize(tag.text, scale.font)
		const length = routeLength(tag.route)
		let best: { rect: TagRect, cost: number } | undefined
		for (const fraction of FRACTIONS) {
			const point = routePointAtDistance(tag.route, fraction * length, tag.relation === 'depends-on' ? 'start' : 'end')
			const rect: TagRect = { x: point.x, y: point.y, ...size }
			if (!isInside(rect))
				continue
			const cost = [...fixed, ...placedRects].reduce((sum, other) => sum + overlapArea(rect, other), 0)
			if (best === undefined || cost < best.cost)
				best = { rect, cost }
			if (cost === 0)
				break
		}
		if (best === undefined || best.cost > 0)
			continue
		placed.set(tag.id, { ...best.rect, text: tag.text, relation: tag.relation })
		placedRects.push(best.rect)
	}

	// Second chance, after every tag had its try on its own edge: beside the edge, joined to it by a short leader line.
	const leaders: TagRect[] = []
	const meets = (rect: TagRect, others: readonly TagRect[]): boolean => others.some(other => overlapArea(rect, other) > 0)
	for (const tag of ordered) {
		if (placed.has(tag.id))
			continue
		const size = tagSize(tag.text, scale.font)
		const length = routeLength(tag.route)
		const from = tag.relation === 'depends-on' ? 'start' : 'end'
		const spot = (): TagPlacement | undefined => {
			for (const fraction of FRACTIONS) {
				const anchor = routePointAtDistance(tag.route, fraction * length, from)
				// The edge's direction at the anchor decides the side: across it, so the leader does not run along the edge.
				const ahead = routePointAtDistance(tag.route, Math.min(length, fraction * length + Math.max(1, length * 0.02)), from)
				const runsDown = Math.abs(ahead.y - anchor.y) >= Math.abs(ahead.x - anchor.x)
				for (const multiple of LEADER_LENGTHS) {
					const lead = multiple * scale.font
					for (const sign of [1, -1]) {
						const to: GraphPoint = runsDown ? { x: anchor.x + sign * lead, y: anchor.y } : { x: anchor.x, y: anchor.y + sign * lead }
						const rect: TagRect = runsDown
							? { x: to.x + sign * size.width / 2, y: anchor.y, ...size }
							: { x: anchor.x, y: to.y + sign * size.height / 2, ...size }
						if (!isInside(rect) || meets(rect, fixed) || meets(rect, placedRects) || meets(rect, leaders))
							continue
						const band = LEADER_BAND * scale.font
						const leader: TagRect = {
							x: (anchor.x + to.x) / 2,
							y: (anchor.y + to.y) / 2,
							width: Math.max(Math.abs(to.x - anchor.x), band),
							height: Math.max(Math.abs(to.y - anchor.y), band),
						}
						if (meets(leader, fixed) || meets(leader, placedRects))
							continue
						leaders.push(leader)
						return { ...rect, text: tag.text, relation: tag.relation, leader: { from: anchor, to } }
					}
				}
			}
			return undefined
		}
		const found = spot()
		if (found === undefined)
			continue
		placed.set(tag.id, found)
		placedRects.push({ x: found.x, y: found.y, width: found.width, height: found.height })
	}
	return placed
}
