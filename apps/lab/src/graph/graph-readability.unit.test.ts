/**
 * Issue #230 "the Graph is hard to read": measurable properties of the Graph the owner asked for, on the two real
 * showcases (the default Survey and the Trip budget splitter) with the real ELK layout (`elkjs`'s bundled build runs in Node;
 * the Worker only moves the same code to another thread) and the real `toElkGraph()` -> `fromElkResult()` -> `toVueFlow()`
 * pipeline. Nothing about the layout is mocked, so each assertion is about what the canvas draws:
 *
 * - the cards have clear room: none overlaps another and the gap between two is at least the configured spacing;
 * - every edge is drawn as Bezier curves (`C` commands) through the corridor ELK reserved for it, starting on the card
 *   that declares the dependency and ending, with an arrowhead, on the card it depends on;
 * - no curve passes through a card that is not one of its two ends (an edge is never hidden behind a card);
 * - a fitted graph is still readable: the Fit zoom does not fall below what the collapsed views had.
 */

import type { InspectionNodeId } from '@deviltea/widget-core/inspection'
import type { GraphPoint } from './edge-geometry'
import type { RelationsWidgetGroup } from './relations'
import type { SemanticGraph } from './types'
import type { GraphFlowEdge, GraphFlowNode } from './vue-flow'
import { inspectBlueprint } from '@deviltea/widget-core/inspection'
import ELK from 'elkjs/lib/elk.bundled.js'
import { describe, expect, it, vi } from 'vitest'
import { useGraphTags } from '../composables/use-graph-tags'
import { defaultSurveyPreset } from '../showcases/survey/presets'
import { surveySystem } from '../showcases/survey/system'
import { defaultTripBudgetPreset } from '../showcases/trip-budget/presets'
import { tripBudgetSystem } from '../showcases/trip-budget/system'
import { routePointAtDistance, sampleRoute } from './edge-geometry'
import { fromElkResult, toElkGraph } from './elk-adapter'
import { projectSemanticGraph } from './projection'
import { projectRelations } from './relations'
import { toVueFlow } from './vue-flow'
import { ARROW_KINDS, ZOOM_BUCKETS } from './zoom-scale'

const elk = new ELK()

const SHOWCASES = {
	'survey': () => surveySystem.createBlueprint(JSON.parse(defaultSurveyPreset.sourceText)),
	'trip-budget': () => tripBudgetSystem.createBlueprint(JSON.parse(defaultTripBudgetPreset.sourceText)),
} as const

type ShowcaseName = keyof typeof SHOWCASES

interface Card {
	readonly id: string
	readonly x: number
	readonly y: number
	readonly width: number
	readonly height: number
}

interface DrawnGraph {
	readonly graph: SemanticGraph
	readonly nodes: GraphFlowNode[]
	readonly edges: GraphFlowEdge[]
	/** What a person sees as a card: a collapsed widget, a member or a stub. An expanded widget is only the shell around its cards. */
	readonly cards: Card[]
	/** What `toVueFlow()` needs to draw the same layout again with a focus. */
	readonly redraw: (focusWidgetId: string) => GraphFlowEdge[]
}

function sizeOf(node: GraphFlowNode): { width: number, height: number } {
	const style = node.style as { width: string, height: string }
	return { width: Number.parseFloat(style.width), height: Number.parseFloat(style.height) }
}

// A real ELK layout of the expanded Trip budget (112 members) takes a second or two, and several tests read the same drawing.
vi.setConfig({ testTimeout: 60_000 })

const drawings = new Map<string, Promise<DrawnGraph>>()

function draw(name: ShowcaseName, expanded: boolean): Promise<DrawnGraph> {
	const key = `${name}:${expanded}`
	if (!drawings.has(key))
		drawings.set(key, drawLayout(name, expanded))
	return drawings.get(key)!
}

