/**
 * Where the Graph's viewport goes after a layout: the whole layout, or (after an expansion whose whole layout would make member text
 * smaller than 11px on screen) the expanded widget at the readable zoom; and when the minimap is shown.
 */

import { describe, expect, it } from 'vitest'
import {
	bottomRightRect,
	clusterToFrame,
	fitMargin,
	fitZoom,
	frameBoxTop,
	isContentInView,
	isMinimapUseful,
	manualMinZoom,
	MEMBER_FONT_PX,
	MIN_SCREEN_TEXT_PX,
	MINIMAP_MAX_SIZE,
	MINIMAP_MIN_PANE,
	MINIMAP_MIN_SIZE,
	minimapSize,
	planExpandViewport,
	readableZoom,
	rectsOverlap,
	toScreenRect,
} from './viewport-plan'

const LIMITS = { min: 0.05, max: 2 }
const PADDING = 0.04

describe('readableZoom', () => {
	it('is the zoom at which a member card\'s text is 11px on screen', () => {
		expect(MEMBER_FONT_PX)
			.toBe(12)
		expect(readableZoom(LIMITS))
			.toBeCloseTo(11 / 12, 6)
		expect(readableZoom(LIMITS) * MEMBER_FONT_PX)
			.toBeCloseTo(MIN_SCREEN_TEXT_PX, 6)
	})

	it('follows the font size and stays inside the zoom limits', () => {
		expect(readableZoom(LIMITS, 22))
			.toBeCloseTo(0.5, 6)
		expect(readableZoom(LIMITS, 4))
			.toBe(2)
		expect(readableZoom({ min: 1, max: 2 }))
			.toBe(1)
	})
})

describe('fitZoom and fitMargin', () => {
	it('use Vue Flow\'s rule for a numeric padding: floor((length - length / (1 + padding)) / 2) on each side', () => {
		expect(fitMargin(739, PADDING))
			.toBe(14)
		expect(fitMargin(252, PADDING))
			.toBe(4)
		// 1440 - 2 * 27 = 1386 across, 739 - 2 * 14 = 711 down: the height decides.
		expect(fitZoom({ x: 0, y: 0, width: 1000, height: 1000 }, { width: 1440, height: 739 }, PADDING, LIMITS))
			.toBeCloseTo(0.711, 6)
	})

	it('is clamped to the zoom limits', () => {
		expect(fitZoom({ x: 0, y: 0, width: 10, height: 10 }, { width: 1000, height: 1000 }, PADDING, LIMITS))
			.toBe(2)
		expect(fitZoom({ x: 0, y: 0, width: 1e6, height: 1e6 }, { width: 1000, height: 1000 }, PADDING, LIMITS))
			.toBe(0.05)
	})
})

describe('manualMinZoom', () => {
	it('lets a person zoom out to a quarter of Fit, not below 0.1 unless Fit is lower, never below the Fit floor', () => {
		// The collapsed Survey fits at about 0.99: about 0.25.
		expect(manualMinZoom(0.99, LIMITS))
			.toBeCloseTo(0.2475, 6)
		// The Trip budget with #hotel expanded (0.196 in issue #230's pane): 0.1.
		expect(manualMinZoom(0.196, LIMITS))
			.toBe(0.1)
		expect(manualMinZoom(0.07, LIMITS))
			.toBe(0.07)
		expect(manualMinZoom(0.01, LIMITS))
			.toBe(0.05)
	})
})

describe('frameBoxTop', () => {
	const pane = { width: 1000, height: 600 }
	const margin = { width: 19, height: 11 }

	it('puts the top edge of a box that fits across at the margin and centres it', () => {
		const viewport = frameBoxTop({ x: 100, y: 200, width: 400, height: 900 }, pane, 1, margin)
		expect(viewport)
			.toEqual({ x: 1000 / 2 - 300, y: 11 - 200, zoom: 1 })
		// On screen: left 300, right 700, equally far from both sides.
		expect(100 + viewport.x)
			.toBe(1000 - (500 + viewport.x))
	})

	it('starts a box wider than the pane at its left edge, after the margin', () => {
		const viewport = frameBoxTop({ x: -50, y: 30, width: 1200, height: 100 }, pane, 0.5, margin)
		// 600px wide at 0.5 fits inside 1000 - 2 * 19: centred.
		expect(viewport.x)
			.toBe(500 - (-50 + 600) * 0.5)
		const wide = frameBoxTop({ x: -50, y: 30, width: 1200, height: 100 }, pane, 1, margin)
		expect(wide)
			.toEqual({ x: 19 + 50, y: 11 - 30, zoom: 1 })
	})
})

