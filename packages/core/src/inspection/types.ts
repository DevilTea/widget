/**
 * Public type contract of the dedicated `@deviltea/widget-core/inspection` subpath.
 *
 * Normative source: diagnostic #10 amendments "Promote renderer-agnostic inspection support into core",
 * "inspection identity may expose snapshot-local node IDs", "inspection is a readonly public subpath",
 * "readonly inspection subscription and disposal semantics", "inspection exact API v1 (part 1: Blueprint
 * inspection)" and "inspection exact API v1 (part 2: Runtime inspection, materialization, disposal,
 * conformance)". Those amendments are authoritative over any comment in this module.
 *
 * The root `@deviltea/widget-core` entrypoint does not re-export anything from this module.
 */

import type { BlueprintDependencyReference, RuntimePropertyDiagnostic } from '../diagnostic'
import type { ExecutionResult } from '../execution-result'
import type { BlueprintWidgetNode, ResolvedBlueprintWidgetNode, UnresolvedBlueprintWidgetNode } from '../internal/contract'
import type { AnyWidgetPluginTuple } from '../plugin'
import type { WidgetMemberKey } from '../types'

// -------------------------------------------------------------------------------------------------
// InspectionNodeId
// -------------------------------------------------------------------------------------------------

declare const inspectionNodeIdBrand: unique symbol

/**
 * Snapshot-local diagnostic identity only: unique per recovered source node (resolved and unresolved
 * alike) within one Blueprint inspection snapshot. Not persisted/domain identity, no stability guarantee
 * across `recompile()` or separately-created Blueprint snapshots, and equality across snapshots has no
 * semantic meaning. Consumers must not manufacture values or use it as a dependency target or
 * application/widget identifier. Allocation strategy is not public.
 */
export type InspectionNodeId = number & { readonly [inspectionNodeIdBrand]: true }

// -------------------------------------------------------------------------------------------------
// Blueprint inspection
// -------------------------------------------------------------------------------------------------

export interface BlueprintInspectionCapabilities {
	readonly config: boolean
	readonly slots: boolean
	readonly state: boolean
	readonly properties: boolean
	readonly methods: boolean
}

export interface BlueprintInspectionSourceSlot {
	readonly name: string
	readonly placement: 'slot' | 'raw-slot'
	readonly children: readonly InspectionNodeId[]
}

export interface BlueprintInspectionSemanticSlot {
	readonly name: WidgetMemberKey
	readonly children: readonly InspectionNodeId[]
}

export interface BlueprintInspectionMemberRef {
	readonly nodeId: InspectionNodeId
	readonly member:
		| { readonly type: 'state', readonly name: WidgetMemberKey }
		| { readonly type: 'property', readonly name: WidgetMemberKey }
		| { readonly type: 'method', readonly name: WidgetMemberKey }
}

export interface BlueprintInspectionDependencyBase {
	/**
	 * Path from the `registerDeps()` return root to this leaf, e.g. `[]` / `['pricing']` /
	 * `['pricing', 'base']` / `['items', 0]`. Object keys stay strings verbatim (`'__proto__'`, `'a.b'`,
	 * `'0'`); array/tuple indices are numbers. Never stringified to dot syntax.
	 */
	readonly path: readonly (string | number)[]
	/** Existing stable public declaration reference. */
	readonly reference: BlueprintDependencyReference
}

export interface ResolvedBlueprintInspectionDependency extends BlueprintInspectionDependencyBase {
	readonly status: 'resolved'
	/** Actual semantically-resolved endpoint. */
	readonly target: BlueprintInspectionMemberRef
}

export interface AbsentBlueprintInspectionDependency extends BlueprintInspectionDependencyBase {
	readonly status: 'absent'
}

export interface InvalidBlueprintInspectionDependency extends BlueprintInspectionDependencyBase {
	readonly status: 'invalid'
	/**
	 * Present only when target cardinality resolved to exactly one recovered source node before
	 * semantic target/capability/member resolution failed.
	 */
	readonly targetNodeId?: InspectionNodeId
}

export type BlueprintInspectionDependency
	= | ResolvedBlueprintInspectionDependency
		| AbsentBlueprintInspectionDependency
		| InvalidBlueprintInspectionDependency

export interface BlueprintInspectionStateMember {
	readonly type: 'state'
	readonly name: WidgetMemberKey
}

export interface BlueprintInspectionPropertyMember {
	readonly type: 'property'
	readonly name: WidgetMemberKey
	readonly dependencies: readonly BlueprintInspectionDependency[]
}

export interface BlueprintInspectionMethodMember {
	readonly type: 'method'
	readonly name: WidgetMemberKey
	/** Compiler-authoritative transitive write-effect fact. */
	readonly transitivelyWrites: boolean
	readonly dependencies: readonly BlueprintInspectionDependency[]
}

export interface BlueprintInspectionNodeBase<Plugins extends AnyWidgetPluginTuple = AnyWidgetPluginTuple> {
	readonly nodeId: InspectionNodeId
	/**
	 * The existing public Blueprint node object (`source`, `diagnostics`, and — when resolved —
	 * id/type/config/slots semantics). Inspection does not duplicate those semantics into a second DTO.
	 */
	readonly node: BlueprintWidgetNode<Plugins>
	/** Best-effort recovered source topology (not a raw `slots` mirror). */
	readonly sourceSlots: readonly BlueprintInspectionSourceSlot[]
}

