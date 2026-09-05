/**
 * `toVueFlow()` — the final step of the `SemanticGraph -> toElkGraph() -> ELK layout -> toVueFlow()`
 * pipeline (diagnostic #13 Phase 5 "Dependency Graph implementation stack" comment): projects a laid-out
 * `SemanticGraph` into plain Vue Flow `nodes`/`edges`. Vue Flow is viewer-only here — every node is
 * `draggable: false`/`connectable: false` and no edge is `updatable`, so nothing in this module ever
 * produces an editable graph (diagnostic #13 Phase 5 "implementation stack" comment: "Do not enable graph
 * editing, edge creation, deletion or reparenting").
 */

import type { BlueprintDependencyReference } from '@deviltea/widget-core'
import type { InspectionNodeId } from '@deviltea/widget-core/inspection'
import type { Edge as VueFlowEdge, Node as VueFlowNode } from '@vue-flow/core'
import type { InspectorFocus } from '../lab/focus'
import type { LayoutedGraph } from './layout'
import type { GraphEdge, GraphEdgeOperation, GraphStubStatus, GraphVertexKind, SemanticGraph } from './types'

export type GraphNodeKind = 'cluster' | GraphVertexKind | 'stub'

export interface GraphNodeData {
	readonly kind: GraphNodeKind
	readonly label: string
	readonly transitivelyWrites?: boolean
	readonly invalidCycle?: boolean
	readonly stubStatus?: GraphStubStatus
	readonly isExpanded?: boolean
	readonly memberCount?: number
	readonly widgetId?: string
	readonly widgetType?: string
	readonly hasInvalidCycle?: boolean
	readonly isFocused?: boolean
	readonly isDimmed?: boolean
}

export interface GraphEdgeData {
	readonly operation: GraphEdgeOperation
	/** Dependency-container path (diagnostic #13 Phase 5: belongs in edge details, never on the canvas). */
	readonly path: readonly (string | number)[]
	readonly reference: BlueprintDependencyReference
	readonly invalidCycle?: boolean
	readonly stubStatus?: GraphStubStatus
	readonly isDimmed?: boolean
	readonly count?: number
	readonly semanticEdges?: readonly GraphEdge[]
}

export type GraphFlowNode = VueFlowNode<GraphNodeData>
export type GraphFlowEdge = VueFlowEdge<GraphEdgeData>

export interface ToVueFlowOptions {
	readonly expandedClusterIds?: ReadonlySet<string>
	readonly focused?: InspectorFocus | null
	readonly rootNodeId?: InspectionNodeId
}

function stubLabel(status: GraphStubStatus): string {
	return status === 'absent' ? 'absent' : 'invalid'
}