async function drawLayout(name: ShowcaseName, expanded: boolean): Promise<DrawnGraph> {
	const blueprint = SHOWCASES[name]()
	const graph = projectSemanticGraph(inspectBlueprint(blueprint as never))
	const options = { expandedClusterIds: expanded ? new Set(graph.clusters.map(cluster => cluster.id)) : new Set<string>() }
	const result = await elk.layout(toElkGraph(graph, options))
	const { nodes, edges } = toVueFlow(graph, fromElkResult(result, graph, options), options)

	const byId = new Map(nodes.map(node => [node.id, node]))
	const cards: Card[] = []
	for (const node of nodes) {
		if (node.type === 'cluster' && node.data!.isExpanded === true)
			continue
		const parent = node.parentNode === undefined ? undefined : byId.get(node.parentNode)
		cards.push({
			id: node.id,
			x: node.position.x + (parent?.position.x ?? 0),
			y: node.position.y + (parent?.position.y ?? 0),
			...sizeOf(node),
		})
	}
	const rootNodeId = inspectBlueprint(blueprint as never).rootNodeId
	const layout = fromElkResult(result, graph, options)
	const redraw = (focusWidgetId: string): GraphFlowEdge[] => {
		const cluster = graph.clusters.find(candidate => candidate.widgetId === focusWidgetId)!
		return toVueFlow(graph, layout, { ...options, focused: { nodeId: cluster.nodeId }, rootNodeId }).edges
	}
	return { graph, nodes, edges, cards, redraw }
}

/** The smallest empty distance between any two cards: negative or zero when two overlap or touch. */
function smallestGap(cards: readonly Card[]): number {
	let smallest = Number.POSITIVE_INFINITY
	for (let first = 0; first < cards.length; first++) {
		for (let second = first + 1; second < cards.length; second++) {
			const a = cards[first]!
			const b = cards[second]!
			const gapX = Math.max(b.x - (a.x + a.width), a.x - (b.x + b.width))
			const gapY = Math.max(b.y - (a.y + a.height), a.y - (b.y + b.height))
			smallest = Math.min(smallest, Math.max(gapX, gapY))
		}
	}
	return smallest
}

function isInside(point: GraphPoint, card: Card, margin: number): boolean {
	return point.x > card.x + margin && point.x < card.x + card.width - margin && point.y > card.y + margin && point.y < card.y + card.height - margin
}

function isOnBorder(point: GraphPoint, card: Card, tolerance = 1.5): boolean {
	const withinX = point.x >= card.x - tolerance && point.x <= card.x + card.width + tolerance
	const withinY = point.y >= card.y - tolerance && point.y <= card.y + card.height + tolerance
	const onVertical = Math.abs(point.x - card.x) <= tolerance || Math.abs(point.x - (card.x + card.width)) <= tolerance
	const onHorizontal = Math.abs(point.y - card.y) <= tolerance || Math.abs(point.y - (card.y + card.height)) <= tolerance
	return withinX && withinY && (onVertical || onHorizontal)
}

/** The zoom `fitBounds` settles on for a canvas of this size: Vue Flow makes the content `1 + padding` times its own size (measured in the real Lab: 0.99 for the Survey at 1440 x 900 with the 0.04 Fit padding). */
function fitZoom(drawn: DrawnGraph, canvas: { width: number, height: number }, padding = 0.04): number {
	const points = [
		...drawn.cards.flatMap(card => [{ x: card.x, y: card.y }, { x: card.x + card.width, y: card.y + card.height }]),
		...drawn.edges.flatMap(edge => edge.data?.route ?? []),
	]
	const width = Math.max(...points.map(point => point.x)) - Math.min(...points.map(point => point.x))
	const height = Math.max(...points.map(point => point.y)) - Math.min(...points.map(point => point.y))
	return Math.min(canvas.width / (width * (1 + padding)), canvas.height / (height * (1 + padding)))
}

// Literal on purpose: they must not move together with the spacing constants they check. On main the smallest gap between two
// collapsed widgets was 21px (Survey) and between two members 20px.
const MIN_GAP_COLLAPSED = 64
const MIN_GAP_EXPANDED = 24

// The Graph canvas of a 1440 x 900 window, as measured in the browser: 691 x 681 after the toolbar and the key row.
const CANVAS_1440 = { width: 691, height: 681 }

