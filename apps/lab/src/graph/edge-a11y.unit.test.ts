import type { KeyboardEdge } from './edge-a11y'
import { describe, expect, it } from 'vitest'
import { edgeKeyboardOrder, edgeName, edgeTabStop, isEdgeNavigationKey, nextEdgeId } from './edge-a11y'

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

describe('edgeName', () => {
	it('is "source depends on target" with the operation, for an edge away from the focus or leaving it', () => {
		expect(edgeName(edges[0]!))
			.toEqual({ kind: 'depends-on', label: 'reads', source: '#form.valid', target: '#name.value', invalidCycle: false })
		expect(edgeName(edges[1]!))
			.toEqual({ kind: 'depends-on', label: '3 deps', source: '#form', target: '#name', invalidCycle: false })
	})

	it('is told from the focus when the edge arrives at it', () => {
		expect(edgeName(edges[3]!))
			.toEqual({ kind: 'used-by', label: 'writes', source: '#x.m', target: '#y.s', invalidCycle: false })
	})

	it('says an invalid cycle', () => {
		expect(edgeName({ id: 'c', label: 'reads', data: { sourceName: '#a.p', targetName: '#b.p', invalidCycle: true } }).invalidCycle)
			.toBe(true)
	})

	it('names a stub by its status and operation, not by a target called "invalid"', () => {
		expect(edgeName({ id: 's', label: 'invalid', data: { sourceName: '#a.p', targetName: 'invalid', stubStatus: 'invalid', operation: 'reads', relation: 'depends-on' } }))
			.toEqual({ kind: 'invalid', label: 'reads', source: '#a.p', target: 'invalid', invalidCycle: false })
		expect(edgeName({ id: 's', label: 'absent', data: { sourceName: '#a.m', targetName: 'absent', stubStatus: 'absent', operation: 'invokes' } }).kind)
			.toBe('absent')
	})

	it('is empty strings for what an edge does not carry', () => {
		expect(edgeName({ id: 'x' }))
			.toEqual({ kind: 'depends-on', label: '', source: '', target: '', invalidCycle: false })
	})
})
