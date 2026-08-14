/**
 * `toElkGraph()` / `fromElkResult()` structural tests against a hand-built `SemanticGraph` fixture (no
 * `@deviltea/widget-core` needed here — `SemanticGraph` is Lab-owned data). The real `elkjs` layout
 * engine and the Worker are deliberately excluded (issue #13 Phase 5 "worker itself excluded — keep it
 * thin"); these tests only assert the pure JSON-shape boundary this module owns.
 */

import type { ElkNode } from 'elkjs/lib/elk-api'
import type { SemanticGraph } from './types'
import { describe, expect, it } from 'vitest'
import { fromElkResult, STUB_HEIGHT, STUB_WIDTH, toElkGraph, VERTEX_HEIGHT, VERTEX_WIDTH } from './elk-adapter'

function fixtureGraph(): SemanticGraph {
	return {
		clusters: [
			{ id: 'cluster:1', nodeId: 1 as never, widgetId: 'consumer', widgetType: 'graph-consumer', label: 'consumer : graph-consumer' },
			{ id: 'cluster:2', nodeId: 2 as never, widgetId: 'target', widgetType: 'graph-target', label: 'target : graph-target' },
		],
		vertices: [
			{ id: '1:property:reader', clusterId: 'cluster:1', nodeId: 1 as never, kind: 'property', name: 'reader' },
			{ id: '2:state:value', clusterId: 'cluster:2', nodeId: 2 as never, kind: 'state', name: 'value' },
		],
		edges: [
			{
				id: '1:property:reader#dep0',
				sourceVertexId: '1:property:reader',
				targetVertexId: '2:state:value',
				operation: 'reads',
				path: ['s'],
				reference: { target: { type: 'widget', widgetId: 'target', optional: false }, operation: { type: 'state-get', key: 'value' } },
				invalidCycle: false,
			},
		],
		stubs: [
			{
				id: '1:property:reader#dep1',
				ownerVertexId: '1:property:reader',
				status: 'invalid',
				operation: 'reads',
				path: ['v'],
				reference: { target: { type: 'widget', widgetId: 'missing', optional: false }, operation: { type: 'state-get', key: 'value' } },
			},
		],
		invalidCycleVertexIds: new Set(),
	}
}

describe('toElkGraph', () => {
	it('nests member vertices and same-cluster stub pseudo-nodes/edges under their owning cluster', () => {
		const elkGraph = toElkGraph(fixtureGraph())

		expect(elkGraph.id)
			.toBe('root')
		expect(elkGraph.layoutOptions?.['elk.algorithm'])
			.toBe('layered')
		expect(elkGraph.layoutOptions?.['elk.direction'])
			.toBe('DOWN')
		expect(elkGraph.layoutOptions?.['elk.edgeRouting'])
			.toBe('ORTHOGONAL')

		const consumerCluster = elkGraph.children?.find(child => child.id === 'cluster:1')
		const targetCluster = elkGraph.children?.find(child => child.id === 'cluster:2')
		expect(consumerCluster?.children?.map(child => child.id))
			.toEqual(['1:property:reader', '1:property:reader#dep1'])
		expect(targetCluster?.children?.map(child => child.id))
			.toEqual(['2:state:value'])

		// The stub pseudo-node is sized distinctly from a real member vertex.
		const readerVertex = consumerCluster?.children?.find(child => child.id === '1:property:reader')
		const stubNode = consumerCluster?.children?.find(child => child.id === '1:property:reader#dep1')
		expect(readerVertex)
			.toMatchObject({ width: VERTEX_WIDTH, height: VERTEX_HEIGHT })
		expect(stubNode)
			.toMatchObject({ width: STUB_WIDTH, height: STUB_HEIGHT })

		// Same-cluster stub edge nests inside the owner's cluster.
		expect(consumerCluster?.edges?.map(edge => edge.id))
			.toEqual(['1:property:reader#dep1-edge'])
	})

	it('declares a cross-cluster edge at the root level rather than nesting it in either cluster', () => {
		const elkGraph = toElkGraph(fixtureGraph())

		expect(elkGraph.edges?.map(edge => edge.id))
			.toEqual(['1:property:reader#dep0'])
		const consumerCluster = elkGraph.children?.find(child => child.id === 'cluster:1')
		const targetCluster = elkGraph.children?.find(child => child.id === 'cluster:2')
		expect(consumerCluster?.edges?.some(edge => edge.id === '1:property:reader#dep0'))
			.toBe(false)
		expect(targetCluster?.edges?.some(edge => edge.id === '1:property:reader#dep0'))
			.toBe(false)
	})

	it('nests a same-cluster real edge inside that cluster instead of the root', () => {
		const graph = fixtureGraph()
		const sameClusterGraph: SemanticGraph = {
			...graph,
			edges: [{ ...graph.edges[0]!, targetVertexId: '1:property:reader' }],
			stubs: [],
		}

		const elkGraph = toElkGraph(sameClusterGraph)
		expect(elkGraph.edges)
			.toEqual([])
		const consumerCluster = elkGraph.children?.find(child => child.id === 'cluster:1')
		expect(consumerCluster?.edges?.map(edge => edge.id))
			.toEqual(['1:property:reader#dep0'])
	})
})

describe('fromElkResult', () => {
	it('reads cluster/vertex/stub rectangles back out of the ELK layout result, keyed by id', () => {
		const graph = fixtureGraph()
		const result: ElkNode = {
			id: 'root',
			children: [
				{
					id: 'cluster:1',
					x: 10,
					y: 20,
					width: 200,
					height: 100,
					children: [
						{ id: '1:property:reader', x: 5, y: 5, width: VERTEX_WIDTH, height: VERTEX_HEIGHT },
						{ id: '1:property:reader#dep1', x: 5, y: 45, width: STUB_WIDTH, height: STUB_HEIGHT },
					],
				},
				{
					id: 'cluster:2',
					x: 300,
					y: 20,
					width: 180,
					height: 60,
					children: [
						{ id: '2:state:value', x: 5, y: 5, width: VERTEX_WIDTH, height: VERTEX_HEIGHT },
					],
				},
			],
		}

		const layout = fromElkResult(result, graph)

		expect(layout.clusters.get('cluster:1'))
			.toEqual({ x: 10, y: 20, width: 200, height: 100 })
		expect(layout.clusters.get('cluster:2'))
			.toEqual({ x: 300, y: 20, width: 180, height: 60 })
		expect(layout.vertices.get('1:property:reader'))
			.toEqual({ x: 5, y: 5, width: VERTEX_WIDTH, height: VERTEX_HEIGHT })
		expect(layout.vertices.get('2:state:value'))
			.toEqual({ x: 5, y: 5, width: VERTEX_WIDTH, height: VERTEX_HEIGHT })
		expect(layout.stubs.get('1:property:reader#dep1'))
			.toEqual({ x: 5, y: 45, width: STUB_WIDTH, height: STUB_HEIGHT })
		expect(layout.vertices.has('1:property:reader#dep1'))
			.toBe(false)
		expect(layout.stubs.has('1:property:reader'))
			.toBe(false)
	})

	it('defaults missing x/y/width/height to 0 rather than throwing', () => {
		const graph = fixtureGraph()
		const result: ElkNode = { id: 'root', children: [{ id: 'cluster:1', children: [{ id: '1:property:reader' }] }] }

		const layout = fromElkResult(result, graph)
		expect(layout.clusters.get('cluster:1'))
			.toEqual({ x: 0, y: 0, width: 0, height: 0 })
		expect(layout.vertices.get('1:property:reader'))
			.toEqual({ x: 0, y: 0, width: 0, height: 0 })
	})
})
