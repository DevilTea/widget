/**
 * `@deviltea/widget-core/inspection` — the dedicated, strictly readonly inspection subpath.
 *
 * A supported public surface for any host that needs passive facts about plugins, Blueprints and
 * Runtimes (editors, tooling, renderers, DevTools). It lives on its own subpath, not re-exported from
 * the root `@deviltea/widget-core` entrypoint, so that its readonly guarantees stay separate from the
 * authoring and execution API. See `packages/core/AGENTS.md` and GitHub diagnostic #10's inspection
 * amendments for the normative contract.
 */

export { inspectBlueprint } from './blueprint'
export { WidgetInspectionError } from './errors'
export type { WidgetInspectionErrorCode } from './errors'
export { inspectPlugin } from './plugin'

export { inspectRuntime } from './runtime'
export type {
	AbsentBlueprintInspectionDependency,
	BlueprintInspection,
	BlueprintInspectionCapabilities,
	BlueprintInspectionDependency,
	BlueprintInspectionDependencyBase,
	BlueprintInspectionEvaluationMemberRef,
	BlueprintInspectionEventMember,
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
	PluginInspection,
	PluginInspectionEventMember,
	PluginInspectionPropertyMember,
	PluginInspectionSlot,
	PluginInspectionStateMember,
	ResolvedBlueprintInspectionDependency,
	ResolvedBlueprintInspectionNode,
	RuntimeEventInspection,
	RuntimeInspection,
	RuntimePropertyInspection,
	RuntimePropertyInspectionSnapshot,
	RuntimeStateInspection,
	RuntimeStateInspectionSnapshot,
	RuntimeWidgetInspection,
	UnresolvedBlueprintInspectionNode,
} from './types'
