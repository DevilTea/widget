/**
 * `projectSemanticGraph()` — projects a `BlueprintInspection` snapshot into the Lab's Dependency Graph
 * semantic representation (diagnostic #13 Phase 5 "Dependency Graph semantic representation" comment).
 *
 * Pure and deterministic: every fact is read directly off `inspection.nodes` / member
 * `dependencies[]` / `inspection.invalidCycles`, in the order core inspection already provides. This
 * module performs zero own SCC/graph analysis and never invents a resolved edge for an absent/invalid
 * dependency — see `../lib/` boundary notes and this app's AGENTS.md "readonly inspection" section.
 */

import type {
	BlueprintInspection,
	BlueprintInspectionDependency,
	InspectionNodeId,
	ResolvedBlueprintInspectionNode,
} from '@deviltea/widget-core/inspection'
import type {
	GraphCluster,
	GraphEdge,
	GraphEdgeOperation,
	GraphFilterOptions,
	GraphStub,
	GraphVertex,
	GraphVertexKind,
	SemanticGraph,
} from './types'

function vertexId(nodeId: InspectionNodeId, kind: GraphVertexKind, name: string): string {
	return `${nodeId}:${kind}:${name}`
}

function clusterIdOf(nodeId: InspectionNodeId): string {
	return `cluster:${nodeId}`
}

/** Diagnostic #13 Phase 5 operation-projection table: state-get/property-get -> reads, method-invoke -> invokes, state-set -> writes. */
function operationKindOf(operationType: 'state-get' | 'state-set' | 'property-get' | 'method-invoke'): GraphEdgeOperation {
	switch (operationType) {
		case 'state-get':
		case 'property-get':
			return 'reads'
		case 'method-invoke':
			return 'invokes'
		case 'state-set':
			return 'writes'
	}
}

interface DependencyOwner {
	readonly ownerVertexId: string
	readonly dependencies: readonly BlueprintInspectionDependency[]
}

function collectOwners(node: ResolvedBlueprintInspectionNode): readonly DependencyOwner[] {
	const owners: DependencyOwner[] = []
	for (const property of node.properties) {
		owners.push({
			ownerVertexId: vertexId(node.nodeId, 'property', property.name),
			dependencies: property.dependencies,
		})
	}
	for (const method of node.methods) {
		owners.push({
			ownerVertexId: vertexId(node.nodeId, 'method', method.name),
			dependencies: method.dependencies,
		})
	}
	return owners
}

/**
 * Projects every recovered-and-resolved node's State/Property/Method members into semantic vertices,
 * grouped by their owning widget cluster. Unresolved nodes own no members and contribute nothing (diagnostic
 * #13 Phase 5: "the graph must not invent a resolved target edge" extends to never fabricating member
 * vertices for a node the compiler could not resolve).
 */
function projectClustersAndVertices(inspection: BlueprintInspection): { clusters: Map<string, GraphCluster>, vertices: GraphVertex[] } {
	const clusters = new Map<string, GraphCluster>()
	const vertices: GraphVertex[] = []

	for (const node of inspection.nodes) {
		if (!node.resolved)
			continue

		const id = clusterIdOf(node.nodeId)
		clusters.set(id, {
			id,
			nodeId: node.nodeId,
			widgetId: node.node.id,
			widgetType: node.node.type,
			label: `${node.node.id} : ${node.node.type}`,
		})

		for (const state of node.state) {
			vertices.push({
				id: vertexId(node.nodeId, 'state', state.name),
				clusterId: id,
				nodeId: node.nodeId,
				kind: 'state',
				name: state.name,
			})
		}
		for (const property of node.properties) {
			vertices.push({
				id: vertexId(node.nodeId, 'property', property.name),
				clusterId: id,
				nodeId: node.nodeId,
				kind: 'property',
				name: property.name,
			})
		}
		for (const method of node.methods) {
			vertices.push({
				id: vertexId(node.nodeId, 'method', method.name),
				clusterId: id,
				nodeId: node.nodeId,
				kind: 'method',
				name: method.name,
				transitivelyWrites: method.transitivelyWrites,
			})
		}
	}

	return { clusters, vertices }
}

