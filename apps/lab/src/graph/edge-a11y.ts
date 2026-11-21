/**
 * Keyboard access to the Graph's edges (issue #230 follow-up), the pure part: which edge is the one Tab stop, the order the
 * arrow keys walk, and the words an edge is announced with. `GraphCanvas.vue` applies them.
 *
 * The edges are one composite for the keyboard: a graph has dozens of edges (the expanded Trip budget has hundreds), so only
 * one of them is in the Tab order and the arrow keys move between them. The Tab stop is the first edge of that order, and
 * the order starts with the edges around the focused widget or member (the ones drawn in the accent colour), so
 * "select a card, Tab to its edges" reaches the edges a person is looking at first.
 */

import type { GraphEdgeData } from './vue-flow'

export interface KeyboardEdge {
	readonly id: string
	readonly label?: unknown
	readonly data?: Pick<GraphEdgeData, 'relation' | 'sourceName' | 'targetName'>
}

/** The edges in the order the arrow keys walk them: the edges around the focus first, each group in drawing order. */
export function edgeKeyboardOrder(edges: readonly KeyboardEdge[]): string[] {
	const related = edges.filter(edge => edge.data?.relation !== undefined)
	const others = edges.filter(edge => edge.data?.relation === undefined)
	return [...related, ...others].map(edge => edge.id)
}

/** The one edge in the Tab order: the first of `edgeKeyboardOrder()`. `null` when there is no edge. */
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

/** The parts of an edge's accessible name: its label (the operation, or the dependency count of an aggregate) and both ends. */
export function edgeNameParts(edge: KeyboardEdge): { label: string, source: string, target: string } {
	return {
		label: String(edge.label ?? ''),
		source: edge.data?.sourceName ?? '',
		target: edge.data?.targetName ?? '',
	}
}
