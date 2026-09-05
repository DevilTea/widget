/**
 * Pure framework-agnostic relations projection for the Dependencies inspector.
 *
 * Maps `SemanticGraph + InspectorFocus + rootNodeId` into a structured Relations view model
 * without using Vue Flow or ELK. Preserves full semantic facts (local member, remote member,
 * exact operation `reads`/`writes`/`invokes`, reference, path, and invalid-cycle markers).
 */

import type { BlueprintDependencyOperation, BlueprintDependencyReference } from '@deviltea/widget-core'
import type { InspectionNodeId } from '@deviltea/widget-core/inspection'
import type { InspectorFocus } from '../lab/focus'
import type { GraphCluster, GraphEdgeOperation, GraphStub, GraphStubStatus, GraphVertex, GraphVertexKind, SemanticGraph } from './types'
import { formatDependencyTarget } from '../lib/diagnostic-format'

export interface RelationsMemberIdentity {
	readonly nodeId: InspectionNodeId
	readonly clusterId: string
	readonly widgetId: string
	readonly widgetType: string
	readonly kind: GraphVertexKind
	readonly name: string
	readonly transitivelyWrites?: boolean
	readonly invalidCycle?: boolean
}

export interface RelationsWidgetIdentity {
	readonly nodeId: InspectionNodeId
	readonly clusterId: string
	readonly widgetId: string
	readonly widgetType: string
	readonly label: string
	readonly memberCounts: {
		readonly state: number
		readonly property: number
		readonly method: number
		readonly total: number
	}
	readonly members: readonly RelationsMemberIdentity[]
}

export interface RelationsDependencyRow {
	readonly id: string
	/** Local member involved in this relation */
	readonly localMember: {
		readonly nodeId: InspectionNodeId
		readonly kind: GraphVertexKind
		readonly name: string
	}
	readonly operation: GraphEdgeOperation
	readonly path: readonly (string | number)[]
	readonly reference: BlueprintDependencyReference
	readonly invalidCycle?: boolean
	readonly resolved: boolean

	/** Remote member if resolved */
	readonly remoteMember?: {
		readonly nodeId: InspectionNodeId
		readonly clusterId: string
		readonly widgetId: string
		readonly widgetType: string
		readonly kind: GraphVertexKind
		readonly name: string
	}

	/** Stub information if unresolved */
	readonly stubStatus?: GraphStubStatus
	readonly stubTarget?: {
		readonly targetDescription: string
		readonly targetNodeId?: InspectionNodeId
		readonly memberKind: GraphVertexKind
		readonly memberName: string
	}
}

export interface RelationsWidgetGroup {
	readonly key: string
	readonly widgetId: string
	readonly widgetType?: string
	readonly nodeId?: InspectionNodeId
	readonly isResolved: boolean
	readonly isSameWidget: boolean
	readonly rows: readonly RelationsDependencyRow[]
}

export interface RelationsInternalDependency {
	readonly id: string
	readonly sourceMember: {
		readonly nodeId: InspectionNodeId
		readonly kind: GraphVertexKind
		readonly name: string
	}
	readonly targetMember: {
		readonly nodeId: InspectionNodeId
		readonly kind: GraphVertexKind
		readonly name: string
	}
	readonly operation: GraphEdgeOperation
	readonly path: readonly (string | number)[]
	readonly reference: BlueprintDependencyReference
	readonly invalidCycle?: boolean
}

export type RelationsViewModel
	= | RelationsEmptyViewModel
		| RelationsMemberViewModel
		| RelationsWidgetViewModel

export interface RelationsEmptyViewModel {
	readonly mode: 'empty'
	readonly message: string
}

export interface RelationsMemberViewModel {
	readonly mode: 'member'
	readonly selectedMember: RelationsMemberIdentity
	readonly usedBy: readonly RelationsWidgetGroup[]
	readonly dependsOn: readonly RelationsWidgetGroup[]
	readonly totalUsedByCount: number
	readonly totalDependsOnCount: number
}

export interface RelationsWidgetViewModel {
	readonly mode: 'widget'
	readonly selectedWidget: RelationsWidgetIdentity
	readonly usedBy: readonly RelationsWidgetGroup[]
	readonly dependsOn: readonly RelationsWidgetGroup[]
	readonly internal: readonly RelationsInternalDependency[]
	readonly totalUsedByCount: number
	readonly totalDependsOnCount: number
	readonly totalInternalCount: number
}