describe.each(Object.keys(SHOWCASES) as ShowcaseName[])('%s Graph', (name) => {
	describe.each([false, true])('with expanded clusters = %s', (expanded) => {
		it('gives every card clear room: at least 64px between two widgets (21px on main), 24px between two members', async () => {
			const { cards } = await draw(name, expanded)
			expect(cards.length)
				.toBeGreaterThan(expanded ? 20 : 4)
			expect(smallestGap(cards))
				.toBeGreaterThanOrEqual((expanded ? MIN_GAP_EXPANDED : MIN_GAP_COLLAPSED) - 0.01)
		})

		it('draws every edge as Bezier curves from the card that declares it to the card it depends on', async () => {
			const { edges, cards } = await draw(name, expanded)
			const cardById = new Map(cards.map(card => [card.id, card]))
			expect(edges.length)
				.toBeGreaterThan(expanded ? 20 : 4)

			for (const edge of edges) {
				const route = edge.data?.route
				expect(route, `${edge.id} has an ELK route`)
					.toBeDefined()
				expect(route!.length)
					.toBeGreaterThanOrEqual(2)

				// The curve starts on the card that declares the dependency and ends, where the arrowhead is, on its target.
				expect(isOnBorder(route![0]!, cardById.get(edge.source)!), `${edge.id} starts on its source`)
					.toBe(true)
				expect(isOnBorder(route!.at(-1)!, cardById.get(edge.target)!), `${edge.id} ends on its target`)
					.toBe(true)
			}
		})

		it('puts an arrowhead of a known colour family on every edge, and none at the start', async () => {
			const { edges } = await draw(name, expanded)
			for (const edge of edges) {
				expect(ARROW_KINDS, edge.id)
					.toContain(edge.data?.arrow)
				expect(edge.markerStart, edge.id)
					.toBeUndefined()
			}
		})
	})

	// Edges never hidden behind cards, in every view: also the expanded Trip budget (112 members, 370 dependencies).
	describe.each([false, true])('with expanded clusters = %s', (expanded) => {
		it('passes no edge through a card that is not one of its two ends', async () => {
			const { edges, cards } = await draw(name, expanded)
			const hidden: string[] = []
			for (const edge of edges) {
				const samples = sampleRoute(edge.data!.route!, 24)
				for (const card of cards) {
					if (card.id === edge.source || card.id === edge.target)
						continue
					if (samples.some(point => isInside(point, card, 1)))
						hidden.push(`${edge.id} passes through ${card.id}`)
				}
			}
			expect(hidden)
				.toEqual([])
		})
	})
})

