/**
 * `toVueFlow()` — the final step of the `SemanticGraph -> toElkGraph() -> ELK layout -> toVueFlow()`
 * pipeline (issue #13 Phase 5 "Dependency Graph implementation stack" comment): projects a laid-out
 * `SemanticGraph` into plain Vue Flow `nodes`/`edges`. Vue Flow is viewer-only here — every node is
 * `draggable: false`/`connectable: false` and no edge is `updatable`, so nothing in this module ever
 * produces an editable graph (issue #13 Phase 5 "implementation stack" comment: "Do not enable graph
 * editing, edge creation, deletion or reparenting").
 */

import type { BlueprintDependencyReference } from '@deviltea/widget-core'
import type { Edge as VueFlowEdge, Node as VueFlowNode } from '@vue-flow/core'
import type { LayoutedGraph } from './layout'
import type { GraphEdgeOperation, GraphStubStatus, GraphVertexKind, SemanticGraph } from './types'

export type GraphNodeKind = 'cluster' | GraphVertexKind | 'stub'

export interface GraphNodeData {
	readonly kind: GraphNodeKind
	readonly label: string
	readonly transitivelyWrites?: boolean
	readonly invalidCycle?: boolean
	readonly stubStatus?: GraphStubStatus
}

export interface GraphEdgeData {
	readonly operation: GraphEdgeOperation
	/** Dependency-container path (issue #13 Phase 5: belongs in edge details, never on the canvas). */
	readonly path: readonly (string | number)[]
	readonly reference: BlueprintDependencyReference
	readonly invalidCycle?: boolean
	readonly stubStatus?: GraphStubStatus
}

export type GraphFlowNode = VueFlowNode<GraphNodeData>
export type GraphFlowEdge = VueFlowEdge<GraphEdgeData>

function stubLabel(status: GraphStubStatus): string {
	return status === 'absent' ? 'absent' : 'invalid'
}

export function toVueFlow(graph: SemanticGraph, layout: LayoutedGraph): { nodes: GraphFlowNode[], edges: GraphFlowEdge[] } {
	const nodes: GraphFlowNode[] = []

	for (const cluster of graph.clusters) {
		const rect = layout.clusters.get(cluster.id)
		if (rect === undefined)
			continue
		nodes.push({
			id: cluster.id,
			type: 'cluster',
			position: { x: rect.x, y: rect.y },
			style: { width: `${rect.width}px`, height: `${rect.height}px` },
			data: { kind: 'cluster', label: cluster.label },
			draggable: false,
			selectable: false,
			connectable: false,
			zIndex: -1,
		})
	}

	for (const vertex of graph.vertices) {
		const rect = layout.vertices.get(vertex.id)
		if (rect === undefined)
			continue
		nodes.push({
			id: vertex.id,
			// One shared `'member'` Vue Flow node type for all three vertex kinds — `data.kind`
			// distinguishes State/Property/Method visuals inside a single custom-node template rather than
			// registering three near-identical Vue Flow node-type slots.
			type: 'member',
			parentNode: vertex.clusterId,
			position: { x: rect.x, y: rect.y },
			style: { width: `${rect.width}px`, height: `${rect.height}px` },
			data: {
				kind: vertex.kind,
				label: vertex.name,
				transitivelyWrites: vertex.transitivelyWrites,
				invalidCycle: graph.invalidCycleVertexIds.has(vertex.id),
			},
			draggable: false,
			connectable: false,
		})
	}

	const clusterIdByVertex = new Map(graph.vertices.map(vertex => [vertex.id, vertex.clusterId] as const))

	for (const stub of graph.stubs) {
		const rect = layout.stubs.get(stub.id)
		if (rect === undefined)
			continue
		nodes.push({
			id: stub.id,
			type: 'stub',
			parentNode: clusterIdByVertex.get(stub.ownerVertexId),
			position: { x: rect.x, y: rect.y },
			style: { width: `${rect.width}px`, height: `${rect.height}px` },
			data: { kind: 'stub', label: stubLabel(stub.status), stubStatus: stub.status },
			draggable: false,
			selectable: false,
			connectable: false,
		})
	}

	// `GraphCanvas.vue`'s `member` node template declares exactly one source handle (id `b`, bottom) and
	// one target handle (id `t`, top); every real edge and stub edge connects through those same two ids.
	const edges: GraphFlowEdge[] = [
		...graph.edges.map((edge): GraphFlowEdge => ({
			id: edge.id,
			source: edge.sourceVertexId,
			sourceHandle: 'b',
			target: edge.targetVertexId,
			targetHandle: 't',
			type: 'smoothstep',
			label: edge.operation,
			class: `graph-edge graph-edge--${edge.operation}${edge.invalidCycle ? ' graph-edge--invalid-cycle' : ''}`,
			data: { operation: edge.operation, path: edge.path, reference: edge.reference, invalidCycle: edge.invalidCycle },
			selectable: true,
			updatable: false,
			focusable: true,
		})),
		...graph.stubs.map((stub): GraphFlowEdge => ({
			id: `${stub.id}-edge`,
			source: stub.ownerVertexId,
			sourceHandle: 'b',
			target: stub.id,
			targetHandle: 't',
			type: 'straight',
			label: stubLabel(stub.status),
			class: `graph-edge graph-edge--stub graph-edge--${stub.status}`,
			data: { operation: stub.operation, path: stub.path, reference: stub.reference, stubStatus: stub.status },
			selectable: true,
			updatable: false,
			focusable: true,
		})),
	]

	return { nodes, edges }
}
