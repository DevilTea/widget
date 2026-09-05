/**
 * Unit tests for `toVueFlow()` projection:
 * - Progressive disclosure: collapsed cluster nodes vs expanded cluster containers.
 * - Aggregated edges between collapsed clusters with dependency counts.
 * - Subgraph focus highlighting and unrelated node/edge deemphasis (dimming).
 */

import type { InspectionNodeId } from '@deviltea/widget-core/inspection'
import type { LayoutedGraph } from './layout'
import type { SemanticGraph } from './types'
import { describe, expect, it } from 'vitest'
import { toVueFlow } from './vue-flow'

function fixtureGraph(): SemanticGraph {
	return {
		clusters: [
			{ id: 'cluster:1', nodeId: 1 as InspectionNodeId, widgetId: 'consumer', widgetType: 'graph-consumer', label: 'consumer : graph-consumer' },
			{ id: 'cluster:2', nodeId: 2 as InspectionNodeId, widgetId: 'target', widgetType: 'graph-target', label: 'target : graph-target' },
			{ id: 'cluster:3', nodeId: 3 as InspectionNodeId, widgetId: 'unrelated', widgetType: 'graph-unrelated', label: 'unrelated : graph-unrelated' },
		],
		vertices: [
			{ id: '1:property:reader', clusterId: 'cluster:1', nodeId: 1 as InspectionNodeId, kind: 'property', name: 'reader' },
			{ id: '2:state:value', clusterId: 'cluster:2', nodeId: 2 as InspectionNodeId, kind: 'state', name: 'value' },
			{ id: '3:state:other', clusterId: 'cluster:3', nodeId: 3 as InspectionNodeId, kind: 'state', name: 'other' },
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
		stubs: [],
		invalidCycleVertexIds: new Set(),
	}
}

function fixtureLayout(): LayoutedGraph {
	return {
		clusters: new Map([
			['cluster:1', { x: 10, y: 20, width: 200, height: 100 }],
			['cluster:2', { x: 300, y: 20, width: 180, height: 60 }],
			['cluster:3', { x: 550, y: 20, width: 180, height: 60 }],
		]),
		vertices: new Map([
			['1:property:reader', { x: 5, y: 5, width: 150, height: 32 }],
			['2:state:value', { x: 5, y: 5, width: 150, height: 32 }],
			['3:state:other', { x: 5, y: 5, width: 150, height: 32 }],
		]),
		stubs: new Map(),
	}
}

describe('toVueFlow', () => {
	it('projects collapsed clusters as leaf nodes with aggregated edges', () => {
		const graph = fixtureGraph()
		const layout = fixtureLayout()

		const { nodes, edges } = toVueFlow(graph, layout, {
			expandedClusterIds: new Set(),
		})

		// 3 cluster nodes, no vertex nodes
		expect(nodes.map(n => n.id))
			.toEqual(['cluster:1', 'cluster:2', 'cluster:3'])
		for (const node of nodes) {
			expect(node.type)
				.toBe('cluster')
			expect(node.data?.isExpanded)
				.toBe(false)
		}

		// Edge aggregates between cluster:1 and cluster:2
		expect(edges)
			.toHaveLength(1)
		expect(edges[0]?.source)
			.toBe('cluster:1')
		expect(edges[0]?.target)
			.toBe('cluster:2')
		expect(edges[0]?.label)
			.toBe('1 dep')
		expect(edges[0]?.data?.count)
			.toBe(1)
		expect(edges[0]?.data?.semanticEdges)
			.toHaveLength(1)
	})

	it('aggregates multiple edges between same clusters with combined label and count', () => {
		const graph = fixtureGraph()
		graph.edges.push({
			id: '1:property:reader#dep1',
			sourceVertexId: '1:property:reader',
			targetVertexId: '2:state:value',
			operation: 'writes',
			path: ['w'],
			reference: { target: { type: 'widget', widgetId: 'target', optional: false }, operation: { type: 'state-get', key: 'value' } },
			invalidCycle: false,
		})
		const layout = fixtureLayout()

		const { edges } = toVueFlow(graph, layout, {
			expandedClusterIds: new Set(),
		})

		expect(edges)
			.toHaveLength(1)
		expect(edges[0]?.source)
			.toBe('cluster:1')
		expect(edges[0]?.target)
			.toBe('cluster:2')
		expect(edges[0]?.label)
			.toBe('2 deps')
		expect(edges[0]?.data?.count)
			.toBe(2)
		expect(edges[0]?.data?.semanticEdges)
			.toHaveLength(2)
	})

	it('projects expanded clusters as compound containers with child vertex nodes', () => {
		const graph = fixtureGraph()
		const layout = fixtureLayout()

		const { nodes, edges } = toVueFlow(graph, layout, {
			expandedClusterIds: new Set(['cluster:1', 'cluster:2', 'cluster:3']),
		})

		const cluster1 = nodes.find(n => n.id === 'cluster:1')
		expect(cluster1?.type)
			.toBe('cluster')
		expect(cluster1?.data?.isExpanded)
			.toBe(true)

		const readerVertex = nodes.find(n => n.id === '1:property:reader')
		expect(readerVertex?.parentNode)
			.toBe('cluster:1')
		expect(readerVertex?.data?.kind)
			.toBe('property')

		// Direct vertex-to-vertex edge
		expect(edges)
			.toHaveLength(1)
		expect(edges[0]?.source)
			.toBe('1:property:reader')
		expect(edges[0]?.target)
			.toBe('2:state:value')
	})

	it('applies deemphasis (dimming) to unrelated nodes and edges when a member is focused', () => {
		const graph = fixtureGraph()
		const layout = fixtureLayout()

		const { nodes, edges } = toVueFlow(graph, layout, {
			expandedClusterIds: new Set(['cluster:1', 'cluster:2', 'cluster:3']),
			focused: {
				nodeId: 1 as InspectionNodeId,
				member: { type: 'property', name: 'reader' },
			},
		})

		const reader = nodes.find(n => n.id === '1:property:reader')
		const target = nodes.find(n => n.id === '2:state:value')
		const unrelated = nodes.find(n => n.id === '3:state:other')

		expect(reader?.data?.isFocused)
			.toBe(true)
		expect(reader?.data?.isDimmed)
			.toBe(false)

		// Related/connected target is not dimmed
		expect(target?.data?.isFocused)
			.toBe(false)
		expect(target?.data?.isDimmed)
			.toBe(false)

		// Unrelated node is dimmed
		expect(unrelated?.data?.isFocused)
			.toBe(false)
		expect(unrelated?.data?.isDimmed)
			.toBe(true)

		expect(edges[0]?.data?.isDimmed)
			.toBe(false)
	})

	it('applies deemphasis to unrelated clusters when a cluster is focused', () => {
		const graph = fixtureGraph()
		const layout = fixtureLayout()

		const { nodes } = toVueFlow(graph, layout, {
			expandedClusterIds: new Set(),
			focused: {
				nodeId: 1 as InspectionNodeId,
			},
			rootNodeId: 99 as InspectionNodeId,
		})

		const c1 = nodes.find(n => n.id === 'cluster:1')
		const c2 = nodes.find(n => n.id === 'cluster:2')
		const c3 = nodes.find(n => n.id === 'cluster:3')

		expect(c1?.data?.isFocused)
			.toBe(true)
		expect(c1?.data?.isDimmed)
			.toBe(false)

		// Related target cluster is connected and not dimmed
		expect(c2?.data?.isFocused)
			.toBe(false)
		expect(c2?.data?.isDimmed)
			.toBe(false)

		// Unrelated cluster is dimmed
		expect(c3?.data?.isFocused)
			.toBe(false)
		expect(c3?.data?.isDimmed)
			.toBe(true)
	})
})
