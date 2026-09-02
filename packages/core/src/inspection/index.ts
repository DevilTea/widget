/**
 * `@deviltea/widget-core/inspection` — the dedicated, strictly readonly inspection subpath.
 *
 * Deliberately not re-exported from the root `@deviltea/widget-core` entrypoint: ordinary consumers
 * never need to see or depend on this DevTools-oriented surface. See `packages/widget/core/AGENTS.md`
 * and GitHub diagnostic #10's inspection amendments for the normative contract.
 */

export { inspectBlueprint } from './blueprint'

export { inspectRuntime } from './runtime'
export type {
	AbsentBlueprintInspectionDependency,
	BlueprintInspection,
	BlueprintInspectionCapabilities,
	BlueprintInspectionDependency,
	BlueprintInspectionDependencyBase,
	BlueprintInspectionEvaluationMemberRef,
	BlueprintInspectionInvalidCycle,
	BlueprintInspectionMemberRef,
	BlueprintInspectionMethodMember,
	BlueprintInspectionNode,
	BlueprintInspectionNodeBase,
	BlueprintInspectionPropertyMember,
	BlueprintInspectionSemanticSlot,
	BlueprintInspectionSourceSlot,
	BlueprintInspectionStateMember,
	InspectionNodeId,
	InspectionObservable,
	InvalidBlueprintInspectionDependency,
	ResolvedBlueprintInspectionDependency,
	ResolvedBlueprintInspectionNode,
	RuntimeInspection,
	RuntimePropertyInspection,
	RuntimePropertyInspectionSnapshot,
	RuntimeStateInspection,
	RuntimeStateInspectionSnapshot,
	RuntimeWidgetInspection,
	UnresolvedBlueprintInspectionNode,
} from './types'