describe('planExpandViewport', () => {
	// Close to the Survey with #sessions expanded, maximized at 1440 x 900: the whole layout fits at about 0.65.
	const pane = { width: 1440, height: 739 }
	const content = { x: 0, y: 0, width: 2100, height: 1050 }
	const expanded = { x: 420, y: 40, width: 1150, height: 315 }

	it('frames the expanded widget at the readable zoom when the whole layout\'s Fit is lower', () => {
		const plan = planExpandViewport({ content, expanded, pane, padding: PADDING, limits: LIMITS })
		expect(plan.kind)
			.toBe('frame')
		if (plan.kind !== 'frame')
			return
		expect(plan.fitZoom)
			.toBeCloseTo(fitZoom(content, pane, PADDING, LIMITS), 6)
		expect(plan.fitZoom)
			.toBeLessThan(0.7)
		expect(plan.viewport.zoom)
			.toBeCloseTo(11 / 12, 6)
		// Member text 11px on screen, the widget's top edge at Fit's margin from the top of the pane, centred across.
		expect(plan.viewport.zoom * MEMBER_FONT_PX)
			.toBeCloseTo(11, 6)
		expect(expanded.y * plan.viewport.zoom + plan.viewport.y)
			.toBeCloseTo(fitMargin(pane.height, PADDING), 6)
		const left = expanded.x * plan.viewport.zoom + plan.viewport.x
		const right = (expanded.x + expanded.width) * plan.viewport.zoom + plan.viewport.x
		expect(left)
			.toBeCloseTo(pane.width - right, 6)
	})

	it('starts a widget wider than the pane at its left edge', () => {
		const plan = planExpandViewport({ content, expanded, pane: { width: 749, height: 252 }, padding: PADDING, limits: LIMITS })
		expect(plan.kind)
			.toBe('frame')
		if (plan.kind !== 'frame')
			return
		expect(expanded.x * plan.viewport.zoom + plan.viewport.x)
			.toBeCloseTo(fitMargin(749, PADDING), 6)
		expect(expanded.y * plan.viewport.zoom + plan.viewport.y)
			.toBeCloseTo(fitMargin(252, PADDING), 6)
	})

	it('keeps the whole layout when it already fits at the readable zoom or more', () => {
		const small = { x: 0, y: 0, width: 1200, height: 600 }
		const plan = planExpandViewport({ content: small, expanded: { x: 0, y: 0, width: 400, height: 200 }, pane, padding: PADDING, limits: LIMITS })
		expect(plan)
			.toEqual({ kind: 'fit', fitZoom: fitZoom(small, pane, PADDING, LIMITS) })
		expect(plan.fitZoom)
			.toBeGreaterThanOrEqual(readableZoom(LIMITS))
	})
})

describe('clusterToFrame', () => {
	const graph = { id: 'graph' }
	const other = { id: 'another graph' }

	it('frames a widget that was just expanded over the same semantic graph', () => {
		expect(clusterToFrame({ graph, expandedClusterId: null }, { graph, expandedClusterId: 'sessions' }))
			.toBe('sessions')
		// Expanding B collapses A (one widget at a time, issue #254): B is framed.
		expect(clusterToFrame({ graph, expandedClusterId: 'sessions' }, { graph, expandedClusterId: 'mode' }))
			.toBe('mode')
	})

	it('fits the whole layout after a collapse, on the first layout, and on a new semantic graph', () => {
		expect(clusterToFrame({ graph, expandedClusterId: 'sessions' }, { graph, expandedClusterId: null }))
			.toBeNull()
		expect(clusterToFrame(null, { graph, expandedClusterId: 'sessions' }))
			.toBeNull()
		// Another Document or a filter: a new layout generation not caused by expanding, even with the widget still expanded.
		expect(clusterToFrame({ graph, expandedClusterId: 'sessions' }, { graph: other, expandedClusterId: 'sessions' }))
			.toBeNull()
		expect(clusterToFrame({ graph, expandedClusterId: null }, { graph: other, expandedClusterId: 'sessions' }))
			.toBeNull()
		expect(clusterToFrame({ graph, expandedClusterId: 'sessions' }, { graph, expandedClusterId: 'sessions' }))
			.toBeNull()
	})

	it('frames again when the same widget is expanded after a collapse', () => {
		const expandedOnce = { graph, expandedClusterId: 'sessions' }
		const collapsed = { graph, expandedClusterId: null }
		expect(clusterToFrame(expandedOnce, collapsed))
			.toBeNull()
		expect(clusterToFrame(collapsed, { graph, expandedClusterId: 'sessions' }))
			.toBe('sessions')
	})
})