export interface UnresolvedBlueprintInspectionNode<Plugins extends AnyWidgetPluginTuple = AnyWidgetPluginTuple> extends BlueprintInspectionNodeBase<Plugins> {
	readonly resolved: false
	readonly node: UnresolvedBlueprintWidgetNode<Plugins>
}

export interface ResolvedBlueprintInspectionNode<Plugins extends AnyWidgetPluginTuple = AnyWidgetPluginTuple> extends BlueprintInspectionNodeBase<Plugins> {
	readonly resolved: true
	readonly node: ResolvedBlueprintWidgetNode<Plugins>
	/** Authoritative capability presence (absent vs explicitly declared empty). */
	readonly capabilities: BlueprintInspectionCapabilities
	readonly semanticSlots: readonly BlueprintInspectionSemanticSlot[]
	readonly state: readonly BlueprintInspectionStateMember[]
	readonly properties: readonly BlueprintInspectionPropertyMember[]
	readonly methods: readonly BlueprintInspectionMethodMember[]
}

export type BlueprintInspectionNode<Plugins extends AnyWidgetPluginTuple = AnyWidgetPluginTuple>
	= | UnresolvedBlueprintInspectionNode<Plugins>
		| ResolvedBlueprintInspectionNode<Plugins>

export interface BlueprintInspectionEvaluationMemberRef {
	readonly nodeId: InspectionNodeId
	readonly member:
		| { readonly type: 'property', readonly name: WidgetMemberKey }
		| { readonly type: 'method', readonly name: WidgetMemberKey }
}

export interface BlueprintInspectionInvalidCycle {
	/** The SCC member set in deterministic semantic member order — not an ordered cycle path. */
	readonly members: readonly BlueprintInspectionEvaluationMemberRef[]
}

export interface BlueprintInspection<Plugins extends AnyWidgetPluginTuple = AnyWidgetPluginTuple> {
	readonly rootNodeId: InspectionNodeId
	/** Every recovered source node, including unresolved nodes. */
	readonly nodes: readonly BlueprintInspectionNode<Plugins>[]
	/**
	 * Property-containing invalid evaluation SCCs produced by core graph analysis. Method-only SCCs
	 * never appear.
	 */
	readonly invalidCycles: readonly BlueprintInspectionInvalidCycle[]

	getNode: (nodeId: InspectionNodeId) => BlueprintInspectionNode<Plugins> | null
	getNodeId: (node: BlueprintWidgetNode<Plugins>) => InspectionNodeId | null
}

// -------------------------------------------------------------------------------------------------
// Runtime inspection
// -------------------------------------------------------------------------------------------------

export interface InspectionObservable<Snapshot> {
	getSnapshot: () => Snapshot
	subscribe: (listener: (snapshot: Snapshot) => void) => () => void
}

export interface RuntimeStateInspectionSnapshot<T> {
	readonly value: T | null
}

export interface RuntimeStateInspection<T> extends InspectionObservable<RuntimeStateInspectionSnapshot<T>> {}

export type RuntimePropertyInspectionSnapshot<T>
	= | { readonly status: 'never-evaluated' }
		| {
			readonly status: 'completed'
			readonly result: ExecutionResult<T | null, RuntimePropertyDiagnostic>
		}

export interface RuntimePropertyInspection<T> extends InspectionObservable<RuntimePropertyInspectionSnapshot<T>> {}

export interface RuntimeWidgetInspection<Plugins extends AnyWidgetPluginTuple = AnyWidgetPluginTuple> {
	readonly nodeId: InspectionNodeId
	readonly blueprintNode: ResolvedBlueprintInspectionNode<Plugins>

	/** `null` when the state member/capability does not exist. Dynamic `unknown` typing. */
	getState: (key: WidgetMemberKey) => RuntimeStateInspection<unknown> | null
	/** `null` when the property member/capability does not exist. Dynamic `unknown` typing. */
	getProperty: (name: WidgetMemberKey) => RuntimePropertyInspection<unknown> | null
}

export interface RuntimeInspection<Plugins extends AnyWidgetPluginTuple = AnyWidgetPluginTuple> {
	/** Identity-stable with `inspectBlueprint(runtime.blueprint)`. */
	readonly blueprint: BlueprintInspection<Plugins>

	/**
	 * For every `InspectionNodeId` obtained from this `RuntimeInspection`'s `blueprint`, returns its
	 * corresponding `RuntimeWidgetInspection`. `null` when the supplied value does not designate a node
	 * in this snapshot (forged/out-of-domain values). An `InspectionNodeId` minted by a *different*
	 * snapshot is outside this identifier's defined domain — no cross-snapshot rejection is promised, and
	 * the implementation is not required to detect a value that happens to collide numerically with a
	 * node in this snapshot. Never throws for an ordinary lookup miss.
	 */
	getWidget: (nodeId: InspectionNodeId) => RuntimeWidgetInspection<Plugins> | null
}