export function toVueFlow(
	graph: SemanticGraph,
	layout: LayoutedGraph,
	options?: ToVueFlowOptions,
): { nodes: GraphFlowNode[], edges: GraphFlowEdge[] } {
	const expandedClusterIds = options?.expandedClusterIds ?? new Set(graph.clusters.map(c => c.id))
	const focused = options?.focused

	// Determine active inspection target (member or non-root cluster)
	let activeMemberKey: string | null = null
	let activeClusterId: string | null = null

	if (focused?.member !== undefined) {
		activeMemberKey = `${focused.nodeId}:${focused.member.type}:${focused.member.name}`
	}
	else if (focused?.nodeId !== undefined && (options?.rootNodeId === undefined || focused.nodeId !== options.rootNodeId)) {
		activeClusterId = `cluster:${focused.nodeId}`
	}

	const hasActiveInspection = Boolean(activeMemberKey || activeClusterId)

	const clusterIdByVertex = new Map(graph.vertices.map(vertex => [vertex.id, vertex.clusterId] as const))

	// Group cross-cluster edges and collect same-cluster edges
	const crossClusterMap = new Map<string, GraphEdge[]>()
	const sameClusterEdges: GraphEdge[] = []

	for (const edge of graph.edges) {
		const sourceCluster = clusterIdByVertex.get(edge.sourceVertexId)
		const targetCluster = clusterIdByVertex.get(edge.targetVertexId)
		if (sourceCluster === undefined || targetCluster === undefined)
			continue

		if (sourceCluster === targetCluster) {
			sameClusterEdges.push(edge)
		}
		else {
			const effectiveSource = expandedClusterIds.has(sourceCluster) ? edge.sourceVertexId : sourceCluster
			const effectiveTarget = expandedClusterIds.has(targetCluster) ? edge.targetVertexId : targetCluster
			const key = `${effectiveSource}->${effectiveTarget}`
			const existing = crossClusterMap.get(key) ?? []
			existing.push(edge)
			crossClusterMap.set(key, existing)
		}
	}

	// Compute related nodes and edges for focus deemphasis
	const relatedNodeIds = new Set<string>()
	const relatedEdgeIds = new Set<string>()

	if (activeMemberKey) {
		relatedNodeIds.add(activeMemberKey)
		const ownerCluster = clusterIdByVertex.get(activeMemberKey)
		if (ownerCluster)
			relatedNodeIds.add(ownerCluster)

		for (const stub of graph.stubs) {
			if (stub.ownerVertexId === activeMemberKey) {
				relatedNodeIds.add(stub.id)
				relatedEdgeIds.add(`${stub.id}-edge`)
			}
		}

		for (const edge of sameClusterEdges) {
			if (edge.sourceVertexId === activeMemberKey || edge.targetVertexId === activeMemberKey) {
				relatedEdgeIds.add(edge.id)
				relatedNodeIds.add(edge.sourceVertexId)
				relatedNodeIds.add(edge.targetVertexId)
			}
		}

		for (const [key] of crossClusterMap) {
			const [effSource, effTarget] = key.split('->')
			const edgeId = `edge:${key}`
			if (effSource === activeMemberKey || effTarget === activeMemberKey) {
				relatedEdgeIds.add(edgeId)
				if (effSource)
					relatedNodeIds.add(effSource)
				if (effTarget)
					relatedNodeIds.add(effTarget)
			}
		}
	}
	else if (activeClusterId) {
		relatedNodeIds.add(activeClusterId)
		for (const v of graph.vertices) {
			if (v.clusterId === activeClusterId)
				relatedNodeIds.add(v.id)
		}
		for (const s of graph.stubs) {
			if (clusterIdByVertex.get(s.ownerVertexId) === activeClusterId) {
				relatedNodeIds.add(s.id)
				relatedEdgeIds.add(`${s.id}-edge`)
			}
		}
		for (const edge of sameClusterEdges) {
			if (clusterIdByVertex.get(edge.sourceVertexId) === activeClusterId) {
				relatedEdgeIds.add(edge.id)
				relatedNodeIds.add(edge.sourceVertexId)
				relatedNodeIds.add(edge.targetVertexId)
			}
		}
		for (const [key] of crossClusterMap) {
			const [effSource, effTarget] = key.split('->')
			const edgeId = `edge:${key}`
			const sourceMatch = effSource === activeClusterId || (effSource !== undefined && relatedNodeIds.has(effSource))
			const targetMatch = effTarget === activeClusterId || (effTarget !== undefined && relatedNodeIds.has(effTarget))
			if (sourceMatch || targetMatch) {
				relatedEdgeIds.add(edgeId)
				if (effSource)
					relatedNodeIds.add(effSource)
				if (effTarget)
					relatedNodeIds.add(effTarget)
			}
		}
	}

	const nodes: GraphFlowNode[] = []

	// Clusters
	for (const cluster of graph.clusters) {
		const rect = layout.clusters.get(cluster.id)
		if (rect === undefined)
			continue
		const isExpanded = expandedClusterIds.has(cluster.id)
		const clusterMembers = graph.vertices.filter(v => v.clusterId === cluster.id)
		const hasInvalidCycle = clusterMembers.some(v => graph.invalidCycleVertexIds.has(v.id))
		const isFocused = cluster.id === activeClusterId
		const isDimmed = hasActiveInspection && !relatedNodeIds.has(cluster.id)

		nodes.push({
			id: cluster.id,
			type: 'cluster',
			position: { x: rect.x, y: rect.y },
			style: { width: `${rect.width}px`, height: `${rect.height}px` },
			data: {
				kind: 'cluster',
				label: cluster.label,
				widgetId: cluster.widgetId,
				widgetType: cluster.widgetType,
				isExpanded,
				memberCount: clusterMembers.length,
				hasInvalidCycle,
				isFocused,
				isDimmed,
			},
			draggable: false,
			selectable: !isExpanded,
			connectable: false,
			zIndex: isExpanded ? -1 : 1,
		})
	}

	// Member vertices (only for expanded clusters)
	for (const vertex of graph.vertices) {
		if (!expandedClusterIds.has(vertex.clusterId))
			continue
		const rect = layout.vertices.get(vertex.id)
		if (rect === undefined)
			continue
		const isFocused = vertex.id === activeMemberKey
		const isDimmed = hasActiveInspection && !relatedNodeIds.has(vertex.id)

		nodes.push({
			id: vertex.id,
			type: 'member',
			parentNode: vertex.clusterId,
			position: { x: rect.x, y: rect.y },
			style: { width: `${rect.width}px`, height: `${rect.height}px` },
			data: {
				kind: vertex.kind,
				label: vertex.name,
				transitivelyWrites: vertex.transitivelyWrites,
				invalidCycle: graph.invalidCycleVertexIds.has(vertex.id),
				isFocused,
				isDimmed,
			},
			draggable: false,
			connectable: false,
		})
	}

	// Stubs (only for expanded clusters)
	for (const stub of graph.stubs) {
		const clusterId = clusterIdByVertex.get(stub.ownerVertexId)
		if (clusterId === undefined || !expandedClusterIds.has(clusterId))
			continue
		const rect = layout.stubs.get(stub.id)
		if (rect === undefined)
			continue
		const isDimmed = hasActiveInspection && !relatedNodeIds.has(stub.id)

		nodes.push({
			id: stub.id,
			type: 'stub',
			parentNode: clusterId,
			position: { x: rect.x, y: rect.y },
			style: { width: `${rect.width}px`, height: `${rect.height}px` },
			data: { kind: 'stub', label: stubLabel(stub.status), stubStatus: stub.status, isDimmed },
			draggable: false,
			selectable: false,
			connectable: false,
		})
	}

	const edges: GraphFlowEdge[] = []

	// Same-cluster edges (only for expanded clusters)
	for (const edge of sameClusterEdges) {
		const clusterId = clusterIdByVertex.get(edge.sourceVertexId)
		if (clusterId === undefined || !expandedClusterIds.has(clusterId))
			continue
		const isDimmed = hasActiveInspection && !relatedEdgeIds.has(edge.id)

		edges.push({
			id: edge.id,
			source: edge.sourceVertexId,
			sourceHandle: 'b',
			target: edge.targetVertexId,
			targetHandle: 't',
			type: 'smoothstep',
			label: edge.operation,
			class: `graph-edge graph-edge--${edge.operation}${edge.invalidCycle ? ' graph-edge--invalid-cycle' : ''}${isDimmed ? ' graph-edge--dimmed' : ''}`,
			data: { operation: edge.operation, path: edge.path, reference: edge.reference, invalidCycle: edge.invalidCycle, isDimmed },
			selectable: true,
			updatable: false,
			focusable: true,
		})
	}

	// Cross-cluster presentation edges
	for (const [key, group] of crossClusterMap) {
		const [effSource, effTarget] = key.split('->')
		if (!effSource || !effTarget)
			continue
		const edgeId = `edge:${key}`
		const isDimmed = hasActiveInspection && !relatedEdgeIds.has(edgeId)
		const primaryOp = group[0]!.operation
		const invalidCycle = group.some(e => e.invalidCycle)
		const ops = [...new Set(group.map(e => e.operation))]
		const label = group.length === 1 ? primaryOp : `${ops.join(', ')} (${group.length})`

		edges.push({
			id: edgeId,
			source: effSource,
			sourceHandle: 'b',
			target: effTarget,
			targetHandle: 't',
			type: 'smoothstep',
			label,
			class: `graph-edge graph-edge--${primaryOp}${invalidCycle ? ' graph-edge--invalid-cycle' : ''}${isDimmed ? ' graph-edge--dimmed' : ''}`,
			data: {
				operation: primaryOp,
				path: group[0]!.path,
				reference: group[0]!.reference,
				invalidCycle,
				count: group.length,
				semanticEdges: group,
				isDimmed,
			},
			selectable: true,
			updatable: false,
			focusable: true,
		})
	}

	// Stub edges (only for expanded clusters)
	for (const stub of graph.stubs) {
		const clusterId = clusterIdByVertex.get(stub.ownerVertexId)
		if (clusterId === undefined || !expandedClusterIds.has(clusterId))
			continue
		const stubEdgeId = `${stub.id}-edge`
		const isDimmed = hasActiveInspection && !relatedEdgeIds.has(stubEdgeId)

		edges.push({
			id: stubEdgeId,
			source: stub.ownerVertexId,
			sourceHandle: 'b',
			target: stub.id,
			targetHandle: 't',
			type: 'straight',
			label: stubLabel(stub.status),
			class: `graph-edge graph-edge--stub graph-edge--${stub.status}${isDimmed ? ' graph-edge--dimmed' : ''}`,
			data: { operation: stub.operation, path: stub.path, reference: stub.reference, stubStatus: stub.status, isDimmed },
			selectable: true,
			updatable: false,
			focusable: true,
		})
	}

	return { nodes, edges }
}
