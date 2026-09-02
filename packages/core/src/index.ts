/**
 * `@deviltea/widget-core` public contract.
 *
 * The normative semantic contract is GitHub diagnostic #10 ("Widget composition core architecture —
 * canonical decision log"); its consolidated implementation handoff plus the accepted amendments are
 * authoritative over any comment in this package.
 */

export type {
	AnyDepExpression,
	DependencyBuilder,
	DependencyConsumer,
	EmptyRegisteredDeps,
	MaybeOptional,
	MethodInvokeDepExpression,
	OptionalizableDependencyTarget,
	PropertyGetDepExpression,
	RegisteredDeps,
	SelfDependencyTarget,
	SelfMethodDependencyOperations,
	SelfPropertyDependencyOperations,
	SelfStateDependencyOperations,
	StateGetDepExpression,
	StateSetDepExpression,
	ToExecutedDep,
	ToExecutedDeps,
	UnknownTargetDependencyOperations,
	UnknownTargetStateDependencyOperations,
} from './dep'

export { EMPTY_DIAGNOSTICS, WidgetSystemRuntimeDisposedError } from './diagnostic'

export type {
	BlueprintConfigDiagnostic,
	BlueprintDefinitionDiagnostic,
	BlueprintDependencyDiagnostic,
	BlueprintDependencyDiagnosticLocation,
	BlueprintDependencyOperation,
	BlueprintDependencyReference,
	BlueprintDependencyTarget,
	BlueprintDiagnostic,
	BlueprintDiagnosticLocation,
	BlueprintMethodDiagnosticLocation,
	BlueprintNodeDiagnostic,
	BlueprintNodeDiagnosticLocation,
	BlueprintPropertyDiagnosticLocation,
	BlueprintSlotChildDiagnosticLocation,
	BlueprintSlotDiagnosticLocation,
	BlueprintSourceDiagnostic,
	BlueprintSourceDiagnosticLocation,
	BlueprintStructureDiagnostic,
	BlueprintStructureDiagnosticLocation,
	BlueprintWidgetDiagnosticLocation,
	Diagnostic,
	DiagnosticBase,
	DiagnosticCollector,
	DiagnosticPath,
	JsonCompatibilityDiagnostic,
	JsonCompatibilityReason,
	RelativePluginStructureDiagnosticInput,
	RelativeSlotStructureDiagnosticInput,
	RelativeStructureDiagnosticLocation,
	RelativeSystemStructureDiagnosticInput,
	RelativeValueDiagnosticInput,
	RuntimeDependencyTargetFailedDiagnostic,
	RuntimeDependencyValueRejectedDiagnostic,
	RuntimeDiagnostic,
	RuntimeDiagnosticLocation,
	RuntimeLevelDiagnostic,
	RuntimeLevelDiagnosticLocation,
	RuntimeMethodArgsDiagnostic,
	RuntimeMethodDependencyDiagnostic,
	RuntimeMethodDiagnostic,
	RuntimeMethodResultDiagnostic,
	RuntimePropertyDependencyDiagnostic,
	RuntimePropertyDiagnostic,
	RuntimePropertyResultDiagnostic,
	RuntimeStateDiagnostic,
	RuntimeWidgetDiagnostic,
	SourceAccessDiagnostic,
	WidgetSystemRuntimeDiagnostic,
} from './diagnostic'

export type {
	ApplyPatchFailure,
	ApplyPatchOptions,
	ApplyPatchResult,
	CreateWidgetDocumentOptions,
	DocumentRevisionConflictFailure,
	ReentrantApplyFailure,
	WidgetDocument,
	WidgetDocumentSnapshot,
} from './document'
export { createWidgetDocument } from './document'

export type { ExecutionFailure, ExecutionResult } from './execution-result'

