/**
 * The focus tags on hand-made geometry (the real layouts are measured in `graph-readability.unit.test.ts`): a tag sits on its
 * own edge when it can, and beside it with a short leader line when it cannot (issue #230 follow-up), never over a card, an
 * arrowhead or another tag, and never outside the content bounds.
 */

import type { GraphEdgeRoute, GraphPoint } from './edge-geometry'
import type { TagInput, TagPlacement, TagRect } from './tag-placement'
import { describe, expect, it } from 'vitest'
import { arrowheadBox, LEADER_LENGTHS, placeTags, tagSize } from './tag-placement'

const SCALE = { font: 10, arrow: 12 }
const TEXT = 'Depends on #b'
// 13 glyphs of 6.6px and 5px of padding on each side; 1.75 lines high.
const SIZE = { width: 95.8, height: 17.5 }

/** An edge that runs straight down from `(x, 0)`: its curve is the vertical line itself. */
function down(x: number, length: number): GraphEdgeRoute {
	return [{ x, y: 0 }, { x, y: length }]
}

function tag(id: string, route: GraphEdgeRoute, relation: TagInput['relation'] = 'depends-on'): TagInput {
	return { id, route, relation, text: TEXT }
}

/** Boxes by their centre. */
function overlap(a: TagRect, b: TagRect): boolean {
	return Math.min(a.x + a.width / 2, b.x + b.width / 2) - Math.max(a.x - a.width / 2, b.x - b.width / 2) > 0.001
		&& Math.min(a.y + a.height / 2, b.y + b.height / 2) - Math.max(a.y - a.height / 2, b.y - b.height / 2) > 0.001
}

function centred(card: TagRect): TagRect {
	return { x: card.x + card.width / 2, y: card.y + card.height / 2, width: card.width, height: card.height }
}

function strictlyInside(point: GraphPoint, box: TagRect): boolean {
	return Math.abs(point.x - box.x) < box.width / 2 - 0.001 && Math.abs(point.y - box.y) < box.height / 2 - 0.001
}

function leaderPoints(placement: TagPlacement): GraphPoint[] {
	const { from, to } = placement.leader!
	return Array.from({ length: 21 }, (_, index) => ({ x: from.x + (to.x - from.x) * index / 20, y: from.y + (to.y - from.y) * index / 20 }))
}

describe('tagSize', () => {
	it('sizes the box from the text length and the font', () => {
		const size = tagSize(TEXT, SCALE.font)
		expect(size.width)
			.toBeCloseTo(SIZE.width, 6)
		expect(size.height)
			.toBeCloseTo(SIZE.height, 6)
	})
})

describe('a tag with room on its edge', () => {
	it('sits on the edge, near the focused card, without a leader', () => {
		const placed = placeTags([tag('a', down(0, 400))], [], SCALE)
		const a = placed.get('a')!
		expect(a.leader)
			.toBeUndefined()
		expect(a.x)
			.toBeCloseTo(0, 6)
		// The first spot: 8% of the edge from the card the edge leaves.
		expect(a.y)
			.toBeCloseTo(32, 4)
	})

	it('is measured from the end of the edge when the edge arrives at the focus', () => {
		const placed = placeTags([tag('a', down(0, 400), 'used-by')], [], SCALE)
		const a = placed.get('a')!
		expect(a.leader)
			.toBeUndefined()
		// 8% from the end: the box reaches 376.75, short of the arrowhead (the last 12px of the edge).
		expect(a.y)
			.toBeCloseTo(368, 4)
	})
})

