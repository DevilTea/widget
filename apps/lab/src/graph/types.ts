/**
 * Widget Lab Dependency Graph — semantic graph projection types.
 *
 * Normative source: issue #13 (Widget Lab Phase 5) comment "Dependency Graph semantic representation
 * — accepted". Widgets are visual clusters/namespaces; State/Property/Method members are the semantic
 * vertices. Edge direction is owner -> declared dependency target. This module owns only the Lab-local
 * projection shape; it is a pure readonly view over `@deviltea/widget-core/inspection` facts and never
 * recomputes anything core already decided (`transitivelyWrites`, `invalidCycles`, dependency status).
 */

import type { BlueprintDependencyReference } from '@deviltea/widget-core'
import type { InspectionNodeId } from '@deviltea/widget-core/inspection'

export type GraphVertexKind = 'state' | 'property' | 'method'

/** Projected edge operation label (issue #13 Phase 5 "Dependency Graph semantic representation"). */
export type GraphEdgeOperation = 'reads' | 'invokes' | 'writes'

export type GraphStubStatus = 'absent' | 'invalid'

/** A widget instance, projected as a visual compound cluster — never a semantic vertex itself. */
export interface GraphCluster {
	readonly id: string
	readonly nodeId: InspectionNodeId
	readonly widgetId: string
	readonly widgetType: string
	readonly label: string
}

/** One State/Property/Method member — the semantic graph vertex. */
export interface GraphVertex {
	readonly id: string
	readonly clusterId: string
	readonly nodeId: InspectionNodeId
	readonly kind: GraphVertexKind
	readonly name: string
	/** Compiler-authoritative fact, present only for `kind === 'method'`. Never recomputed by the Lab. */
	readonly transitivelyWrites?: boolean
}

/** A `resolved` dependency: owner -> declared semantic member target. */
export interface GraphEdge {
	readonly id: string
	readonly sourceVertexId: string
	readonly targetVertexId: string
	readonly operation: GraphEdgeOperation
	/** Dependency-container path, e.g. `['pricing', 'base']` — edge detail only, never on-canvas. */
	readonly path: readonly (string | number)[]
	readonly reference: BlueprintDependencyReference
	/** True when both endpoints participate in the same `invalidCycles` SCC (core-authoritative overlay). */
	readonly invalidCycle: boolean
}

/**
 * A presentation-only reference stub for an `absent` or `invalid` dependency. Never a fake resolved
 * edge to a real member vertex.
 */
export interface GraphStub {
	readonly id: string
	readonly ownerVertexId: string
	readonly status: GraphStubStatus
	readonly operation: GraphEdgeOperation
	readonly path: readonly (string | number)[]
	readonly reference: BlueprintDependencyReference
	/** Only ever present for `status === 'invalid'`, when a single candidate node id was resolved. */
	readonly targetNodeId?: InspectionNodeId
}

export interface GraphFilterOptions {
	/** Optional-absent references are hidden by default; this reveals them. Default `false`. */
	readonly showAbsent?: boolean
	/** Members with no visible relation are hidden by default; this reveals them. Default `false`. */
	readonly showIsolatedMembers?: boolean
}

export interface SemanticGraph {
	readonly clusters: readonly GraphCluster[]
	readonly vertices: readonly GraphVertex[]
	readonly edges: readonly GraphEdge[]
	readonly stubs: readonly GraphStub[]
	/** Vertex ids participating in at least one `invalidCycles` SCC — the invalid-cycle overlay set. */
	readonly invalidCycleVertexIds: ReadonlySet<string>
}