export type {
	BlueprintCompileView,
	BlueprintNodeConfigFields,
	BlueprintSemanticSlots,
	BlueprintSemanticSlotsView,
	BlueprintWidgetNode,
	BlueprintWidgetNodeBase,
	BlueprintWidgetNodeView,
	CreateWidgetSystemRuntimeOptions,
	InvalidWidgetSystemBlueprint,
	ResolvedBlueprintWidgetNode,
	ResolvedBlueprintWidgetNodeFor,
	ResolvedBlueprintWidgetNodeView,
	ResolvedBlueprintWidgetNodeViewFor,
	RuntimeMethod,
	RuntimeMethodSurface,
	RuntimeProperty,
	RuntimePropertySurface,
	RuntimeState,
	RuntimeStateSurface,
	RuntimeWidget,
	RuntimeWidgetFor,
	SelfBlueprintWidgetNode,
	SelfBlueprintWidgetNodeView,
	UnresolvedBlueprintWidgetNode,
	ValidBlueprintView,
	ValidWidgetSystemBlueprint,
	WidgetLocation,
	WidgetLocationView,
	WidgetSource,
	WidgetSourceFor,
	WidgetSystemBlueprint,
	WidgetSystemBlueprintStatus,
	WidgetSystemRuntime,
} from './internal/contract'

export type { JsonArray, JsonObject, JsonPrimitive, JsonValue } from './json'

export { createWidgetPlugin } from './plugin'

export type {
	AnyWidgetPlugin,
	AnyWidgetPluginTuple,
	WidgetConfigDefinition,
	WidgetConfigValidateContext,
	WidgetInterfacesOf,
	WidgetInterfacesViolation,
	WidgetMethodDefinition,
	WidgetMethodExecuteContext,
	WidgetMethodsSection,
	WidgetMethodValidateArgsContext,
	WidgetPlugin,
	WidgetPluginCapabilities,
	WidgetPluginConfigPhase,
	WidgetPluginDescriptionPhase,
	WidgetPluginDonePhase,
	WidgetPluginInterfacesPhase,
	WidgetPluginMethodsPhase,
	WidgetPluginPropertiesPhase,
	WidgetPluginSlotsPhase,
	WidgetPluginStatePhase,
	WidgetPluginTypeOf,
	WidgetPluginValidateStructure,
	WidgetPluginValidateStructureContext,
	WidgetPropertiesSection,
	WidgetPropertyComputeContext,
	WidgetPropertyDefinition,
	WidgetRegisterDepsContext,
	WidgetResolvedConfigContext,
	WidgetSlotDefinition,
	WidgetSlotDefinitions,
	WidgetSlotValidateStructureContext,
	WidgetStateDefaultContext,
	WidgetStateMemberDefinition,
	WidgetStateSection,
	WidgetStateValidateContext,
} from './plugin'

export {
	normalizeSeparatedWidgetSource,
	separateWidgetSource,
} from './separated-source'

export type {
	SeparatedSourceLocation,
	SeparatedWidgetData,
	SeparatedWidgetSource,
	SeparatedWidgetSourceDiagnostic,
	SeparatedWidgetSourceDiagnosticCode,
	SeparatedWidgetSourceNormalization,
	SeparatedWidgetStructure,
} from './separated-source'

export type {
	SourcePatch,
	SourcePatchOperation,
	SourcePatchOperationFailure,
	SourcePatchOperationFailureCode,
	SourcePath,
} from './source-patch'

export { createWidgetSystem } from './system'

export type {
	CreateWidgetSystemOptions,
	WidgetCatalog,
	WidgetCatalogEntry,
	WidgetPluginOf,
	WidgetSystem,
	WidgetSystemValidateStructure,
	WidgetSystemValidateStructureContext,
} from './system'

export type {
	HasWidgetCapability,
	NonEmptyReadonlyArray,
	WidgetCapabilityOf,
	WidgetId,
	WidgetInterfaces,
	WidgetInterfacesViolationOf,
	WidgetMemberKey,
	WidgetMemberKeysOf,
	WidgetMemberValueOf,
	WidgetMethodArgsOf,
	WidgetMethodKeyOf,
	WidgetMethodOf,
	WidgetMethodReturnOf,
	WidgetMethodsOf,
	WidgetPropertiesOf,
	WidgetPropertyKeyOf,
	WidgetPropertyValueOf,
	WidgetRawConfigOf,
	WidgetResolvedConfigOf,
	WidgetSlotNameOf,
	WidgetStateKeyOf,
	WidgetStateOf,
	WidgetStateValueOf,
} from './types'
