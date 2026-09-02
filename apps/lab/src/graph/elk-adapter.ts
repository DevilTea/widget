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
import type { LayoutedGraph, LayoutRect } from './layout'
import type { SemanticGraph } from './types'

/** Fixed member-vertex footprint. Deliberately simple fixed sizing — no text-measurement dependency. */
export const VERTEX_WIDTH = 160
export const VERTEX_HEIGHT = 32
/** Reference stubs render smaller than a real member vertex (diagnostic #13 Phase 5: "distinct visual"). */
export const STUB_WIDTH = 132
export const STUB_HEIGHT = 24

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
 * Projects a `SemanticGraph` into ELK's JSON graph schema. Every member vertex and reference stub is a
 * child of its owning widget cluster (an ELK compound node); an edge is declared on the least common
 * ancestor of its two endpoints — same-cluster edges nest inside that cluster, cross-cluster edges (and
 * every stub edge, which is always same-cluster) are declared at the level ELK requires.
 */
export function toElkGraph(graph: SemanticGraph): ElkNode {
	const clusterNodes = new Map<string, ElkNode>()
	for (const cluster of graph.clusters) clusterNodes.set(cluster.id, emptyClusterNode(cluster.id))

	const clusterIdOfVertex = new Map<string, string>()
	for (const vertex of graph.vertices) {
		clusterIdOfVertex.set(vertex.id, vertex.clusterId)
		clusterNodes.get(vertex.clusterId)?.children?.push({ id: vertex.id, width: VERTEX_WIDTH, height: VERTEX_HEIGHT })
	}

	for (const stub of graph.stubs) {
		const clusterId = clusterIdOfVertex.get(stub.ownerVertexId)
		if (clusterId === undefined)
			continue
		const cluster = clusterNodes.get(clusterId)
		if (cluster === undefined)
			continue
		cluster.children?.push({ id: stub.id, width: STUB_WIDTH, height: STUB_HEIGHT })
		cluster.edges?.push({ id: `${stub.id}-edge`, sources: [stub.ownerVertexId], targets: [stub.id] })
	}

	const rootEdges: ElkExtendedEdge[] = []
	for (const edge of graph.edges) {
		const sourceCluster = clusterIdOfVertex.get(edge.sourceVertexId)
		const targetCluster = clusterIdOfVertex.get(edge.targetVertexId)
		const elkEdge: ElkExtendedEdge = { id: edge.id, sources: [edge.sourceVertexId], targets: [edge.targetVertexId] }

		if (sourceCluster !== undefined && sourceCluster === targetCluster)
			clusterNodes.get(sourceCluster)?.edges?.push(elkEdge)
		else
			rootEdges.push(elkEdge)
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
export function fromElkResult(result: ElkNode, graph: SemanticGraph): LayoutedGraph {
	const vertexIds = new Set(graph.vertices.map(vertex => vertex.id))
	const stubIds = new Set(graph.stubs.map(stub => stub.id))

	const clusters = new Map<string, LayoutRect>()
	const vertices = new Map<string, LayoutRect>()
	const stubs = new Map<string, LayoutRect>()

	for (const clusterNode of result.children ?? []) {
		clusters.set(clusterNode.id, rectOf(clusterNode))
		for (const child of clusterNode.children ?? []) {
			if (vertexIds.has(child.id))
				vertices.set(child.id, rectOf(child))
			else if (stubIds.has(child.id))
				stubs.set(child.id, rectOf(child))
		}
	}

	return { clusters, vertices, stubs }
}