describe('focus tags', () => {
	// The tags of the edges around one widget, placed at the font size (and arrowhead length) of the zoom buckets the showcase's Fit
	// uses: the Survey fits at 0.95 (font 13) at 1440 x 900 and 0.84 (font 13) at 1280 x 800, the Trip budget at 0.37 (font 32).
	const cases = [
		{ showcase: 'survey', widget: 'mode', fonts: [11, 13, 16], atLeast: 3, both: true },
		{ showcase: 'survey', widget: 'guests', fonts: [11, 13, 16], atLeast: 3, both: true },
		{ showcase: 'survey', widget: 'sessions', fonts: [11, 13, 16], atLeast: 1, both: false },
		{ showcase: 'trip-budget', widget: 'hotel', fonts: [27, 32], atLeast: 3, both: true },
		{ showcase: 'trip-budget', widget: 'ana', fonts: [27, 32], atLeast: 3, both: false },
		{ showcase: 'trip-budget', widget: 'settlement', fonts: [27, 32], atLeast: 3, both: true },
		{ showcase: 'trip-budget', widget: 'currency', fonts: [27, 32], atLeast: 4, both: true },
	] as const

	interface Box { x: number, y: number, width: number, height: number }
	const overlaps = (a: Box, b: Box): boolean =>
		Math.min(a.x + a.width / 2, b.x + b.width / 2) - Math.max(a.x - a.width / 2, b.x - b.width / 2) > 0
		&& Math.min(a.y + a.height / 2, b.y + b.height / 2) - Math.max(a.y - a.height / 2, b.y - b.height / 2) > 0

	/** Points inside the arrowhead drawn at the end of a route (a triangle, `arrow` long and 0.8 as wide): measured on the triangle, not on the box the placement used. */
	function arrowheadPoints(route: readonly GraphPoint[], arrow: number): GraphPoint[] {
		const tip = route.at(-1)!
		const back = routePointAtDistance(route, arrow, 'end')
		const length = Math.hypot(tip.x - back.x, tip.y - back.y)
		const side = { x: -(tip.y - back.y) / length * arrow * 0.4, y: (tip.x - back.x) / length * arrow * 0.4 }
		const points: GraphPoint[] = []
		for (let along = 0; along <= 10; along++) {
			for (let across = -5; across <= 5; across++) {
				const t = along / 10
				// Inside the triangle: the width shrinks linearly from the base to the tip.
				const width = (1 - t) * (across / 5)
				points.push({ x: back.x + (tip.x - back.x) * t + side.x * width, y: back.y + (tip.y - back.y) * t + side.y * width })
			}
		}
		return points
	}

	for (const { showcase, widget, fonts, atLeast, both } of cases) {
		it.each(fonts)(`places the tags around #${widget} of the ${showcase} inside what Fit shows, on no card, no arrowhead and no other tag, nearer to #${widget} than to the other end (font %s)`, async (font) => {
			const drawn = await draw(showcase, false)
			const bucket = ZOOM_BUCKETS.find(candidate => candidate.font === font)!
			const tagged = drawn.redraw(widget)
				.filter(edge => edge.data?.relation !== undefined)
			expect(tagged.length)
				.toBeGreaterThan(3)
			const tags = tagged.map(edge => ({
				id: edge.id,
				route: edge.data!.route!,
				relation: edge.data!.relation!,
				text: `${edge.data!.relation === 'depends-on' ? 'Depends on' : 'Used by'} ${edge.data!.otherEnd}`,
			}))
			// The real path: the composable the canvas uses, at the lowest zoom of the bucket.
			const focusedEdges = drawn.redraw(widget)
			const placed = useGraphTags({
				edges: () => focusedEdges,
				cards: () => drawn.cards,
				zoom: () => bucket.min,
				text: (relation, name) => `${relation === 'depends-on' ? 'Depends on' : 'Used by'} ${name}`,
			}).value
			// Tags that do not fit are not drawn, but some do.
			expect(placed.size)
				.toBeGreaterThanOrEqual(atLeast)

			const meeting: string[] = []
			for (const [id, tag] of placed) {
				for (const card of drawn.cards) {
					if (overlaps(tag, { x: card.x + card.width / 2, y: card.y + card.height / 2, width: card.width, height: card.height }))
						meeting.push(`${id} on card ${card.id}`)
				}
				// No arrowhead of any edge, its own included, the dimmed ones too.
				for (const edge of focusedEdges.filter(candidate => candidate.data?.route !== undefined)
					.map(candidate => ({ id: candidate.id, route: candidate.data!.route! }))) {
					const hit = arrowheadPoints(edge.route, bucket.arrow)
						.some(point => Math.abs(point.x - tag.x) < tag.width / 2 && Math.abs(point.y - tag.y) < tag.height / 2)
					if (hit)
						meeting.push(`${id} on the arrowhead of ${edge.id}`)
				}
				for (const other of placed.values()) {
					if (other !== tag && overlaps(tag, other))
						meeting.push(`${id} on ${other.text}`)
				}
			}
			expect(meeting)
				.toEqual([])

			// Inside what Fit always shows (the cards and the curves): a tag is no part of what Fit fits, so one outside would be cut
			// off by the pane. Measured on a box of our own, not the one the placement used.
			const everything = [
				...drawn.cards.flatMap(card => [{ x: card.x, y: card.y }, { x: card.x + card.width, y: card.y + card.height }]),
				...focusedEdges.flatMap(edge => edge.data?.route ?? []),
			]
			const left = Math.min(...everything.map(point => point.x))
			const right = Math.max(...everything.map(point => point.x))
			const top = Math.min(...everything.map(point => point.y))
			const bottom = Math.max(...everything.map(point => point.y))
			for (const [id, tag] of placed) {
				expect(tag.x - tag.width / 2, `${id} left`)
					.toBeGreaterThanOrEqual(left - 0.01)
				expect(tag.x + tag.width / 2, `${id} right`)
					.toBeLessThanOrEqual(right + 0.01)
				expect(tag.y - tag.height / 2, `${id} top`)
					.toBeGreaterThanOrEqual(top - 0.01)
				expect(tag.y + tag.height / 2, `${id} bottom`)
					.toBeLessThanOrEqual(bottom + 0.01)
			}

			// On its edge, in the half nearer the focused card: measured along the curve, at the point of the curve nearest the tag.
			for (const input of tags.filter(candidate => placed.has(candidate.id))) {
				const tag = placed.get(input.id)!
				const samples = sampleRoute(input.route, 48)
				const along = [0]
				for (let index = 1; index < samples.length; index++)
					along.push(along[index - 1]! + Math.hypot(samples[index]!.x - samples[index - 1]!.x, samples[index]!.y - samples[index - 1]!.y))
				let nearest = 0
				for (let index = 1; index < samples.length; index++) {
					if (Math.hypot(samples[index]!.x - tag.x, samples[index]!.y - tag.y) < Math.hypot(samples[nearest]!.x - tag.x, samples[nearest]!.y - tag.y))
						nearest = index
				}
				const fromStart = along[nearest]! / along.at(-1)!
				expect(input.relation === 'depends-on' ? fromStart : 1 - fromStart, input.id)
					.toBeLessThanOrEqual(0.52)
			}

			// The two directions take turns: where both exist and any tag of the rarer one fits, it gets one. (Not every edge has room
			// inside what Fit shows: #sessions is at the top right of the Survey, #ana in the middle of a dense Trip budget.)
			const relations = new Set([...placed.values()].map(tag => tag.relation))
			if (both) {
				expect(relations.size, 'both directions are tagged')
					.toBe(new Set(tags.map(tag => tag.relation)).size)
			}
		})
	}
})