function extractMemberFromOperation(operation: BlueprintDependencyOperation): { kind: GraphVertexKind, name: string } {
	switch (operation.type) {
		case 'state-get':
		case 'state-set':
			return { kind: 'state', name: operation.key }
		case 'property-get':
			return { kind: 'property', name: operation.name }
		case 'method-invoke':
			return { kind: 'method', name: operation.name }
	}
}

function buildMemberIdentity(
	vertex: GraphVertex,
	cluster: GraphCluster,
	invalidCycleVertexIds: ReadonlySet<string>,
): RelationsMemberIdentity {
	return {
		nodeId: vertex.nodeId,
		clusterId: vertex.clusterId,
		widgetId: cluster.widgetId,
		widgetType: cluster.widgetType,
		kind: vertex.kind,
		name: vertex.name,
		transitivelyWrites: vertex.transitivelyWrites,
		invalidCycle: invalidCycleVertexIds.has(vertex.id),
	}
}

interface GroupingTarget {
	readonly key: string
	readonly widgetId: string
	readonly widgetType?: string
	readonly nodeId?: InspectionNodeId
	readonly isResolved: boolean
	readonly isSameWidget: boolean
}

function resolveRemoteWidgetForEdge(
	remoteVertex: GraphVertex,
	clusterMap: Map<string, GraphCluster>,
	currentClusterId: string,
): GroupingTarget {
	const remoteCluster = clusterMap.get(remoteVertex.clusterId)
	if (remoteCluster !== undefined) {
		return {
			key: remoteCluster.id,
			widgetId: remoteCluster.widgetId,
			widgetType: remoteCluster.widgetType,
			nodeId: remoteCluster.nodeId,
			isResolved: true,
			isSameWidget: remoteCluster.id === currentClusterId,
		}
	}
	return {
		key: `unknown:${remoteVertex.clusterId}`,
		widgetId: remoteVertex.clusterId,
		isResolved: true,
		isSameWidget: false,
	}
}

function resolveRemoteWidgetForStub(
	stub: GraphStub,
	clusterMap: Map<string, GraphCluster>,
	currentCluster: GraphCluster,
): GroupingTarget {
	const target = stub.reference.target
	if (target.type === 'widget') {
		let clusterForTarget: GraphCluster | undefined
		if (stub.targetNodeId !== undefined) {
			clusterForTarget = clusterMap.get(`cluster:${stub.targetNodeId}`)
		}
		if (clusterForTarget === undefined) {
			for (const cluster of clusterMap.values()) {
				if (cluster.widgetId === target.widgetId) {
					clusterForTarget = cluster
					break
				}
			}
		}

		return {
			key: `stub:widget:${target.widgetId}`,
			widgetId: target.widgetId,
			widgetType: clusterForTarget?.widgetType,
			nodeId: stub.targetNodeId ?? clusterForTarget?.nodeId,
			isResolved: false,
			isSameWidget: false,
		}
	}

	if (target.type === 'self') {
		return {
			key: `stub:self:${currentCluster.id}`,
			widgetId: currentCluster.widgetId,
			widgetType: currentCluster.widgetType,
			nodeId: currentCluster.nodeId,
			isResolved: false,
			isSameWidget: true,
		}
	}

	if (target.type === 'parent') {
		return {
			key: 'stub:parent',
			widgetId: '(parent)',
			isResolved: false,
			isSameWidget: false,
		}
	}

	return {
		key: 'stub:root',
		widgetId: '(root)',
		isResolved: false,
		isSameWidget: false,
	}
}

function groupRows(rowsWithTarget: readonly { readonly target: GroupingTarget, readonly row: RelationsDependencyRow }[]): readonly RelationsWidgetGroup[] {
	const groupsMap = new Map<string, { target: GroupingTarget, rows: RelationsDependencyRow[] }>()

	for (const { target, row } of rowsWithTarget) {
		let group = groupsMap.get(target.key)
		if (group === undefined) {
			group = { target, rows: [] }
			groupsMap.set(target.key, group)
		}
		group.rows.push(row)
	}

	return Array.from(groupsMap.values())
		.map(({ target, rows }) => ({
			key: target.key,
			widgetId: target.widgetId,
			widgetType: target.widgetType,
			nodeId: target.nodeId,
			isResolved: target.isResolved,
			isSameWidget: target.isSameWidget,
			rows: Object.freeze(rows),
		}))
}

