/**
 * Where the focus tags ("Depends on #sessions", "Used by #phone") of the edges around the focused widget or member sit.
 *
 * A tag belongs to the focused card, so it sits on its edge a short way from that card, never past the middle of the edge. But
 * the edges of one card attach next to each other (about 20px apart) and a tag is 100px or more wide, so tags placed at a fixed
 * distance land on top of each other, and a tag next to the card is where the arrowheads are. They are therefore placed
 * together: each takes the first spot along its edge, going away from the card, where its box meets no card, no arrowhead of any
 * edge around the focus (its own included) and no tag placed before it (the tag stays centred on its edge: a tag shifted aside
 * would not be read as that edge's). The two directions take turns, the rarer one first, so each gets a tag when any fits. A tag
 * with no such spot is not drawn: on a dense graph at a low zoom (the Trip budget's Expense has a dozen edges) text of 11 screen px
 * simply does not fit, and the accent colour, the dimming and the arrowheads still say which edges are the focus's, while the
 * Relations view lists them all. Pure geometry in canvas px, so the tests can measure the result on the real layouts.
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

/**
 * `obstacles` are boxes by their top-left corner (the cards); the result's boxes are by their centre (what an edge label is
 * positioned by).
 */
export function placeTags(tags: readonly TagInput[], obstacles: readonly TagRect[], scale: TagScale): Map<string, TagPlacement> {
	const fixed: TagRect[] = [
		...obstacles.map(rect => ({ x: rect.x + rect.width / 2, y: rect.y + rect.height / 2, width: rect.width, height: rect.height })),
		...tags.filter(tag => tag.route.length >= 2)
			.map(tag => arrowheadBox(tag.route, scale.arrow)),
	]
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
	return placed
}
