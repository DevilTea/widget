import type { KeyboardEdge } from './edge-a11y'
import { describe, expect, it } from 'vitest'
import { edgeKeyboardOrder, edgeNameParts, edgeTabStop, isEdgeNavigationKey, nextEdgeId } from './edge-a11y'

const edges: KeyboardEdge[] = [
	{ id: 'a', label: 'reads', data: { sourceName: '#form.valid', targetName: '#name.value' } },
	{ id: 'b', label: '3 deps', data: { relation: 'depends-on', sourceName: '#form', targetName: '#name' } },
	{ id: 'c', label: 'invokes', data: {} },
	{ id: 'd', label: 'writes', data: { relation: 'used-by', sourceName: '#x.m', targetName: '#y.s' } },
]

describe('edge keyboard order', () => {
	it('walks the edges around the focus first, each group in drawing order', () => {
		expect(edgeKeyboardOrder(edges))
			.toEqual(['b', 'd', 'a', 'c'])
	})

	it('keeps drawing order when nothing is focused', () => {
		expect(edgeKeyboardOrder(edges.map(edge => ({ id: edge.id }))))
			.toEqual(['a', 'b', 'c', 'd'])
	})

	it('has one Tab stop: the first edge of the order, or none without edges', () => {
		expect(edgeTabStop(edges))
			.toBe('b')
		expect(edgeTabStop([{ id: 'only' }]))
			.toBe('only')
		expect(edgeTabStop([]))
			.toBeNull()
	})
})

describe('nextEdgeId', () => {
	const order = ['b', 'd', 'a', 'c']

	it('moves forward with Down/Right and back with Up/Left', () => {
		expect(nextEdgeId(order, 'b', 'ArrowDown'))
			.toBe('d')
		expect(nextEdgeId(order, 'd', 'ArrowRight'))
			.toBe('a')
		expect(nextEdgeId(order, 'a', 'ArrowUp'))
			.toBe('d')
		expect(nextEdgeId(order, 'd', 'ArrowLeft'))
			.toBe('b')
	})

	it('wraps around at both ends', () => {
		expect(nextEdgeId(order, 'c', 'ArrowDown'))
			.toBe('b')
		expect(nextEdgeId(order, 'b', 'ArrowUp'))
			.toBe('c')
	})

	it('goes to the ends with Home and End, from anywhere', () => {
		expect(nextEdgeId(order, 'a', 'Home'))
			.toBe('b')
		expect(nextEdgeId(order, 'a', 'End'))
			.toBe('c')
	})

	it('goes nowhere without edges or from an unknown edge', () => {
		expect(nextEdgeId([], 'a', 'ArrowDown'))
			.toBeNull()
		expect(nextEdgeId(order, 'gone', 'ArrowDown'))
			.toBeNull()
	})

	it('recognizes exactly the navigation keys', () => {
		expect(['ArrowDown', 'ArrowRight', 'ArrowUp', 'ArrowLeft', 'Home', 'End'].every(isEdgeNavigationKey))
			.toBe(true)
		expect(['Enter', ' ', 'Escape', 'Tab', 'a'].some(isEdgeNavigationKey))
			.toBe(false)
	})
})

describe('edgeNameParts', () => {
	it('gives the label and both ends', () => {
		expect(edgeNameParts(edges[0]!))
			.toEqual({ label: 'reads', source: '#form.valid', target: '#name.value' })
	})

	it('is empty strings for what an edge does not carry', () => {
		expect(edgeNameParts({ id: 'x' }))
			.toEqual({ label: '', source: '', target: '' })
	})
})
