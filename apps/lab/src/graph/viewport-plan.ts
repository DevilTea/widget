/**
 * Where the Graph's viewport goes after a new layout, and when its minimap is worth showing. Pure geometry: no Vue, no Vue Flow.
 *
 * Fit shows the whole layout (the cards and the curves between them). Expanding a widget is different: one expanded widget next to
 * the other widgets as cards fits at 0.415 (the Survey's #sessions) or 0.196 (the Trip budget's #hotel) in issue #230's pane, where
 * a member card's 12px text is 5px or 2.4px on screen. So after an expansion the viewport goes to the *readable zoom* (the zoom at
 * which member text is 11px on screen) unless the whole layout already fits at that zoom or more, and frames the expanded widget's
 * own box: its top edge at the top of the pane (with the margin Fit leaves), centred across, or from its left edge when it is wider
 * than the pane. The edges to the other cards run off-screen, and the minimap shows where the viewport is.
 */

export interface Rect {
	readonly x: number
	readonly y: number
	readonly width: number
	readonly height: number
}

export interface Size {
	readonly width: number
	readonly height: number
}

export interface Viewport {
	readonly x: number
	readonly y: number
	readonly zoom: number
}

export interface ZoomLimits {
	readonly min: number
	readonly max: number
}

/** The font size of a member card (`.graph-member-card` in `GraphCanvas.vue`, which takes it from here). */
export const MEMBER_FONT_PX = 12
/** The smallest text anywhere in the Lab, on screen. */
export const MIN_SCREEN_TEXT_PX = 11

function clamp(value: number, limits: ZoomLimits): number {
	return Math.min(limits.max, Math.max(limits.min, value))
}

/** The zoom at which text of `fontPx` canvas px is `MIN_SCREEN_TEXT_PX` on screen, within the zoom limits. */
export function readableZoom(limits: ZoomLimits, fontPx: number = MEMBER_FONT_PX): number {
	return clamp(MIN_SCREEN_TEXT_PX / fontPx, limits)
}

/**
 * The margin Fit leaves on each side of a pane dimension for a relative `padding`, in screen px. Vue Flow's own rule for a numeric
 * padding (`parsePadding` in `@vue-flow/core`), so a framed widget starts as far from the top as a fitted graph does.
 */
export function fitMargin(paneLength: number, padding: number): number {
	return Math.floor((paneLength - paneLength / (1 + padding)) * 0.5)
}

/** The zoom Fit settles on for `bounds` (Vue Flow's `getTransformForBounds`, the zoom only). */
export function fitZoom(bounds: Rect, pane: Size, padding: number, limits: ZoomLimits): number {
	const xZoom = (pane.width - 2 * fitMargin(pane.width, padding)) / bounds.width
	const yZoom = (pane.height - 2 * fitMargin(pane.height, padding)) / bounds.height
	return clamp(Math.min(xZoom, yZoom), limits)
}

/**
 * How far out a person can zoom (wheel, pinch, Zoom out) after Fit settled on `fit`: about a quarter of it, never below 0.1 unless Fit
 * itself is lower, and never below the Fit floor. A small graph is not wheeled down to a dot.
 */
export function manualMinZoom(fit: number, limits: ZoomLimits, floor = 0.1): number {
	return Math.max(limits.min, Math.min(fit, Math.max(floor, fit * 0.25)))
}

/** The viewport that shows `box` at `zoom` with its top edge `margin` below the top of the pane, centred across or from its left edge. */
export function frameBoxTop(box: Rect, pane: Size, zoom: number, margin: Size): Viewport {
	const width = box.width * zoom
	const x = width <= pane.width - 2 * margin.width
		? pane.width / 2 - (box.x + box.width / 2) * zoom
		: margin.width - box.x * zoom
	return { x, y: margin.height - box.y * zoom, zoom }
}

export type ExpandViewportPlan
	/** The whole layout is readable at its Fit: fit it, as Fit graph does. */
	= | { readonly kind: 'fit', readonly fitZoom: number }
	/** Show the expanded widget at the readable zoom; `fitZoom` is still what the manual zoom floor follows. */
		| { readonly kind: 'frame', readonly fitZoom: number, readonly viewport: Viewport }

/**
 * Where the viewport goes after a widget was expanded: the whole layout when its Fit (`content` is the box of the cards and the
 * curves) is at the readable zoom or more, otherwise the expanded widget's box at the readable zoom (see the top of this file).
 */
export function planExpandViewport(input: {
	readonly content: Rect
	readonly expanded: Rect
	readonly pane: Size
	readonly padding: number
	readonly limits: ZoomLimits
	readonly fontPx?: number
}): ExpandViewportPlan {
	const { content, expanded, pane, padding, limits } = input
	const whole = fitZoom(content, pane, padding, limits)
	const readable = readableZoom(limits, input.fontPx)
	if (whole >= readable)
		return { kind: 'fit', fitZoom: whole }
	const margin = { width: fitMargin(pane.width, padding), height: fitMargin(pane.height, padding) }
	return { kind: 'frame', fitZoom: whole, viewport: frameBoxTop(expanded, pane, readable, margin) }
}

/** A laid-out graph and the widget expanded in it (one at a time, issue #254). */
export interface LayoutGeneration<Graph> {
	readonly graph: Graph
	readonly expandedClusterId: string | null
}

/**
 * Which widget to frame after a layout, given the layout before it: the widget that was just expanded, or null to fit the whole
 * layout. Only a new expansion over the same semantic graph frames (expanding B also collapses A; re-expanding after a collapse
 * frames again). The first layout, a collapse, and a new semantic graph (another Document, a filter) fit the whole layout, even when
 * a widget stays expanded through them.
 */
export function clusterToFrame<Graph>(previous: LayoutGeneration<Graph> | null, next: LayoutGeneration<Graph>): string | null {
	if (next.expandedClusterId === null || previous === null || previous.graph !== next.graph)
		return null
	return previous.expandedClusterId === next.expandedClusterId ? null : next.expandedClusterId
}

/** The minimap needs at least this much canvas to be any use; below it, it would cover most of what it maps. */
export const MINIMAP_MIN_PANE: Size = { width: 360, height: 260 }

/** Whether `content` (flow units) lies inside the pane at `viewport`, within `tolerance` screen px. */
export function isContentInView(content: Rect, pane: Size, viewport: Viewport, tolerance = 1): boolean {
	const left = content.x * viewport.zoom + viewport.x
	const top = content.y * viewport.zoom + viewport.y
	const right = left + content.width * viewport.zoom
	const bottom = top + content.height * viewport.zoom
	return left >= -tolerance && top >= -tolerance && right <= pane.width + tolerance && bottom <= pane.height + tolerance
}

/**
 * The minimap is shown only while part of the graph is out of view and the pane is at least `MINIMAP_MIN_PANE`: with everything in
 * view it has nothing to add, and in a tiny pane it would hide the graph it maps.
 */
export function isMinimapUseful(content: Rect | null, pane: Size, viewport: Viewport): boolean {
	if (content === null || pane.width < MINIMAP_MIN_PANE.width || pane.height < MINIMAP_MIN_PANE.height)
		return false
	return !isContentInView(content, pane, viewport)
}
