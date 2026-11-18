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
import { aggregateEdgeId } from './layout'
import { GRAPH_EDGE_TYPE, toVueFlow } from './vue-flow'

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
		const graphWithExtraEdge: SemanticGraph = {
			...graph,
			edges: [...graph.edges, {
				id: '1:property:reader#dep1',
				sourceVertexId: '1:property:reader',
				targetVertexId: '2:state:value',
				operation: 'writes',
				path: ['w'],
				reference: { target: { type: 'widget', widgetId: 'target', optional: false }, operation: { type: 'state-get', key: 'value' } },
				invalidCycle: false,
			}],
		}
		const layout = fixtureLayout()

		const { edges } = toVueFlow(graphWithExtraEdge, layout, {
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

	it('projects transitivelyEmits and transitivelyWrites independently onto Method node data', () => {
		const base = fixtureGraph()
		const methodVertex = (name: string, flags: { transitivelyWrites?: boolean, transitivelyEmits?: boolean }) =>
			({ id: `1:method:${name}`, clusterId: 'cluster:1', nodeId: 1 as InspectionNodeId, kind: 'method' as const, name, ...flags })
		const graph: SemanticGraph = {
			...base,
			vertices: [
				...base.vertices,
				methodVertex('ping', { transitivelyWrites: false, transitivelyEmits: true }),
				methodVertex('bump', { transitivelyWrites: true, transitivelyEmits: true }),
				methodVertex('save', { transitivelyWrites: true, transitivelyEmits: false }),
			],
		}
		const baseLayout = fixtureLayout()
		const layout: LayoutedGraph = {
			...baseLayout,
			vertices: new Map([
				...baseLayout.vertices,
				...['1:method:ping', '1:method:bump', '1:method:save'].map(id => [id, { x: 5, y: 5, width: 150, height: 32 }] as const),
			]),
		}

		const { nodes } = toVueFlow(graph, layout, { expandedClusterIds: new Set(['cluster:1']) })
		const flags = (id: string) => ({ writes: nodes.find(n => n.id === id)?.data?.transitivelyWrites, emits: nodes.find(n => n.id === id)?.data?.transitivelyEmits })

		expect(flags('1:method:ping'))
			.toEqual({ writes: false, emits: true })
		expect(flags('1:method:bump'))
			.toEqual({ writes: true, emits: true })
		expect(flags('1:method:save'))
			.toEqual({ writes: true, emits: false })
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
		const targetCluster = nodes.find(n => n.id === 'cluster:2')
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
		expect(targetCluster?.data?.isDimmed)
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
			expandedClusterIds: new Set(['cluster:1', 'cluster:2', 'cluster:3']),
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

	describe('direction (issue #230)', () => {
		const expandedAll = new Set(['cluster:1', 'cluster:2', 'cluster:3'])
		const reader = { nodeId: 1 as InspectionNodeId, member: { type: 'property' as const, name: 'reader' } }
		const value = { nodeId: 2 as InspectionNodeId, member: { type: 'state' as const, name: 'value' } }

		it('runs every edge from the owner to what it depends on, with the arrowhead on that target', () => {
			const { edges } = toVueFlow(fixtureGraph(), fixtureLayout(), { expandedClusterIds: expandedAll })
			expect(edges[0])
				.toMatchObject({
					source: '1:property:reader',
					target: '2:state:value',
					type: GRAPH_EDGE_TYPE,
					data: { arrow: 'muted' },
				})
			// The arrowhead is only ever at the end: the canvas draws one `markerEnd` marker per edge and no `markerStart`.
			expect(edges[0]?.markerStart)
				.toBeUndefined()
		})

		it('gives the arrowhead the colour family of the stroke it ends: the operation, danger for an invalid cycle, accent around the focus', () => {
			const base = fixtureGraph()
			const withOperation = (operation: 'reads' | 'writes' | 'invokes', invalidCycle = false): SemanticGraph => ({
				...base,
				edges: [{ ...base.edges[0]!, operation, invalidCycle }],
			})
			const arrowOf = (graph: SemanticGraph, focused?: { nodeId: InspectionNodeId }): string | undefined =>
				toVueFlow(graph, fixtureLayout(), { expandedClusterIds: expandedAll, focused, rootNodeId: 99 as InspectionNodeId }).edges[0]!.data?.arrow

			expect(arrowOf(withOperation('reads')))
				.toBe('muted')
			expect(arrowOf(withOperation('writes')))
				.toBe('writes')
			expect(arrowOf(withOperation('invokes')))
				.toBe('invokes')
			expect(arrowOf(withOperation('reads', true)))
				.toBe('danger')
			expect(arrowOf(withOperation('reads'), { nodeId: 1 as InspectionNodeId }))
				.toBe('accent')
			// An invalid cycle stays red even around the focus.
			expect(arrowOf(withOperation('reads', true), { nodeId: 1 as InspectionNodeId }))
				.toBe('danger')
		})

		it('tags the edge of a focused member as "depends-on" when it leaves the member and "used-by" when it arrives', () => {
			const outgoing = toVueFlow(fixtureGraph(), fixtureLayout(), { expandedClusterIds: expandedAll, focused: reader }).edges[0]!
			expect(outgoing.data?.relation)
				.toBe('depends-on')
			expect(outgoing.class)
				.toContain('graph-edge--depends-on')
			expect(outgoing.class).not.toContain('graph-edge--used-by')

			const incoming = toVueFlow(fixtureGraph(), fixtureLayout(), { expandedClusterIds: expandedAll, focused: value }).edges[0]!
			expect(incoming.data?.relation)
				.toBe('used-by')
			expect(incoming.class)
				.toContain('graph-edge--used-by')
		})

		it('tags the aggregate edge of a focused collapsed widget the same way, and leaves unrelated edges untagged', () => {
			const asReader = toVueFlow(fixtureGraph(), fixtureLayout(), { expandedClusterIds: new Set(), focused: { nodeId: 1 as InspectionNodeId }, rootNodeId: 99 as InspectionNodeId }).edges[0]!
			expect(asReader.data?.relation)
				.toBe('depends-on')

			const asTarget = toVueFlow(fixtureGraph(), fixtureLayout(), { expandedClusterIds: new Set(), focused: { nodeId: 2 as InspectionNodeId }, rootNodeId: 99 as InspectionNodeId }).edges[0]!
			expect(asTarget.data?.relation)
				.toBe('used-by')

			const unrelated = toVueFlow(fixtureGraph(), fixtureLayout(), { expandedClusterIds: new Set(), focused: { nodeId: 3 as InspectionNodeId }, rootNodeId: 99 as InspectionNodeId }).edges[0]!
			expect(unrelated.data?.isDimmed)
				.toBe(true)
			expect(unrelated.data?.relation)
				.toBeUndefined()
		})

		it('tags nothing while nothing is focused, nor an edge between two members of the focused widget', () => {
			expect(toVueFlow(fixtureGraph(), fixtureLayout(), { expandedClusterIds: expandedAll }).edges[0]!.data?.relation)
				.toBeUndefined()

			const graph = fixtureGraph()
			const internal: SemanticGraph = { ...graph, edges: [{ ...graph.edges[0]!, targetVertexId: '1:property:reader' }], stubs: [] }
			const { edges } = toVueFlow(internal, fixtureLayout(), { expandedClusterIds: expandedAll, focused: { nodeId: 1 as InspectionNodeId }, rootNodeId: 99 as InspectionNodeId })
			expect(edges[0]!.data?.relation)
				.toBeUndefined()
		})

		it('hands each edge the ELK route that belongs to it', () => {
			const route = [{ x: 0, y: 0 }, { x: 10, y: 40 }]
			const layout: LayoutedGraph = { ...fixtureLayout(), edges: new Map([[aggregateEdgeId('cluster:1', 'cluster:2'), route]]) }
			const { edges } = toVueFlow(fixtureGraph(), layout, { expandedClusterIds: new Set() })
			expect(edges[0]!.id)
				.toBe(aggregateEdgeId('cluster:1', 'cluster:2'))
			expect(edges[0]!.data?.route)
				.toEqual(route)
		})
	})

	describe('focus (issue #230)', () => {
		// A -> B -> C and an unrelated D -> E, each a widget of one member (collapsed, so the edges are cluster to cluster).
		function chain(): SemanticGraph {
			const ids = ['0', '1', '2', '3', '4']
			const name = (id: string): string => 'abcde'[Number(id)]!
			const edge = (from: string, to: string) => ({
				id: `${from}:property:p#dep0`,
				sourceVertexId: `${from}:property:p`,
				targetVertexId: `${to}:property:p`,
				operation: 'reads' as const,
				path: ['x'],
				reference: { target: { type: 'widget' as const, widgetId: name(to), optional: false }, operation: { type: 'property-get' as const, name: 'p' } },
				invalidCycle: false,
			})
			return {
				clusters: ids.map((id, index) => ({ id: `cluster:${id}`, nodeId: index as InspectionNodeId, widgetId: name(id), widgetType: 'thing', label: `${name(id)} : thing` })),
				vertices: ids.map((id, index) => ({ id: `${id}:property:p`, clusterId: `cluster:${id}`, nodeId: index as InspectionNodeId, kind: 'property' as const, name: 'p' })),
				edges: [edge('0', '1'), edge('1', '2'), edge('3', '4')],
				stubs: [],
				invalidCycleVertexIds: new Set(),
			}
		}
		function chainLayout(graph: SemanticGraph): LayoutedGraph {
			return {
				clusters: new Map(graph.clusters.map((cluster, index) => [cluster.id, { x: index * 300, y: 0, width: 240, height: 88 }])),
				vertices: new Map(),
				stubs: new Map(),
			}
		}
		const dimmedEdges = (focusedNodeId: number): Record<string, boolean | undefined> => {
			const graph = chain()
			const { edges } = toVueFlow(graph, chainLayout(graph), { expandedClusterIds: new Set(), focused: { nodeId: focusedNodeId as InspectionNodeId }, rootNodeId: 99 as InspectionNodeId })
			return Object.fromEntries(edges.map(edge => [`${edge.source}>${edge.target}`, edge.data?.isDimmed]))
		}

		it('dims every edge that does not touch the focused widget, however close it is to one that does', () => {
			// Focus b (index 1): a -> b and b -> c touch it; d -> e does not.
			expect(dimmedEdges(1))
				.toEqual({ 'cluster:0>cluster:1': false, 'cluster:1>cluster:2': false, 'cluster:3>cluster:4': true })
			// Focus a (index 0): only a -> b touches it. b -> c is next to it (b is related) but is not an edge of a, and must fade.
			expect(dimmedEdges(0))
				.toEqual({ 'cluster:0>cluster:1': false, 'cluster:1>cluster:2': true, 'cluster:3>cluster:4': true })
		})

		it('names the other end of an edge around the focus', () => {
			const graph = chain()
			const { edges } = toVueFlow(graph, chainLayout(graph), { expandedClusterIds: new Set(), focused: { nodeId: 1 as InspectionNodeId }, rootNodeId: 99 as InspectionNodeId })
			const byId = (source: string) => edges.find(edge => edge.source === source)!.data!
			// b is used by a (a -> b arrives at b) and depends on c (b -> c leaves b).
			expect(byId('cluster:0'))
				.toMatchObject({ relation: 'used-by', otherEnd: '#a' })
			expect(byId('cluster:1'))
				.toMatchObject({ relation: 'depends-on', otherEnd: '#c' })
			expect(byId('cluster:3').relation)
				.toBeUndefined()
		})
	})
})
