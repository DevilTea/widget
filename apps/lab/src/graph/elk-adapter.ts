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
import type { GraphEdgeRoute } from './edge-geometry'
import type { LayoutedGraph, LayoutGraphOptions, LayoutRect } from './layout'
import type { SemanticGraph } from './types'
import { aggregateEdgeId } from './layout'

/** Fixed member-vertex footprint. Deliberately simple fixed sizing — no text-measurement dependency. */
export const VERTEX_WIDTH = 200
export const VERTEX_HEIGHT = 36
/** Reference stubs render smaller than a real member vertex (diagnostic #13 Phase 5: "distinct visual"). */
export const STUB_WIDTH = 140
export const STUB_HEIGHT = 28
/** Collapsed widget cluster footprint for top-level progressive disclosure view. */
export const COLLAPSED_CLUSTER_WIDTH = 240
export const COLLAPSED_CLUSTER_HEIGHT = 88

/**
 * Spacing is deliberately generous (issue #230, "the Graph is hard to read"): cards need clear air so the curves that
 * enter and leave them stay apart, and an arrowhead needs a few lines of curve before it reaches its card. Every pixel
 * costs Fit zoom, and below about 0.9 the default Survey's card text is under 11px on screen: with 128 between layers the
 * collapsed Survey fitted at 0.82 (9.8px titles), with 88 it fits at 0.95 (11.4px) while `nodeNode` stays 72 so the cards
 * are still far apart. The collapsed Trip budget (12 widgets, 70 dependency pairs) fits at about 0.37 either way.
 */
export const LAYOUT_SPACING = {
	/** Minimum clear gap between two cards of the same layer (`elk.spacing.nodeNode`). */
	nodeNode: 72,
	/** Clear gap between two layers: the room an edge has to bend and for its arrowhead (`nodeNodeBetweenLayers`). */
	betweenLayers: 88,
	/** Clear gap between a card and an edge that passes it (`edgeNode`, `edgeNodeBetweenLayers`). */
	edgeNode: 40,
	/** Clear gap between two edges that run side by side (`edgeEdge`, `edgeEdgeBetweenLayers`). */
	edgeEdge: 20,
} as const

const ROOT_LAYOUT_OPTIONS = {
	'elk.algorithm': 'layered',
	// Top to bottom: the pane is about as tall as it is wide, and a widget chain (the Trip budget's Settlement reads People
	// and Expenses, which read the Currency and Trip) is deeper than it is broad. Left to right fitted both showcases at a
	// third of this zoom. An edge points from the reader to what it reads, so an arrowhead mostly points down.
	'elk.direction': 'DOWN',
	// ELK only places the cards and finds the corridor each edge uses to pass the layers in between (its route points).
	// The canvas draws every edge as a Bezier curve through those points (`edge-geometry.ts`), never ELK's own route.
	'elk.edgeRouting': 'POLYLINE',
	// Route points in canvas coordinates whichever hierarchy level the edge belongs to.
	'elk.json.edgeCoords': 'ROOT',
	// Required so cross-cluster edges (declared at the root) participate in one coherent layered layout
	// together with each cluster's own internal member/stub edges.
	'elk.hierarchyHandling': 'INCLUDE_CHILDREN',
	// Compact, with fewer layers than ELK's default cycle breaking: a dependency cycle between widgets (the Survey's questions
	// read it back) is cut where it costs the least. Alone, NETWORK_SIMPLEX below fitted the collapsed Trip budget at 0.33;
	// with this it fits at 0.46.
	'elk.layered.cycleBreaking.strategy': 'GREEDY_MODEL_ORDER',
	'elk.layered.nodePlacement.strategy': 'NETWORK_SIMPLEX',
	'elk.spacing.nodeNode': String(LAYOUT_SPACING.nodeNode),
	'elk.layered.spacing.nodeNodeBetweenLayers': String(LAYOUT_SPACING.betweenLayers),
	'elk.spacing.edgeNode': String(LAYOUT_SPACING.edgeNode),
	'elk.layered.spacing.edgeNodeBetweenLayers': String(LAYOUT_SPACING.edgeNode),
	'elk.spacing.edgeEdge': String(LAYOUT_SPACING.edgeEdge),
	'elk.layered.spacing.edgeEdgeBetweenLayers': String(LAYOUT_SPACING.edgeEdge),
} as const

/** Spacing inside an expanded widget: members are 36px high cards, so these are smaller than between widgets but still leave an arrowhead its room. */
export const CLUSTER_SPACING = {
	nodeNode: 24,
	betweenLayers: 48,
	edgeNode: 20,
} as const

const CLUSTER_LAYOUT_OPTIONS = {
	'elk.padding': '[top=52,left=16,bottom=16,right=16]',
	'elk.spacing.nodeNode': String(CLUSTER_SPACING.nodeNode),
	'elk.layered.spacing.nodeNodeBetweenLayers': String(CLUSTER_SPACING.betweenLayers),
	'elk.spacing.edgeNode': String(CLUSTER_SPACING.edgeNode),
	'elk.layered.spacing.edgeNodeBetweenLayers': String(CLUSTER_SPACING.edgeNode),
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
					id: aggregateEdgeId(effectiveSource, effectiveTarget),
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

	const edges = new Map<string, GraphEdgeRoute>()
	const collectRoutes = (container: ElkNode): void => {
		for (const edge of container.edges ?? []) {
			const section = (edge as ElkExtendedEdge).sections?.[0]
			if (section === undefined)
				continue
			edges.set(edge.id, [section.startPoint, ...(section.bendPoints ?? []), section.endPoint].map(({ x, y }) => ({ x, y })))
		}
	}
	collectRoutes(result)
	for (const clusterNode of result.children ?? []) {
		if (expandedClusterIds.has(clusterNode.id))
			collectRoutes(clusterNode)
	}

	return { clusters, vertices, stubs, edges }
}