export function projectRelations(
	graph: SemanticGraph,
	focus: InspectorFocus | null | undefined,
	rootNodeId?: InspectionNodeId,
): RelationsViewModel {
	const emptyState: RelationsEmptyViewModel = {
		mode: 'empty',
		message: 'Select a widget or member from Preview Inspect, Blueprint, Runtime, or Graph to inspect its dependencies.',
	}

	if (!focus || focus.nodeId === undefined) {
		return emptyState
	}

	const clusterMap = new Map<string, GraphCluster>()
	for (const cluster of graph.clusters) {
		clusterMap.set(cluster.id, cluster)
	}

	const vertexMap = new Map<string, GraphVertex>()
	for (const vertex of graph.vertices) {
		vertexMap.set(vertex.id, vertex)
	}

	// 1. Check if Member Focus
	if (focus.member !== undefined) {
		const focusedVertex = graph.vertices.find(
			v => v.nodeId === focus.nodeId && v.kind === focus.member?.type && v.name === focus.member?.name,
		)
		if (focusedVertex === undefined) {
			return emptyState
		}

		const currentCluster = clusterMap.get(focusedVertex.clusterId)
		if (currentCluster === undefined) {
			return emptyState
		}

		const selectedMember = buildMemberIdentity(focusedVertex, currentCluster, graph.invalidCycleVertexIds)

		// Incoming edges (Used by): target is focusedVertex
		const incomingRowsWithTarget: { target: GroupingTarget, row: RelationsDependencyRow }[] = []
		for (const edge of graph.edges) {
			if (edge.targetVertexId !== focusedVertex.id)
				continue

			const sourceVertex = vertexMap.get(edge.sourceVertexId)
			if (sourceVertex === undefined)
				continue

			const remoteCluster = clusterMap.get(sourceVertex.clusterId)
			const target = resolveRemoteWidgetForEdge(sourceVertex, clusterMap, currentCluster.id)

			const row: RelationsDependencyRow = {
				id: edge.id,
				localMember: {
					nodeId: focusedVertex.nodeId,
					kind: focusedVertex.kind,
					name: focusedVertex.name,
				},
				operation: edge.operation,
				path: edge.path,
				reference: edge.reference,
				invalidCycle: edge.invalidCycle,
				resolved: true,
				remoteMember: {
					nodeId: sourceVertex.nodeId,
					clusterId: sourceVertex.clusterId,
					widgetId: remoteCluster?.widgetId ?? sourceVertex.clusterId,
					widgetType: remoteCluster?.widgetType ?? 'unknown',
					kind: sourceVertex.kind,
					name: sourceVertex.name,
				},
			}

			incomingRowsWithTarget.push({ target, row })
		}

		// Outgoing edges and stubs (Depends on): source is focusedVertex
		const outgoingRowsWithTarget: { target: GroupingTarget, row: RelationsDependencyRow }[] = []
		for (const edge of graph.edges) {
			if (edge.sourceVertexId !== focusedVertex.id)
				continue

			const targetVertex = vertexMap.get(edge.targetVertexId)
			if (targetVertex === undefined)
				continue

			const remoteCluster = clusterMap.get(targetVertex.clusterId)
			const target = resolveRemoteWidgetForEdge(targetVertex, clusterMap, currentCluster.id)

			const row: RelationsDependencyRow = {
				id: edge.id,
				localMember: {
					nodeId: focusedVertex.nodeId,
					kind: focusedVertex.kind,
					name: focusedVertex.name,
				},
				operation: edge.operation,
				path: edge.path,
				reference: edge.reference,
				invalidCycle: edge.invalidCycle,
				resolved: true,
				remoteMember: {
					nodeId: targetVertex.nodeId,
					clusterId: targetVertex.clusterId,
					widgetId: remoteCluster?.widgetId ?? targetVertex.clusterId,
					widgetType: remoteCluster?.widgetType ?? 'unknown',
					kind: targetVertex.kind,
					name: targetVertex.name,
				},
			}

			outgoingRowsWithTarget.push({ target, row })
		}

		// Outgoing stubs
		for (const stub of graph.stubs) {
			if (stub.ownerVertexId !== focusedVertex.id)
				continue

			const target = resolveRemoteWidgetForStub(stub, clusterMap, currentCluster)
			const memberInfo = extractMemberFromOperation(stub.reference.operation)

			const row: RelationsDependencyRow = {
				id: stub.id,
				localMember: {
					nodeId: focusedVertex.nodeId,
					kind: focusedVertex.kind,
					name: focusedVertex.name,
				},
				operation: stub.operation,
				path: stub.path,
				reference: stub.reference,
				resolved: false,
				stubStatus: stub.status,
				stubTarget: {
					targetDescription: formatDependencyTarget(stub.reference.target),
					targetNodeId: stub.targetNodeId,
					memberKind: memberInfo.kind,
					memberName: memberInfo.name,
				},
			}

			outgoingRowsWithTarget.push({ target, row })
		}

		const usedBy = groupRows(incomingRowsWithTarget)
		const dependsOn = groupRows(outgoingRowsWithTarget)

		return {
			mode: 'member',
			selectedMember,
			usedBy,
			dependsOn,
			totalUsedByCount: incomingRowsWithTarget.length,
			totalDependsOnCount: outgoingRowsWithTarget.length,
		}
	}

	// 2. Check if Widget Focus (must not be rootNodeId without member)
	if (rootNodeId !== undefined && focus.nodeId === rootNodeId) {
		return emptyState
	}

	const focusedCluster = graph.clusters.find(c => c.nodeId === focus.nodeId)
	if (focusedCluster === undefined) {
		return emptyState
	}

	const clusterVertices = graph.vertices.filter(v => v.clusterId === focusedCluster.id)
	const clusterVertexIds = new Set(clusterVertices.map(v => v.id))

	let stateCount = 0
	let propCount = 0
	let methodCount = 0
	const members: RelationsMemberIdentity[] = []

	for (const vertex of clusterVertices) {
		if (vertex.kind === 'state')
			stateCount++
		else if (vertex.kind === 'property')
			propCount++
		else if (vertex.kind === 'method')
			methodCount++

		members.push(buildMemberIdentity(vertex, focusedCluster, graph.invalidCycleVertexIds))
	}

	const selectedWidget: RelationsWidgetIdentity = {
		nodeId: focusedCluster.nodeId,
		clusterId: focusedCluster.id,
		widgetId: focusedCluster.widgetId,
		widgetType: focusedCluster.widgetType,
		label: focusedCluster.label,
		memberCounts: {
			state: stateCount,
			property: propCount,
			method: methodCount,
			total: clusterVertices.length,
		},
		members: Object.freeze(members),
	}

	// Cross-widget incoming (target in cluster, source outside)
	const incomingRowsWithTarget: { target: GroupingTarget, row: RelationsDependencyRow }[] = []
	// Same-widget internal dependencies
	const internalDependencies: RelationsInternalDependency[] = []

	for (const edge of graph.edges) {
		const targetInCluster = clusterVertexIds.has(edge.targetVertexId)
		const sourceInCluster = clusterVertexIds.has(edge.sourceVertexId)

		if (targetInCluster && sourceInCluster) {
			const sourceVertex = vertexMap.get(edge.sourceVertexId)
			const targetVertex = vertexMap.get(edge.targetVertexId)
			if (sourceVertex && targetVertex) {
				internalDependencies.push({
					id: edge.id,
					sourceMember: {
						nodeId: sourceVertex.nodeId,
						kind: sourceVertex.kind,
						name: sourceVertex.name,
					},
					targetMember: {
						nodeId: targetVertex.nodeId,
						kind: targetVertex.kind,
						name: targetVertex.name,
					},
					operation: edge.operation,
					path: edge.path,
					reference: edge.reference,
					invalidCycle: edge.invalidCycle,
				})
			}
			continue
		}

		if (targetInCluster && !sourceInCluster) {
			const sourceVertex = vertexMap.get(edge.sourceVertexId)
			const targetVertex = vertexMap.get(edge.targetVertexId)
			if (sourceVertex === undefined || targetVertex === undefined)
				continue

			const remoteCluster = clusterMap.get(sourceVertex.clusterId)
			const target = resolveRemoteWidgetForEdge(sourceVertex, clusterMap, focusedCluster.id)

			const row: RelationsDependencyRow = {
				id: edge.id,
				localMember: {
					nodeId: targetVertex.nodeId,
					kind: targetVertex.kind,
					name: targetVertex.name,
				},
				operation: edge.operation,
				path: edge.path,
				reference: edge.reference,
				invalidCycle: edge.invalidCycle,
				resolved: true,
				remoteMember: {
					nodeId: sourceVertex.nodeId,
					clusterId: sourceVertex.clusterId,
					widgetId: remoteCluster?.widgetId ?? sourceVertex.clusterId,
					widgetType: remoteCluster?.widgetType ?? 'unknown',
					kind: sourceVertex.kind,
					name: sourceVertex.name,
				},
			}

			incomingRowsWithTarget.push({ target, row })
		}
	}

	// Cross-widget outgoing (source in cluster, target outside)
	const outgoingRowsWithTarget: { target: GroupingTarget, row: RelationsDependencyRow }[] = []
	for (const edge of graph.edges) {
		const targetInCluster = clusterVertexIds.has(edge.targetVertexId)
		const sourceInCluster = clusterVertexIds.has(edge.sourceVertexId)

		if (sourceInCluster && !targetInCluster) {
			const sourceVertex = vertexMap.get(edge.sourceVertexId)
			const targetVertex = vertexMap.get(edge.targetVertexId)
			if (sourceVertex === undefined || targetVertex === undefined)
				continue

			const remoteCluster = clusterMap.get(targetVertex.clusterId)
			const target = resolveRemoteWidgetForEdge(targetVertex, clusterMap, focusedCluster.id)

			const row: RelationsDependencyRow = {
				id: edge.id,
				localMember: {
					nodeId: sourceVertex.nodeId,
					kind: sourceVertex.kind,
					name: sourceVertex.name,
				},
				operation: edge.operation,
				path: edge.path,
				reference: edge.reference,
				invalidCycle: edge.invalidCycle,
				resolved: true,
				remoteMember: {
					nodeId: targetVertex.nodeId,
					clusterId: targetVertex.clusterId,
					widgetId: remoteCluster?.widgetId ?? targetVertex.clusterId,
					widgetType: remoteCluster?.widgetType ?? 'unknown',
					kind: targetVertex.kind,
					name: targetVertex.name,
				},
			}

			outgoingRowsWithTarget.push({ target, row })
		}
	}

	// Outgoing stubs from cluster members
	for (const stub of graph.stubs) {
		if (!clusterVertexIds.has(stub.ownerVertexId))
			continue

		const ownerVertex = vertexMap.get(stub.ownerVertexId)
		if (ownerVertex === undefined)
			continue

		const target = resolveRemoteWidgetForStub(stub, clusterMap, focusedCluster)
		const memberInfo = extractMemberFromOperation(stub.reference.operation)

		const row: RelationsDependencyRow = {
			id: stub.id,
			localMember: {
				nodeId: ownerVertex.nodeId,
				kind: ownerVertex.kind,
				name: ownerVertex.name,
			},
			operation: stub.operation,
			path: stub.path,
			reference: stub.reference,
			resolved: false,
			stubStatus: stub.status,
			stubTarget: {
				targetDescription: formatDependencyTarget(stub.reference.target),
				targetNodeId: stub.targetNodeId,
				memberKind: memberInfo.kind,
				memberName: memberInfo.name,
			},
		}

		outgoingRowsWithTarget.push({ target, row })
	}

	const usedBy = groupRows(incomingRowsWithTarget)
	const dependsOn = groupRows(outgoingRowsWithTarget)

	return {
		mode: 'widget',
		selectedWidget,
		usedBy,
		dependsOn,
		internal: Object.freeze(internalDependencies),
		totalUsedByCount: incomingRowsWithTarget.length,
		totalDependsOnCount: outgoingRowsWithTarget.length,
		totalInternalCount: internalDependencies.length,
	}
}