/** Projects every Property/Method member's `dependencies[]` into resolved edges or absent/invalid stubs. */
function projectEdgesAndStubs(inspection: BlueprintInspection): { edges: GraphEdge[], stubs: GraphStub[] } {
	const edges: GraphEdge[] = []
	const stubs: GraphStub[] = []

	for (const node of inspection.nodes) {
		if (!node.resolved)
			continue

		for (const owner of collectOwners(node)) {
			owner.dependencies.forEach((dependency, index) => {
				const id = `${owner.ownerVertexId}#dep${index}`
				const operation = operationKindOf(dependency.reference.operation.type)

				if (dependency.status === 'resolved') {
					edges.push({
						id,
						sourceVertexId: owner.ownerVertexId,
						targetVertexId: vertexId(dependency.target.nodeId, dependency.target.member.type, dependency.target.member.name),
						operation,
						path: dependency.path,
						reference: dependency.reference,
						invalidCycle: false,
					})
					return
				}

				stubs.push({
					id,
					ownerVertexId: owner.ownerVertexId,
					status: dependency.status,
					operation,
					path: dependency.path,
					reference: dependency.reference,
					...(dependency.status === 'invalid' && dependency.targetNodeId !== undefined
						? { targetNodeId: dependency.targetNodeId }
						: {}),
				})
			})
		}
	}

	return { edges, stubs }
}

/** Property-containing invalid evaluation SCCs (diagnostic #13 Phase 5: overlay, never recomputed by the Lab). */
function computeInvalidCycleVertexSets(inspection: BlueprintInspection): readonly ReadonlySet<string>[] {
	return inspection.invalidCycles.map(cycle =>
		new Set(cycle.members.map(member => vertexId(member.nodeId, member.member.type, member.member.name))),
	)
}

function markInvalidCycleEdges(edges: readonly GraphEdge[], cycleSets: readonly ReadonlySet<string>[]): GraphEdge[] {
	return edges.map((edge) => {
		const inCycle = cycleSets.some(set => set.has(edge.sourceVertexId) && set.has(edge.targetVertexId))
		return inCycle ? { ...edge, invalidCycle: true } : edge
	})
}

/**
 * Projects `inspection` into the Lab's semantic Dependency Graph.
 *
 * Filtering (diagnostic #13 Phase 5 "Graph density" / "Dependency status presentation"):
 * - `absent` stubs are hidden unless `options.showAbsent` — `invalid` stubs are always visible.
 * - members with no visible relation (no visible edge/stub touching them) are hidden unless
 *   `options.showIsolatedMembers`.
 *
 * Deterministic: iterates `inspection.nodes` (already a fixed pre-order) and each member's own
 * `dependencies[]` in declaration order; never sorts by anything Lab-local (e.g. object key order).
 */
export function projectSemanticGraph(inspection: BlueprintInspection, options: GraphFilterOptions = {}): SemanticGraph {
	const showAbsent = options.showAbsent ?? false
	const showIsolatedMembers = options.showIsolatedMembers ?? false

	const { clusters, vertices } = projectClustersAndVertices(inspection)
	const { edges: rawEdges, stubs: rawStubs } = projectEdgesAndStubs(inspection)

	const cycleSets = computeInvalidCycleVertexSets(inspection)
	const invalidCycleVertexIds = new Set<string>()
	for (const set of cycleSets) {
		for (const id of set) invalidCycleVertexIds.add(id)
	}

	const edges = markInvalidCycleEdges(rawEdges, cycleSets)
	const visibleStubs = rawStubs.filter(stub => stub.status === 'invalid' || showAbsent)

	const connectedVertexIds = new Set<string>()
	for (const edge of edges) {
		connectedVertexIds.add(edge.sourceVertexId)
		connectedVertexIds.add(edge.targetVertexId)
	}
	for (const stub of visibleStubs) connectedVertexIds.add(stub.ownerVertexId)

	const visibleVertices = showIsolatedMembers ? vertices : vertices.filter(vertex => connectedVertexIds.has(vertex.id))
	const visibleVertexIds = new Set(visibleVertices.map(vertex => vertex.id))

	const visibleClusters = [...clusters.values()].filter(cluster =>
		visibleVertices.some(vertex => vertex.clusterId === cluster.id),
	)

	return {
		clusters: Object.freeze(visibleClusters),
		vertices: Object.freeze(visibleVertices),
		edges: Object.freeze(edges.filter(edge => visibleVertexIds.has(edge.sourceVertexId) && visibleVertexIds.has(edge.targetVertexId))),
		stubs: Object.freeze(visibleStubs.filter(stub => visibleVertexIds.has(stub.ownerVertexId))),
		invalidCycleVertexIds: Object.freeze(invalidCycleVertexIds),
	}
}
