/**
 * `toElkGraph()` / `fromElkResult()` — the pure boundary between the Lab's `SemanticGraph` projection
 * and ELK's JSON graph schema (diagnostic #13 Phase 5 "Dependency Graph implementation stack": `toElkGraph()
 * -> ELK layout -> toVueFlow()`).
 *
 * Type-only `elkjs` import: this module builds/reads plain ELK-shaped JSON and never instantiates the
 * real `ELK` layout engine — that value import lives exclusively inside `layout.worker.ts` (diagnostic #13
 * Phase 5 "ELK layout worker" comment). Kept pure and synchronous so it is unit-testable without a
 * worker or the real elkjs runtime.
 */

import type { ElkExtendedEdge, ElkNode } from 'elkjs/lib/elk-api'
import type { LayoutedGraph, LayoutGraphOptions, LayoutRect } from './layout'
import type { SemanticGraph } from './types'

/** Fixed member-vertex footprint. Deliberately simple fixed sizing — no text-measurement dependency. */
export const VERTEX_WIDTH = 160
export const VERTEX_HEIGHT = 32
/** Reference stubs render smaller than a real member vertex (diagnostic #13 Phase 5: "distinct visual"). */
export const STUB_WIDTH = 132
export const STUB_HEIGHT = 24
/** Collapsed widget cluster footprint for top-level progressive disclosure view. */
export const COLLAPSED_CLUSTER_WIDTH = 200
export const COLLAPSED_CLUSTER_HEIGHT = 52

const ROOT_LAYOUT_OPTIONS = {
	'elk.algorithm': 'layered',
	// Initial vertical direction for the narrow/tall inspector panel (diagnostic #13 Phase 5 "implementation
	// stack" comment) — an implementation choice, not an architecture contract.
	'elk.direction': 'DOWN',
	'elk.edgeRouting': 'ORTHOGONAL',
	// Required so cross-cluster edges (declared at the root) participate in one coherent layered layout
	// together with each cluster's own internal member/stub edges.
	'elk.hierarchyHandling': 'INCLUDE_CHILDREN',
	'elk.layered.spacing.nodeNodeBetweenLayers': '56',
	'elk.spacing.nodeNode': '24',
} as const

const CLUSTER_LAYOUT_OPTIONS = {
	'elk.padding': '[top=32,left=14,bottom=14,right=14]',
} as const

function emptyClusterNode(id: string): ElkNode {
	return { id, layoutOptions: { ...CLUSTER_LAYOUT_OPTIONS }, children: [], edges: [] }
}

/**
 * Projects a `SemanticGraph` into ELK's JSON graph schema. Supports hierarchical progressive disclosure:
 * when `options.expandedClusterIds` is provided, clusters outside the set render as compact leaf nodes
 * without member children, and cross-cluster dependencies route to/from the cluster node itself.
 * If omitted, defaults to expanding all clusters.
 */
export function toElkGraph(graph: SemanticGraph, options?: LayoutGraphOptions): ElkNode {
	const expandedClusterIds = options?.expandedClusterIds ?? new Set(graph.clusters.map(c => c.id))
	const clusterNodes = new Map<string, ElkNode>()
	for (const cluster of graph.clusters) {
		if (expandedClusterIds.has(cluster.id)) {
			clusterNodes.set(cluster.id, emptyClusterNode(cluster.id))
		}
		else {
			clusterNodes.set(cluster.id, {
				id: cluster.id,
				width: COLLAPSED_CLUSTER_WIDTH,
				height: COLLAPSED_CLUSTER_HEIGHT,
			})
		}
	}

	const clusterIdOfVertex = new Map<string, string>()
	for (const vertex of graph.vertices) {
		clusterIdOfVertex.set(vertex.id, vertex.clusterId)
		if (expandedClusterIds.has(vertex.clusterId)) {
			clusterNodes.get(vertex.clusterId)?.children?.push({ id: vertex.id, width: VERTEX_WIDTH, height: VERTEX_HEIGHT })
		}
	}

	for (const stub of graph.stubs) {
		const clusterId = clusterIdOfVertex.get(stub.ownerVertexId)
		if (clusterId === undefined || !expandedClusterIds.has(clusterId))
			continue
		const cluster = clusterNodes.get(clusterId)
		if (cluster === undefined)
			continue
		cluster.children?.push({ id: stub.id, width: STUB_WIDTH, height: STUB_HEIGHT })
		cluster.edges?.push({ id: `${stub.id}-edge`, sources: [stub.ownerVertexId], targets: [stub.id] })
	}

	const rootEdges: ElkExtendedEdge[] = []
	const seenRootEdgeEndpoints = new Set<string>()

	for (const edge of graph.edges) {
		const sourceCluster = clusterIdOfVertex.get(edge.sourceVertexId)
		const targetCluster = clusterIdOfVertex.get(edge.targetVertexId)
		if (sourceCluster === undefined || targetCluster === undefined)
			continue

		const sourceExpanded = expandedClusterIds.has(sourceCluster)
		const targetExpanded = expandedClusterIds.has(targetCluster)

		if (sourceCluster === targetCluster) {
			if (sourceExpanded) {
				const elkEdge: ElkExtendedEdge = { id: edge.id, sources: [edge.sourceVertexId], targets: [edge.targetVertexId] }
				clusterNodes.get(sourceCluster)?.edges?.push(elkEdge)
			}
		}
		else {
			const effectiveSource = sourceExpanded ? edge.sourceVertexId : sourceCluster
			const effectiveTarget = targetExpanded ? edge.targetVertexId : targetCluster
			const key = `${effectiveSource}->${effectiveTarget}`
			if (!seenRootEdgeEndpoints.has(key)) {
				seenRootEdgeEndpoints.add(key)
				rootEdges.push({
					id: edge.id,
					sources: [effectiveSource],
					targets: [effectiveTarget],
				})
			}
		}
	}

	return {
		id: 'root',
		layoutOptions: { ...ROOT_LAYOUT_OPTIONS },
		children: [...clusterNodes.values()],
		edges: rootEdges,
	}
}

function rectOf(node: ElkNode): LayoutRect {
	return { x: node.x ?? 0, y: node.y ?? 0, width: node.width ?? 0, height: node.height ?? 0 }
}

/** Reads back the ELK layout result into `LayoutedGraph`, keyed by the same ids `toElkGraph()` used. */
export function fromElkResult(result: ElkNode, graph: SemanticGraph, options?: LayoutGraphOptions): LayoutedGraph {
	const expandedClusterIds = options?.expandedClusterIds ?? new Set(graph.clusters.map(c => c.id))
	const vertexIds = new Set(graph.vertices.map(vertex => vertex.id))
	const stubIds = new Set(graph.stubs.map(stub => stub.id))

	const clusters = new Map<string, LayoutRect>()
	const vertices = new Map<string, LayoutRect>()
	const stubs = new Map<string, LayoutRect>()

	for (const clusterNode of result.children ?? []) {
		clusters.set(clusterNode.id, rectOf(clusterNode))
		if (expandedClusterIds.has(clusterNode.id)) {
			for (const child of clusterNode.children ?? []) {
				if (vertexIds.has(child.id))
					vertices.set(child.id, rectOf(child))
				else if (stubIds.has(child.id))
					stubs.set(child.id, rectOf(child))
			}
		}
	}

	return { clusters, vertices, stubs }
}
