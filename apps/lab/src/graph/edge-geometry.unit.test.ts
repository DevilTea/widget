/**
 * The curve of a Graph edge: a chain of cubic Beziers with vertical tangents through ELK's route points, so a two-point edge is
 * one `C` command and nothing is ever drawn as a straight or cornered segment.
 */

import { describe, expect, it } from 'vitest'
import { routeLabelPoint, routePath, routePointAtDistance, sampleRoute, straightRoute } from './edge-geometry'

describe('routePath', () => {
	it('draws two points as a single cubic Bezier whose tangents are vertical at both ends', () => {
		expect(routePath(straightRoute({ x: 0, y: 0 }, { x: 100, y: 80 })))
			.toBe('M 0 0 C 0 40 100 40 100 80')
	})

	it('draws a longer route as one cubic Bezier per pair of points, with no line or corner command', () => {
		const d = routePath([{ x: 0, y: 0 }, { x: 50, y: 100 }, { x: 50, y: 200 }, { x: 10, y: 300 }])
		expect(d.match(/ C /g))
			.toHaveLength(3)
		expect(d.startsWith('M 0 0 C'))
			.toBe(true)
		expect(d)
			.not
			.toMatch(/[LQSATHV]/)
	})

	it('leaves an edge that runs upward (against the layout direction) leaving the top of its source and entering the bottom of its target', () => {
		expect(routePath(straightRoute({ x: 0, y: 100 }, { x: 20, y: 0 })))
			.toBe('M 0 100 C 0 50 20 50 20 0')
	})

	it('is empty for fewer than two points', () => {
		expect(routePath([]))
			.toBe('')
		expect(routePath([{ x: 1, y: 1 }]))
			.toBe('')
	})
})

describe('sampleRoute and routeLabelPoint', () => {
	it('samples the drawn curve from its first to its last point', () => {
		const samples = sampleRoute(straightRoute({ x: 0, y: 0 }, { x: 100, y: 80 }), 8)
		expect(samples[0])
			.toEqual({ x: 0, y: 0 })
		expect(samples.at(-1))
			.toEqual({ x: 100, y: 80 })
		expect(samples)
			.toHaveLength(9)
		// A curve with vertical tangents is steeper than the straight line near both ends.
		expect(samples[1]!.x)
			.toBeLessThan(samples[1]!.y * (100 / 80))
	})

	it('puts the label on the middle of the curve, or at another fraction of its height', () => {
		const middle = routeLabelPoint(straightRoute({ x: 0, y: 0 }, { x: 100, y: 80 }))
		expect(middle.x)
			.toBeCloseTo(50)
		expect(middle.y)
			.toBeCloseTo(40)
		// An even number of segments: the point between the two middle ones.
		const between = routeLabelPoint([{ x: 0, y: 0 }, { x: 10, y: 50 }, { x: 10, y: 100 }])
		expect(between.x)
			.toBeCloseTo(10)
		expect(between.y)
			.toBeCloseTo(50)
		// Higher and lower than the middle: two tags can sit on one pair of cards without meeting.
		const route = straightRoute({ x: 0, y: 0 }, { x: 100, y: 80 })
		expect(routeLabelPoint(route, 0.35).y)
			.toBeLessThan(routeLabelPoint(route, 0.65).y - 15)
	})
})

describe('routePointAtDistance', () => {
	it('finds the point a given distance along the curve from its start or from its end', () => {
		const route = straightRoute({ x: 0, y: 0 }, { x: 0, y: 200 })
		expect(routePointAtDistance(route, 50, 'start').y)
			.toBeCloseTo(50, 0)
		expect(routePointAtDistance(route, 50, 'end').y)
			.toBeCloseTo(150, 0)
		// A tag sits the same distance from the focused card whatever the edge's length.
		const longer = straightRoute({ x: 0, y: 0 }, { x: 0, y: 600 })
		expect(routePointAtDistance(longer, 50, 'start').y)
			.toBeCloseTo(50, 0)
		expect(routePointAtDistance(longer, 50, 'end').y)
			.toBeCloseTo(550, 0)
	})

	it('measures along the curve, which is longer than the straight line between its ends', () => {
		const route = straightRoute({ x: 0, y: 0 }, { x: 200, y: 100 })
		const point = routePointAtDistance(route, 60, 'start')
		expect(Math.hypot(point.x, point.y))
			.toBeLessThan(60)
	})

	it('clamps to the curve', () => {
		const route = straightRoute({ x: 0, y: 0 }, { x: 0, y: 40 })
		expect(routePointAtDistance(route, 500, 'start'))
			.toEqual({ x: 0, y: 40 })
		expect(routePointAtDistance(route, 500, 'end'))
			.toEqual({ x: 0, y: 0 })
	})
})