describe('a tag with no room on its edge', () => {
	// A card 10px to the right of the edge, as long as the edge: every box centred on the edge (48px to each side) would cover it.
	const card: TagRect = { x: 10, y: 0, width: 30, height: 400 }

	it('is set beside the edge, on the free side, with a short leader from the edge to its box', () => {
		const placed = placeTags([tag('a', down(0, 400))], [card], SCALE)
		const a = placed.get('a')!
		expect(a.leader)
			.toBeDefined()
		// The leader starts on the edge at the first spot (8% along) and runs across the edge, away from the card.
		expect(a.leader!.from.x)
			.toBeCloseTo(0, 6)
		expect(a.leader!.from.y)
			.toBeCloseTo(32, 4)
		expect(a.leader!.to.x)
			.toBeCloseTo(-LEADER_LENGTHS[0]! * SCALE.font, 6)
		expect(a.leader!.to.y)
			.toBeCloseTo(32, 4)
		// The box begins where the leader ends: its right side is at the leader's end, its middle at the leader's height.
		expect(a.x + a.width / 2)
			.toBeCloseTo(a.leader!.to.x, 6)
		expect(a.y)
			.toBeCloseTo(32, 4)
		expect(a.width)
			.toBeCloseTo(SIZE.width, 6)
		expect(overlap(a, centred(card)))
			.toBe(false)
	})

	it('goes to the other side when the card is on the left', () => {
		const left: TagRect = { x: -40, y: 0, width: 30, height: 400 }
		const a = placeTags([tag('a', down(0, 400))], [left], SCALE)
			.get('a')!
		expect(a.leader!.to.x)
			.toBeCloseTo(LEADER_LENGTHS[0]! * SCALE.font, 6)
		expect(a.x - a.width / 2)
			.toBeCloseTo(a.leader!.to.x, 6)
	})

	it('is not drawn when the free side is outside the content bounds and the leader would cross the card on the other', () => {
		// To the left the box needs 110.8px (15 of leader and 95.8 of box); the content ends at 100. To the right the nearest box
		// clear of the card starts where the card ends, and its leader would run across the card.
		const bounds: TagRect = { x: -100, y: 0, width: 300, height: 400 }
		const placed = placeTags([tag('a', down(0, 400))], [card], SCALE, { bounds })
		expect(placed.size)
			.toBe(0)
	})

	it('is drawn on the free side once the content bounds leave room there', () => {
		const bounds: TagRect = { x: -111, y: 0, width: 311, height: 400 }
		const a = placeTags([tag('a', down(0, 400))], [card], SCALE, { bounds })
			.get('a')!
		expect(a.leader)
			.toBeDefined()
		expect(a.x - a.width / 2)
			.toBeGreaterThanOrEqual(bounds.x)
	})

	it('runs its leader up or down from an edge that runs across', () => {
		// A level edge from left to right (drawn as the straight line itself) with a card along its whole length 2px below it: a
		// box centred on the edge (8.75px to each side) covers the card, and so does a box below the edge.
		const across: GraphEdgeRoute = [{ x: 0, y: 0 }, { x: 600, y: 0 }]
		const below: TagRect = { x: 0, y: 2, width: 600, height: 20 }
		const a = placeTags([tag('a', across)], [below], SCALE)
			.get('a')
		expect(a, 'the tag is drawn')
			.toBeDefined()
		expect(a!.leader, 'beside its edge')
			.toBeDefined()
		// The leader starts on the edge at the first spot (8% of 600) and runs straight up, away from the card.
		expect(a!.leader!.from.x)
			.toBeCloseTo(48, 4)
		expect(a!.leader!.from.y)
			.toBeCloseTo(0, 6)
		expect(a!.leader!.to.x)
			.toBeCloseTo(48, 4)
		expect(a!.leader!.to.y)
			.toBeCloseTo(-LEADER_LENGTHS[0]! * SCALE.font, 6)
		// The box sits on the leader's end: its bottom side there, its middle above the anchor.
		expect(a!.y + a!.height / 2)
			.toBeCloseTo(a!.leader!.to.y, 6)
		expect(a!.x)
			.toBeCloseTo(48, 4)
		expect(overlap(a!, centred(below)))
			.toBe(false)
		expect(overlap(a!, arrowheadBox(across, SCALE.arrow)))
			.toBe(false)
		for (const point of leaderPoints(a!)) {
			expect(strictlyInside(point, centred(below)))
				.toBe(false)
		}
	})

	it('is not set on the curve of another edge around the focus', () => {
		// The same card on the right of edge "a", and a second edge "b" 60px to its left, as long as "a". "b" has room on itself.
		// Every box to the left of "a" (15 to 136px from it) would cover the line of "b"; from 16% of the edge on, such a box
		// would be clear of the tag of "b", so only the curve keeps it away.
		const tags = [tag('a', down(0, 400)), tag('b', down(-60, 400))]
		const placed = placeTags(tags, [card], SCALE)
		expect(placed.get('b')?.leader, '"b" sits on its own edge')
			.toBeUndefined()
		expect(placed.get('b')?.x)
			.toBeCloseTo(-60, 6)
		expect(placed.has('a'), '"a" is not drawn over the line of "b"')
			.toBe(false)
		// Without "b" the same tag is drawn to the left (the test above), so it is the curve that decides here.
		expect(placeTags([tags[0]!], [card], SCALE)
			.get('a')
			?.leader)
			.toBeDefined()
	})
})