describe('fitted size', () => {
	it('keeps the collapsed Survey and Trip budget readable, and the expanded Survey about as large as it was', async () => {
		// The zoom counts the curves as well as the cards (a long edge runs in a corridor beside them). Measured in the browser at
		// 1440 x 900: collapsed Survey 0.99 (main: 1.16, with the cards 21px apart), collapsed Trip budget 0.39 (main: 0.39), expanded
		// Survey 0.27 (main: 0.30, counting the cards only). The Survey's text is 11px or more on screen only above about 0.9.
		expect(fitZoom(await draw('survey', false), CANVAS_1440))
			.toBeGreaterThan(0.97)
		expect(fitZoom(await draw('trip-budget', false), CANVAS_1440))
			.toBeGreaterThan(0.34)
		expect(fitZoom(await draw('survey', true), CANVAS_1440))
			.toBeGreaterThan(0.25)
	})
})

describe('direction', () => {
	it('draws a dependency from the member that declares it to the member it depends on, as the Relations view lists it', async () => {
		const { graph, edges, cards } = await draw('survey', true)
		const root = { nodeId: 0 as InspectionNodeId }

		// Survey `open-day`'s `response` Property reads `mode`'s `visible` Property (declared in the Survey's own plugin).
		const declared = graph.edges.find(edge => edge.sourceVertexId === '0:property:response' && edge.targetVertexId === '1:property:visible')
		expect(declared, 'the Survey declares response -> mode.visible')
			.toBeDefined()
		const drawn = edges.find(edge => edge.source === '0:property:response' && edge.target === '1:property:visible')!
		expect(drawn.source)
			.toBe('0:property:response')
		expect(drawn.target)
			.toBe('1:property:visible')

		// The curve leaves the card of `response` and its arrowhead (the end of the route) is on the card of `visible`.
		const response = cards.find(card => card.id === '0:property:response')!
		const visible = cards.find(card => card.id === '1:property:visible')!
		expect(isOnBorder(drawn.data!.route![0]!, response))
			.toBe(true)
		expect(isOnBorder(drawn.data!.route!.at(-1)!, visible))
			.toBe(true)

		// The Relations view says the same in its words: `mode.visible` is under "Depends on" for `response`, and `response` is
		// under "Used by" for `mode.visible`.
		const ofResponse = projectRelations(graph, { ...root, member: { type: 'property', name: 'response' } }, undefined)
		expect(ofResponse.mode)
			.toBe('member')
		const groupsOf = (model: ReturnType<typeof projectRelations>, side: 'dependsOn' | 'usedBy'): readonly RelationsWidgetGroup[] => model.mode === 'empty' ? [] : model[side]
		const dependsOn = groupsOf(ofResponse, 'dependsOn')
		expect(dependsOn.some(group => group.widgetId === 'mode' && group.rows.some(row => row.remoteMember?.name === 'visible')))
			.toBe(true)
		const ofVisible = projectRelations(graph, { nodeId: 1 as InspectionNodeId, member: { type: 'property', name: 'visible' } }, undefined)
		const usedBy = groupsOf(ofVisible, 'usedBy')
		expect(usedBy.some(group => group.widgetId === 'open-day' && group.rows.some(row => row.remoteMember?.name === 'response')))
			.toBe(true)
	})
})
