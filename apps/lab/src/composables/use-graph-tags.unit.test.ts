/**
 * The focus tags are re-placed only when something that changes where they go changes: Vue Flow replaces its viewport on every
 * wheel tick and pan step, so a zoom inside one bucket (`graph/zoom-scale.ts`) must not run the placement again.
 */

import type { TagPlacement } from '../graph/tag-placement'
import type { GraphFlowEdge } from '../graph/vue-flow'
import { describe, expect, it, vi } from 'vitest'
import { ref, shallowRef } from 'vue'
import { useGraphTags } from './use-graph-tags'

function tagged(id: string, relation: 'depends-on' | 'used-by'): GraphFlowEdge {
	return ({
		id,
		source: 'a',
		target: 'b',
		data: {
			arrow: 'accent',
			operation: 'reads',
			path: [],
			reference: { target: { type: 'widget', widgetId: 'b', optional: false }, operation: { type: 'property-get', name: 'p' } },
			route: [{ x: 0, y: 0 }, { x: 0, y: 200 }],
			relation,
			otherEnd: '#b',
		},
	}) as GraphFlowEdge
}

function setup() {
	const place = vi.fn((tags: readonly { id: string, text: string, relation: 'depends-on' | 'used-by' }[], _cards: readonly unknown[], _scale: { font: number, arrow: number }) => new Map<string, TagPlacement>(tags.map(tag => [tag.id, { x: 0, y: 50, width: 10, height: 10, text: tag.text, relation: tag.relation }])))
	const zoom = ref(0.95)
	const edges = shallowRef<GraphFlowEdge[]>([tagged('e1', 'depends-on'), tagged('e2', 'used-by')])
	const tags = useGraphTags({
		edges: () => edges.value,
		cards: () => [],
		zoom: () => zoom.value,
		text: (relation, name) => `${relation} ${name}`,
		place: place as never,
	})
	return { place, zoom, edges, tags }
}

describe('useGraphTags', () => {
	it('places the tags of the edges around the focus, with their words', () => {
		const { tags, place } = setup()
		expect([...tags.value.values()].map(tag => tag.text))
			.toEqual(['depends-on #b', 'used-by #b'])
		expect(place)
			.toHaveBeenCalledTimes(1)
		// The zoom bucket's text size and arrowhead length reach the placement.
		expect(place.mock.calls[0]![2])
			.toEqual({ font: 13, arrow: 15 })
	})

	it('does not place again when the zoom or the pan changes inside a bucket', () => {
		const { tags, place, zoom } = setup()
		const first = tags.value
		// 40 wheel ticks within the 0.85 to 1 bucket: the viewport is replaced each time, the bucket is the same.
		for (let step = 0; step < 40; step++) {
			zoom.value = 0.86 + step * 0.0035
			expect(tags.value)
				.toBe(first)
		}
		expect(place)
			.toHaveBeenCalledTimes(1)
	})

	it('places again when the zoom crosses into another bucket, and when the edges change', () => {
		const { tags, place, zoom, edges } = setup()
		void tags.value
		zoom.value = 0.7
		void tags.value
		expect(place)
			.toHaveBeenCalledTimes(2)
		expect(place.mock.calls[1]![2])
			.toEqual({ font: 19, arrow: 20 })
		edges.value = [tagged('e1', 'depends-on')]
		expect([...tags.value.keys()])
			.toEqual(['e1'])
		expect(place)
			.toHaveBeenCalledTimes(3)
	})

	it('places nothing below the zoom where text cannot be legible, and nothing without a focused edge', () => {
		const { tags, place, zoom, edges } = setup()
		zoom.value = 0.2
		expect(tags.value.size)
			.toBe(0)
		expect(place)
			.not
			.toHaveBeenCalled()
		zoom.value = 0.95
		edges.value = []
		expect(tags.value.size)
			.toBe(0)
		expect(place)
			.not
			.toHaveBeenCalled()
	})
})
