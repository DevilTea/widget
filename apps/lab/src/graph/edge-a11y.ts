/**
 * Keyboard access to the Graph's edges (issue #230 follow-up), the pure part: which edge is the Tab stop to begin with, the
 * order the arrow keys walk, and what an edge is announced as. `GraphCanvas.vue` applies them.
 *
 * The edges are one composite for the keyboard: a graph has dozens of edges (the expanded Trip budget has hundreds), so only
 * one of them is in the Tab order at a time and the arrow keys move between them. It is a roving Tab stop: the edge that has
 * (or last had) focus is the stop, so Tab and Shift+Tab leave the group from wherever the arrows went. Until an edge was
 * focused, and again whenever the graph or the focused widget or member changes, the stop is the first edge of the keyboard
 * order, which starts with the edges around the focus (the ones drawn in the accent colour): "select a card, Tab to its edges"
 * reaches the edges a person is looking at first.
 */

import type { GraphEdgeData } from './vue-flow'

export interface KeyboardEdge {
	readonly id: string
	readonly label?: unknown
	readonly data?: Partial<Pick<GraphEdgeData, 'relation' | 'sourceName' | 'targetName' | 'stubStatus' | 'invalidCycle' | 'operation'>>
}

/** The edges in the order the arrow keys walk them: the edges around the focus first, each group in drawing order. */
export function edgeKeyboardOrder(edges: readonly KeyboardEdge[]): string[] {
	const related = edges.filter(edge => edge.data?.relation !== undefined)
	const others = edges.filter(edge => edge.data?.relation === undefined)
	return [...related, ...others].map(edge => edge.id)
}

/** The edge that is the Tab stop until an edge is focused: the first of `edgeKeyboardOrder()`. `null` when there is no edge. */
export function edgeTabStop(edges: readonly KeyboardEdge[]): string | null {
	return edgeKeyboardOrder(edges)[0] ?? null
}

export type EdgeNavigationKey = 'ArrowDown' | 'ArrowRight' | 'ArrowUp' | 'ArrowLeft' | 'Home' | 'End'

const NAVIGATION_KEYS: ReadonlySet<string> = new Set(['ArrowDown', 'ArrowRight', 'ArrowUp', 'ArrowLeft', 'Home', 'End'])

export function isEdgeNavigationKey(key: string): key is EdgeNavigationKey {
	return NAVIGATION_KEYS.has(key)
}

/**
 * The edge an arrow key moves to from `currentId`: next (Down/Right) or previous (Up/Left), wrapping around; Home and End
 * go to the ends. `null` when there is nowhere to go (no edges, or an id that is not in the order).
 */
export function nextEdgeId(order: readonly string[], currentId: string, key: EdgeNavigationKey): string | null {
	if (order.length === 0)
		return null
	if (key === 'Home')
		return order[0]!
	if (key === 'End')
		return order.at(-1)!
	const index = order.indexOf(currentId)
	if (index === -1)
		return null
	const step = key === 'ArrowDown' || key === 'ArrowRight' ? 1 : -1
	return order[(index + step + order.length) % order.length]!
}

/**
 * What an edge is, for its accessible name, as a sentence about its two ends rather than an arrow (a screen reader reads
 * "→" as "right arrow"): `depends-on` is "source depends on target", `used-by` the same fact told from the focused widget or
 * member the edge arrives at ("target is used by source"), and a stub edge says its dependency is `absent` or `invalid`
 * instead of naming a target that does not exist. `label` is the operation (or the dependency count of an aggregate).
 */
export interface EdgeName {
	readonly kind: 'depends-on' | 'used-by' | 'absent' | 'invalid'
	readonly source: string
	readonly target: string
	readonly label: string
	/** The edge is part of an invalid evaluation cycle. */
	readonly invalidCycle: boolean
}

export function edgeName(edge: KeyboardEdge): EdgeName {
	const data = edge.data
	const stub = data?.stubStatus
	return {
		kind: stub ?? (data?.relation === 'used-by' ? 'used-by' : 'depends-on'),
		source: data?.sourceName ?? '',
		target: data?.targetName ?? '',
		// A stub's own label is its status, which the sentence already says: its operation is the useful word.
		label: stub === undefined ? String(edge.label ?? '') : String(data?.operation ?? ''),
		invalidCycle: data?.invalidCycle === true,
	}
}
