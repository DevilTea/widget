/**
 * Edge geometry of the Graph: how a dependency edge is drawn as a chain of cubic Bezier curves, and the
 * pure helpers that read that curve back (a label anchor and sample points for measurable layout checks).
 *
 * ELK decides where nodes go and which corridor a long edge uses to pass the layers in between (its route
 * points). The edge itself is never drawn as ELK's orthogonal or polyline route: every pair of consecutive
 * points becomes one cubic Bezier with vertical tangents at both ends, so an edge between two neighbouring
 * layers is a plain two-point Bezier (one `C` command) and a longer edge is the same curve repeated through
 * the free corridor ELK reserved for it, never behind a card. The layout runs top to bottom, so the tangents
 * are vertical; ELK's own route points are the only inputs, the component never has to guess handle positions.
 * Kept free of Vue and ELK so the quality checks in the unit tests can use exactly what the canvas draws.
 */

export interface GraphPoint {
	readonly x: number
	readonly y: number
}

/** The route points of one edge in flow (canvas) coordinates: the start on the source, then the corridor, then the end on the target. */
export type GraphEdgeRoute = readonly GraphPoint[]

/** How far each control point sits from its end point, as a fraction of the vertical distance of the segment. */
const CURVATURE = 0.5
/** A segment shorter than this is drawn straight: a curve with no room to bend only looks like a kink. */
const MIN_CURVE_SPAN = 1

function round(value: number): number {
	return Math.round(value * 100) / 100
}

interface CubicSegment {
	readonly from: GraphPoint
	readonly c1: GraphPoint
	readonly c2: GraphPoint
	readonly to: GraphPoint
}

/** The cubic Bezier segments of a route: one per pair of consecutive points, each with vertical tangents. */
export function routeSegments(route: GraphEdgeRoute): CubicSegment[] {
	const segments: CubicSegment[] = []
	for (let index = 0; index + 1 < route.length; index++) {
		const from = route[index]!
		const to = route[index + 1]!
		const offset = Math.abs(to.y - from.y) < MIN_CURVE_SPAN ? 0 : (to.y - from.y) * CURVATURE
		segments.push({
			from,
			c1: { x: from.x, y: from.y + offset },
			c2: { x: to.x, y: to.y - offset },
			to,
		})
	}
	return segments
}

/** The SVG path data of a route: `M x y` followed by one `C` (cubic Bezier) command per segment. Empty for fewer than two points. */
export function routePath(route: GraphEdgeRoute): string {
	const segments = routeSegments(route)
	if (segments.length === 0)
		return ''
	const first = segments[0]!.from
	const commands = segments.map(({ c1, c2, to }) => `C ${round(c1.x)} ${round(c1.y)} ${round(c2.x)} ${round(c2.y)} ${round(to.x)} ${round(to.y)}`)
	return `M ${round(first.x)} ${round(first.y)} ${commands.join(' ')}`
}

function cubicAt(segment: CubicSegment, t: number): GraphPoint {
	const u = 1 - t
	const a = u * u * u
	const b = 3 * u * u * t
	const c = 3 * u * t * t
	const d = t * t * t
	return {
		x: a * segment.from.x + b * segment.c1.x + c * segment.c2.x + d * segment.to.x,
		y: a * segment.from.y + b * segment.c1.y + c * segment.c2.y + d * segment.to.y,
	}
}

/** Points along the drawn curve (the end points included), `perSegment` samples for each cubic. */
export function sampleRoute(route: GraphEdgeRoute, perSegment = 16): GraphPoint[] {
	const points: GraphPoint[] = []
	const segments = routeSegments(route)
	segments.forEach((segment, index) => {
		for (let step = index === 0 ? 0 : 1; step <= perSegment; step++)
			points.push(cubicAt(segment, step / perSegment))
	})
	return points
}

/**
 * Where an edge's label sits: the point of the curve at `fraction` of its height (0 at its highest point, 1 at its lowest;
 * the middle by default), so the label stays on the edge and off the cards at both ends. Two labels that would meet at the
 * middle (the edges of one pair of cards that run in opposite directions) can be given different fractions.
 */
export function routeLabelPoint(route: GraphEdgeRoute, fraction = 0.5): GraphPoint {
	const samples = sampleRoute(route, 24)
	if (samples.length === 0)
		return route[0] ?? { x: 0, y: 0 }
	const top = Math.min(...samples.map(point => point.y))
	const bottom = Math.max(...samples.map(point => point.y))
	const wanted = top + (bottom - top) * fraction
	return samples.reduce((best, point) => Math.abs(point.y - wanted) < Math.abs(best.y - wanted) ? point : best)
}

/**
 * The route of an edge that ELK gave no points for (a layout function without routing, a test fake): a plain
 * two-point Bezier between the two handle positions.
 */
export function straightRoute(source: GraphPoint, target: GraphPoint): GraphEdgeRoute {
	return [source, target]
}