describe('the minimap', () => {
	const pane = { width: 1440, height: 739 }
	const content = { x: 0, y: 0, width: 2100, height: 1050 }

	it('is shown while part of the graph is out of view', () => {
		expect(isMinimapUseful(content, pane, { x: 0, y: 0, zoom: 11 / 12 }))
			.toBe(true)
		expect(isContentInView(content, pane, { x: 0, y: 0, zoom: 11 / 12 }))
			.toBe(false)
	})

	it('is hidden while the whole graph is in view (after Fit, say), within a pixel', () => {
		const zoom = fitZoom(content, pane, PADDING, LIMITS)
		const fitted = { x: (pane.width - content.width * zoom) / 2, y: (pane.height - content.height * zoom) / 2, zoom }
		expect(isMinimapUseful(content, pane, fitted))
			.toBe(false)
		expect(isMinimapUseful(content, pane, { ...fitted, x: fitted.x - (fitted.x + 0.9) }))
			.toBe(false)
		expect(isMinimapUseful(content, pane, { ...fitted, x: fitted.x - (fitted.x + 1.5) }))
			.toBe(true)
	})

	it('is shown in the default Tools pane, hidden in a pane smaller than 320 x 160, and before anything is measured', () => {
		expect(MINIMAP_MIN_PANE)
			.toEqual({ width: 320, height: 160 })
		const zoomedIn = { x: 0, y: 0, zoom: 1 }
		// The default Tools pane at 1440 x 900 and 1280 x 800, with the key shown (the smallest it gets).
		expect(isMinimapUseful(content, { width: 749, height: 252 }, zoomedIn))
			.toBe(true)
		expect(isMinimapUseful(content, { width: 666, height: 202 }, zoomedIn))
			.toBe(true)
		expect(isMinimapUseful(content, { width: 319, height: 600 }, zoomedIn))
			.toBe(false)
		expect(isMinimapUseful(content, { width: 600, height: 159 }, zoomedIn))
			.toBe(false)
		expect(isMinimapUseful(content, { width: 320, height: 160 }, zoomedIn))
			.toBe(true)
		expect(isMinimapUseful(null, pane, zoomedIn))
			.toBe(false)
	})

	it('gives way to a focus tag under it, not to one elsewhere', () => {
		const zoomedIn = { x: 0, y: 0, zoom: 1 }
		const map = bottomRightRect(pane, { width: 200, height: 120 }, 8)
		expect(map)
			.toEqual({ x: 1232, y: 611, width: 200, height: 120 })
		expect(isMinimapUseful(content, pane, zoomedIn, map, [{ x: 100, y: 100, width: 120, height: 24 }]))
			.toBe(true)
		expect(isMinimapUseful(content, pane, zoomedIn, map, [{ x: 100, y: 100, width: 120, height: 24 }, { x: 1200, y: 640, width: 120, height: 24 }]))
			.toBe(false)
		// Touching edges do not overlap.
		expect(rectsOverlap({ x: 0, y: 0, width: 10, height: 10 }, { x: 10, y: 0, width: 10, height: 10 }))
			.toBe(false)
	})

	it('maps a flow box to the screen at the viewport', () => {
		expect(toScreenRect({ x: 100, y: 50, width: 40, height: 20 }, { x: -30, y: 10, zoom: 0.5 }))
			.toEqual({ x: 20, y: 35, width: 20, height: 10 })
	})
})

describe('minimapSize', () => {
	it('is about a fifth of the canvas wide, with the graph\'s aspect ratio, within 96 x 64 and 200 x 120', () => {
		expect(MINIMAP_MIN_SIZE)
			.toEqual({ width: 96, height: 64 })
		expect(MINIMAP_MAX_SIZE)
			.toEqual({ width: 200, height: 120 })
		// 19% of 749 is 142; a 2:1 graph gives 71 high.
		expect(minimapSize({ width: 749, height: 300 }, { x: 0, y: 0, width: 2000, height: 1000 }))
			.toEqual({ width: 142, height: 71 })
		// The widest it gets.
		expect(minimapSize({ width: 1440, height: 739 }, { x: 0, y: 0, width: 2000, height: 1000 }))
			.toEqual({ width: 200, height: 100 })
		// Never narrower than 96.
		expect(minimapSize({ width: 320, height: 160 }, { x: 0, y: 0, width: 2000, height: 1000 }).width)
			.toBe(96)
	})

	it('keeps a tall graph within 120 high (narrower) and a flat one at 64 high at least', () => {
		expect(minimapSize({ width: 1440, height: 739 }, { x: 0, y: 0, width: 1000, height: 1000 }))
			.toEqual({ width: 120, height: 120 })
		expect(minimapSize({ width: 1440, height: 739 }, { x: 0, y: 0, width: 1000, height: 3000 }))
			.toEqual({ width: 96, height: 120 })
		expect(minimapSize({ width: 749, height: 300 }, { x: 0, y: 0, width: 6000, height: 1000 }))
			.toEqual({ width: 142, height: 64 })
	})
})