describe('a fan of edges that leave one card side by side', () => {
	// Eight edges 12px apart and 120px long: a box is 96px wide and 17.5px high and may sit between 8% and 50% of its edge, so
	// only three of them have room on their own edge. The others are set beside theirs.
	const routes = Array.from({ length: 8 }, (_, index) => down(index * 12, 120))
	const tags = routes.map((route, index) => tag(`e${index}`, route))
	const placed = placeTags(tags, [], SCALE)
	const all = [...placed.entries()]

	it('keeps the tags that fit on their edges and adds tags with leaders', () => {
		const onEdge = all.filter(([, placement]) => placement.leader === undefined)
		const beside = all.filter(([, placement]) => placement.leader !== undefined)
		expect(onEdge.length)
			.toBeGreaterThanOrEqual(3)
		expect(beside.length)
			.toBeGreaterThanOrEqual(1)
		// A tag on its edge is centred on it.
		for (const [id, placement] of onEdge) {
			expect(placement.x, id)
				.toBeCloseTo(tags.find(candidate => candidate.id === id)!.route[0]!.x, 6)
		}
	})

	it('puts no tag on another tag or on an arrowhead', () => {
		const meeting: string[] = []
		for (const [id, placement] of all) {
			for (const [otherId, other] of all) {
				if (id < otherId && overlap(placement, other))
					meeting.push(`${id} on ${otherId}`)
			}
			for (const route of routes) {
				if (overlap(placement, arrowheadBox(route, SCALE.arrow)))
					meeting.push(`${id} on an arrowhead`)
			}
		}
		expect(meeting)
			.toEqual([])
	})

	it('starts every leader on its own edge, in the half nearer the card, keeps it short, and ends it on the side of its box', () => {
		for (const [id, placement] of all.filter(([, candidate]) => candidate.leader !== undefined)) {
			const route = tags.find(candidate => candidate.id === id)!.route
			const { from, to } = placement.leader!
			expect(from.x, `${id} starts on its edge`)
				.toBeCloseTo(route[0]!.x, 6)
			expect(from.y, `${id} starts in the nearer half`)
				.toBeLessThanOrEqual(60.001)
			expect(from.y, `${id} starts off the card`)
				.toBeGreaterThan(0)
			const length = Math.hypot(to.x - from.x, to.y - from.y)
			expect(length, `${id} leader length`)
				.toBeLessThanOrEqual(LEADER_LENGTHS.at(-1)! * SCALE.font + 0.001)
			expect(length, `${id} leader length`)
				.toBeGreaterThanOrEqual(LEADER_LENGTHS[0]! * SCALE.font - 0.001)
			// The edges run down, so the leader runs across and ends in the middle of the box's near side.
			expect(to.y, id)
				.toBeCloseTo(from.y, 6)
			expect(Math.abs(to.x - placement.x), id)
				.toBeCloseTo(placement.width / 2, 6)
			expect(placement.y, id)
				.toBeCloseTo(from.y, 6)
		}
	})

	it('runs no leader through another tag', () => {
		const crossing: string[] = []
		for (const [id, placement] of all.filter(([, candidate]) => candidate.leader !== undefined)) {
			for (const [otherId, other] of all) {
				if (otherId !== id && leaderPoints(placement)
					.some(point => strictlyInside(point, other))) {
					crossing.push(`${id} leader through ${otherId}`)
				}
			}
		}
		expect(crossing)
			.toEqual([])
	})

	it('sets no tag beside its edge on the curve of another edge, and crosses no leader with another', () => {
		const beside = all.filter(([, candidate]) => candidate.leader !== undefined)
		const onCurve: string[] = []
		for (const [id, placement] of beside) {
			for (const route of routes) {
				// The edges are vertical lines: one is under the box when its x is inside the box and the box is level with it.
				const x = route[0]!.x
				if (Math.abs(x - placement.x) < placement.width / 2 - 0.001 && placement.y + placement.height / 2 > 0 && placement.y - placement.height / 2 < 120)
					onCurve.push(`${id} on the edge at x=${x}`)
			}
		}
		expect(onCurve)
			.toEqual([])

		const crossing: string[] = []
		for (const [id, placement] of beside) {
			for (const [otherId, other] of beside) {
				if (id >= otherId)
					continue
				// Both leaders are level lines here: they meet when they are at the same height and their spans overlap.
				const [a0, a1] = [placement.leader!.from.x, placement.leader!.to.x].sort((first, second) => first - second) as [number, number]
				const [b0, b1] = [other.leader!.from.x, other.leader!.to.x].sort((first, second) => first - second) as [number, number]
				if (Math.abs(placement.leader!.from.y - other.leader!.from.y) < 1 && Math.min(a1, b1) - Math.max(a0, b0) > 0.001)
					crossing.push(`${id} and ${otherId}`)
			}
		}
		expect(crossing)
			.toEqual([])
	})

	it('places the same tags the same way every time', () => {
		expect([...placeTags(tags, [], SCALE)
			.entries()])
			.toEqual(all)
	})
})
