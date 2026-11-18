/**
 * Where the focus tags ("Depends on #sessions", "Used by #phone") of the edges around the focused widget or member sit.
 *
 * A tag belongs to the focused card, so it sits on its edge a short way from that card, never past the middle of the edge. But
 * the edges of one card attach next to each other (about 20px apart) and a tag is 100px or more wide, so tags placed at a fixed
 * distance land on top of each other. They are therefore placed together: edge by edge, left to right along the focused card,
 * each takes the first spot along its edge, going away from the card, where its box meets neither a card nor a tag placed
 * before it (the tag stays centred on its edge: a tag shifted aside would not be read as that edge's). A tag with no such spot is not drawn: on a dense graph at a low zoom (the Trip budget's Expense has a dozen
 * edges) text of 11 screen px simply does not fit, and the accent colour, the dimming and the arrowheads still say which edges
 * are the focus's, while the Relations view lists them all. Pure geometry in canvas px, so the tests can measure the result on the
 * real layouts.
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
}

/** Widths and heights of a tag box as multiples of its font size: a bold mono glyph is about 0.66em wide; the box adds padding. */
const GLYPH_WIDTH = 0.66
const BOX_PADDING_X = 0.5
const BOX_HEIGHT = 1.75

/** Share of the edge, from the focused card, a tag may be at: never past the middle, so it is nearer to the focus than to the other end. */
const FRACTIONS = [0.08, 0.12, 0.16, 0.2, 0.24, 0.28, 0.32, 0.36, 0.4, 0.44, 0.5]

export function tagSize(text: string, font: number): { width: number, height: number } {
	return { width: text.length * GLYPH_WIDTH * font + 2 * BOX_PADDING_X * font, height: BOX_HEIGHT * font }
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
export function placeTags(tags: readonly TagInput[], obstacles: readonly TagRect[], font: number): Map<string, TagPlacement> {
	const asCentred = obstacles.map(rect => ({ x: rect.x + rect.width / 2, y: rect.y + rect.height / 2, width: rect.width, height: rect.height }))
	const focusEnd = (tag: TagInput): GraphPoint => (tag.relation === 'depends-on' ? tag.route[0]! : tag.route.at(-1)!)
	const ordered = [...tags].filter(tag => tag.route.length >= 2)
		.sort((a, b) => focusEnd(a).x - focusEnd(b).x || a.id.localeCompare(b.id))

	const placed = new Map<string, TagPlacement>()
	const placedRects: TagRect[] = []
	for (const tag of ordered) {
		const size = tagSize(tag.text, font)
		const length = routeLength(tag.route)
		let best: { rect: TagRect, cost: number } | undefined
		for (const fraction of FRACTIONS) {
			const point = routePointAtDistance(tag.route, fraction * length, tag.relation === 'depends-on' ? 'start' : 'end')
			const rect: TagRect = { x: point.x, y: point.y, ...size }
			const cost = [...asCentred, ...placedRects].reduce((sum, other) => sum + overlapArea(rect, other), 0)
			if (best === undefined || cost < best.cost)
				best = { rect, cost }
			if (cost === 0)
				break
		}
		if (best === undefined || best.cost > 0)
			continue
		placed.set(tag.id, { ...best.rect, text: tag.text })
		placedRects.push(best.rect)
	}
	return placed
}
