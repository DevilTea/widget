/**
 * Public diagnostic vocabulary shared by Blueprint and Runtime.
 *
 * A diagnostic is an immutable fact: its machine-readable discriminator is the top-level `code`,
 * its ownership is the top-level `location`, and variant-specific facts are direct fields. Callback
 * inputs are deliberately relative; only the framework creates an absolute diagnostic.
 */

import type { BlueprintWidgetNode, BlueprintWidgetNodeView, ResolvedBlueprintWidgetNode, ResolvedBlueprintWidgetNodeView } from './internal/contract'
import type { JsonValue } from './json'
import type { AnyWidgetPluginTuple } from './plugin'
import type { HasWidgetCapability, NonEmptyReadonlyArray, WidgetId, WidgetInterfaces, WidgetMemberKey, WidgetReasonsOf } from './types'

export type DiagnosticPath = readonly PropertyKey[]

export interface DiagnosticBase<Code extends string = string, Location = unknown> {
	readonly code: Code
	readonly location: Location
	readonly message: string
}

export const EMPTY_DIAGNOSTICS: readonly never[] = Object.freeze([])

export class WidgetSystemRuntimeDisposedError extends Error {
	override readonly name = 'WidgetSystemRuntimeDisposedError'
	readonly code = 'runtime-disposed' as const

	constructor(message = 'The widget system runtime has been disposed.') {
		super(message)
	}
}

/**
 * Thrown when one Runtime's event emits nest deeper than its re-entrancy limit: an event listener keeps
 * re-invoking a Method that emits again. A non-semantic safety guard against runaway re-entrancy (a
 * `RangeError`, like any other runaway recursion), never a Diagnostic. Event-listener isolation does not
 * swallow it, so it unwinds every nested emit to the operation that started the loop.
 */
export class WidgetSystemRuntimeReentrancyError extends RangeError {
	override readonly name = 'WidgetSystemRuntimeReentrancyError'
	readonly code = 'emit-depth-exceeded' as const

	constructor(message = 'Event emits nested deeper than the Runtime\'s re-entrancy limit: an event listener keeps re-invoking a Method that emits.') {
		super(message)
	}
}

// Callback-authored relative inputs --------------------------------------------------------------

type DeclaredDiagnosticReasonFields<Reasons>
	= | { readonly reason?: undefined, readonly details?: undefined }
		| ([Reasons] extends [never]
			? never
			: {
					[Reason in Extract<keyof Reasons, string>]: [Reasons[Reason]] extends [void]
						? { readonly reason: Reason, readonly details?: undefined }
						: { readonly reason: Reason, readonly details: Reasons[Reason] }
				}[Extract<keyof Reasons, string>])

/**
 * The `reason` and `details` of a plugin-authored diagnostic input.
 *
 * When the plugin's interfaces declare `reasons`, `reason` is one of its keys (or omitted) and `details`
 * is that reason's payload: required when the payload is not `void`, forbidden when it is, and forbidden
 * without a `reason`. Without a `reasons` declaration (and for the System-level validator) `reason` is any
 * string and `details` any JSON value.
 *
 * At run time `details` must be a JSON value whatever the types say: `addDiagnostic` throws a `TypeError`
 * for anything else (a contract violation, not a diagnostic). It is kept by reference and carried unchanged
 * on the resulting diagnostic.
 */
export type DiagnosticReasonFields<Interfaces extends WidgetInterfaces = WidgetInterfaces> = HasWidgetCapability<Interfaces, 'reasons'> extends true
	? DeclaredDiagnosticReasonFields<WidgetReasonsOf<Interfaces>>
	: { readonly reason?: string, readonly details?: JsonValue }

export type RelativeValueDiagnosticInput<Interfaces extends WidgetInterfaces = WidgetInterfaces>
	= & { readonly message: string, readonly path?: DiagnosticPath }
		& DiagnosticReasonFields<Interfaces>

export type RelativeSlotStructureDiagnosticInput<Interfaces extends WidgetInterfaces = WidgetInterfaces>
	= & { readonly message: string, readonly index?: number }
		& DiagnosticReasonFields<Interfaces>

export type RelativePluginStructureDiagnosticInput<SlotName extends WidgetMemberKey = WidgetMemberKey, Interfaces extends WidgetInterfaces = WidgetInterfaces>
	= & (
		| { readonly message: string }
		| { readonly message: string, readonly slot: SlotName }
		| { readonly message: string, readonly slot: SlotName, readonly index: number }
	)
	& DiagnosticReasonFields<Interfaces>

export type RelativeStructureDiagnosticLocation<Plugins extends AnyWidgetPluginTuple = AnyWidgetPluginTuple>
	= | { readonly type: 'widget', readonly node: BlueprintWidgetNodeView<Plugins> }
		| { readonly type: 'slot', readonly node: ResolvedBlueprintWidgetNodeView<Plugins>, readonly slot: WidgetMemberKey }
		| { readonly type: 'slot-child', readonly node: ResolvedBlueprintWidgetNodeView<Plugins>, readonly slot: WidgetMemberKey, readonly index: number }

export interface RelativeSystemStructureDiagnosticInput<Plugins extends AnyWidgetPluginTuple = AnyWidgetPluginTuple> {
	readonly message: string
	readonly location: RelativeStructureDiagnosticLocation<Plugins>
	readonly related?: NonEmptyReadonlyArray<RelativeStructureDiagnosticLocation<Plugins>>
	readonly reason?: string
	/** A JSON value; anything else is a contract violation (`TypeError`). */
	readonly details?: JsonValue
}

export interface DiagnosticCollector<Input> {
	addDiagnostic: (diagnostic: Input) => void
	hasAnyDiagnostic: () => boolean
}

// Blueprint locations ---------------------------------------------------------------------------

export interface BlueprintSourceDiagnosticLocation {
	readonly type: 'source'
}

export interface BlueprintWidgetDiagnosticLocation<Plugins extends AnyWidgetPluginTuple = AnyWidgetPluginTuple> {
	readonly type: 'widget'
	readonly node: BlueprintWidgetNode<Plugins>
}

export interface BlueprintSlotDiagnosticLocation<Plugins extends AnyWidgetPluginTuple = AnyWidgetPluginTuple> {
	readonly type: 'slot'
	readonly node: ResolvedBlueprintWidgetNode<Plugins>
	readonly slot: WidgetMemberKey
}

export interface BlueprintSlotChildDiagnosticLocation<Plugins extends AnyWidgetPluginTuple = AnyWidgetPluginTuple> {
	readonly type: 'slot-child'
	readonly node: ResolvedBlueprintWidgetNode<Plugins>
	readonly slot: WidgetMemberKey
	readonly index: number
}

export interface BlueprintPropertyDiagnosticLocation<Plugins extends AnyWidgetPluginTuple = AnyWidgetPluginTuple> {
	readonly type: 'property'
	readonly node: ResolvedBlueprintWidgetNode<Plugins>
	readonly name: WidgetMemberKey
}

export interface BlueprintMethodDiagnosticLocation<Plugins extends AnyWidgetPluginTuple = AnyWidgetPluginTuple> {
	readonly type: 'method'
	readonly node: ResolvedBlueprintWidgetNode<Plugins>
	readonly name: WidgetMemberKey
}

export type BlueprintNodeDiagnosticLocation<Plugins extends AnyWidgetPluginTuple = AnyWidgetPluginTuple>
	= | BlueprintWidgetDiagnosticLocation<Plugins>
		| BlueprintSlotDiagnosticLocation<Plugins>
		| BlueprintSlotChildDiagnosticLocation<Plugins>
		| BlueprintPropertyDiagnosticLocation<Plugins>
		| BlueprintMethodDiagnosticLocation<Plugins>

export type BlueprintDiagnosticLocation<Plugins extends AnyWidgetPluginTuple = AnyWidgetPluginTuple>
	= | BlueprintSourceDiagnosticLocation
		| BlueprintNodeDiagnosticLocation<Plugins>

export type BlueprintStructureDiagnosticLocation<Plugins extends AnyWidgetPluginTuple = AnyWidgetPluginTuple>
	= | BlueprintWidgetDiagnosticLocation<Plugins>
		| BlueprintSlotDiagnosticLocation<Plugins>
		| BlueprintSlotChildDiagnosticLocation<Plugins>

export type BlueprintDependencyDiagnosticLocation<Plugins extends AnyWidgetPluginTuple = AnyWidgetPluginTuple>
	= | BlueprintWidgetDiagnosticLocation<Plugins>
		| BlueprintPropertyDiagnosticLocation<Plugins>
		| BlueprintMethodDiagnosticLocation<Plugins>

export type BlueprintDependencyMember
	= | { readonly type: 'property', readonly name: WidgetMemberKey }
		| { readonly type: 'method', readonly name: WidgetMemberKey }

export interface BlueprintDependencyReference {
	readonly target:
		| { readonly type: 'self' }
		| { readonly type: 'root' }
		| { readonly type: 'parent', readonly optional: boolean }
		| { readonly type: 'widget', readonly widgetId: WidgetId, readonly optional: boolean }
	readonly operation:
		| { readonly type: 'state-get', readonly key: WidgetMemberKey }
		| { readonly type: 'state-set', readonly key: WidgetMemberKey }
		| { readonly type: 'property-get', readonly name: WidgetMemberKey }
		| { readonly type: 'method-invoke', readonly name: WidgetMemberKey }
}

export type BlueprintDependencyTarget = BlueprintDependencyReference['target']
export type BlueprintDependencyOperation = BlueprintDependencyReference['operation']

type BlueprintDiagnosticRelated<Plugins extends AnyWidgetPluginTuple> = NonEmptyReadonlyArray<BlueprintNodeDiagnosticLocation<Plugins>>

export type BlueprintDefinitionDiagnostic<Plugins extends AnyWidgetPluginTuple = AnyWidgetPluginTuple>
	= | DiagnosticBase<'invalid-widget-definition', BlueprintWidgetDiagnosticLocation<Plugins>>
		| (DiagnosticBase<'invalid-widget-id', BlueprintWidgetDiagnosticLocation<Plugins>> & { readonly path: DiagnosticPath })
		| (DiagnosticBase<'duplicate-widget-id', BlueprintWidgetDiagnosticLocation<Plugins>> & { readonly path: DiagnosticPath, readonly related: BlueprintDiagnosticRelated<Plugins> })
		| (DiagnosticBase<'invalid-widget-type', BlueprintWidgetDiagnosticLocation<Plugins>> & { readonly path: DiagnosticPath })
		| (DiagnosticBase<'unknown-widget-type', BlueprintWidgetDiagnosticLocation<Plugins>> & { readonly path: DiagnosticPath })
		| (DiagnosticBase<'unexpected-widget-config', BlueprintWidgetDiagnosticLocation<Plugins>> & { readonly path: DiagnosticPath })
		| (DiagnosticBase<'invalid-widget-slots', BlueprintWidgetDiagnosticLocation<Plugins>> & { readonly path: DiagnosticPath })
		| (DiagnosticBase<'unexpected-widget-slots', BlueprintWidgetDiagnosticLocation<Plugins>> & { readonly path: DiagnosticPath })
		| (DiagnosticBase<'undeclared-widget-slot', BlueprintWidgetDiagnosticLocation<Plugins>> & { readonly path: DiagnosticPath })
		| (DiagnosticBase<'invalid-widget-slot', BlueprintWidgetDiagnosticLocation<Plugins>> & { readonly path: DiagnosticPath })
		| (DiagnosticBase<'unexpected-widget-field', BlueprintWidgetDiagnosticLocation<Plugins>> & { readonly path: DiagnosticPath })

export type BlueprintConfigDiagnostic<Plugins extends AnyWidgetPluginTuple = AnyWidgetPluginTuple> = DiagnosticBase<'invalid-widget-config', BlueprintWidgetDiagnosticLocation<Plugins>> & {
	readonly path?: DiagnosticPath
	readonly reason?: string
	/** The `details` the plugin reported with the diagnostic: a JSON value, by reference. */
	readonly details?: JsonValue
}

export type BlueprintStructureDiagnostic<Plugins extends AnyWidgetPluginTuple = AnyWidgetPluginTuple>
	= DiagnosticBase<'invalid-widget-structure', BlueprintStructureDiagnosticLocation<Plugins>> & {
		readonly related?: NonEmptyReadonlyArray<BlueprintStructureDiagnosticLocation<Plugins>>
		readonly reason?: string
		/** The `details` the validator reported with the diagnostic: a JSON value, by reference. */
		readonly details?: JsonValue
	}

export type BlueprintDependencyDiagnostic<Plugins extends AnyWidgetPluginTuple = AnyWidgetPluginTuple>
	= | (DiagnosticBase<'missing-dependency-target' | 'unresolved-dependency-target' | 'missing-dependency-capability' | 'missing-dependency-member', BlueprintDependencyDiagnosticLocation<Plugins>> & {
		readonly dependency: BlueprintDependencyReference
		readonly related?: NonEmptyReadonlyArray<BlueprintDependencyDiagnosticLocation<Plugins>>
	})
	| (DiagnosticBase<'ambiguous-dependency-target', BlueprintDependencyDiagnosticLocation<Plugins>> & {
		readonly dependency: BlueprintDependencyReference
		readonly related: NonEmptyReadonlyArray<BlueprintDependencyDiagnosticLocation<Plugins>>
	})
	| (DiagnosticBase<'property-dependency-has-side-effects', BlueprintDependencyDiagnosticLocation<Plugins>> & {
		readonly dependency: BlueprintDependencyReference
		readonly related: NonEmptyReadonlyArray<BlueprintDependencyDiagnosticLocation<Plugins>>
	})
	| (DiagnosticBase<'property-evaluation-cycle', BlueprintDependencyDiagnosticLocation<Plugins>> & {
		/** Every member of the cycle, the subject included, in member order; one array shared by all diagnostics of the cycle. */
		readonly related: NonEmptyReadonlyArray<BlueprintDependencyDiagnosticLocation<Plugins>>
	})

export type JsonCompatibilityReason
	= | 'undefined'
		| 'non-finite-number'
		| 'bigint'
		| 'symbol'
		| 'function'
		| 'unsupported-object-prototype'
		| 'symbol-key'
		| 'accessor-property'
		| 'sparse-array'
		| 'array-extra-property'
		| 'cyclic-reference'
		| 'max-depth-exceeded'

export type JsonCompatibilityDiagnostic = DiagnosticBase<'json-incompatible-value', BlueprintSourceDiagnosticLocation> & {
	readonly path: DiagnosticPath
	readonly reason: JsonCompatibilityReason
}

export type SourceAccessDiagnostic = DiagnosticBase<'source-access-failed', BlueprintSourceDiagnosticLocation> & {
	readonly path: DiagnosticPath
}

export type BlueprintSourceDiagnostic = JsonCompatibilityDiagnostic | SourceAccessDiagnostic

export type BlueprintNodeDiagnostic<Plugins extends AnyWidgetPluginTuple = AnyWidgetPluginTuple>
	= BlueprintDefinitionDiagnostic<Plugins>
		| BlueprintConfigDiagnostic<Plugins>
		| BlueprintStructureDiagnostic<Plugins>
		| BlueprintDependencyDiagnostic<Plugins>

export type BlueprintDiagnostic<Plugins extends AnyWidgetPluginTuple = AnyWidgetPluginTuple>
	= BlueprintSourceDiagnostic | BlueprintNodeDiagnostic<Plugins>

// Runtime diagnostics ---------------------------------------------------------------------------

export type RuntimePrimitiveDiagnosticLocation
	= | { readonly type: 'state', readonly widgetId: WidgetId, readonly key: WidgetMemberKey }
		| { readonly type: 'property', readonly widgetId: WidgetId, readonly name: WidgetMemberKey }
		| { readonly type: 'method', readonly widgetId: WidgetId, readonly name: WidgetMemberKey }

export interface RuntimeLevelDiagnosticLocation { readonly type: 'runtime' }
export type RuntimeDiagnosticLocation = RuntimePrimitiveDiagnosticLocation | RuntimeLevelDiagnosticLocation

export type RuntimeStateDiagnostic = DiagnosticBase<'invalid-state-value', Extract<RuntimePrimitiveDiagnosticLocation, { type: 'state' }>> & {
	readonly candidate: unknown
	readonly path?: DiagnosticPath
	readonly reason?: string
	readonly details?: JsonValue
}

export type RuntimePropertyResultDiagnostic = DiagnosticBase<'invalid-property-result', Extract<RuntimePrimitiveDiagnosticLocation, { type: 'property' }>> & {
	readonly result: unknown
	readonly path?: DiagnosticPath
	readonly reason?: string
	readonly details?: JsonValue
}

export type RuntimeMethodArgsDiagnostic = DiagnosticBase<'invalid-method-arguments', Extract<RuntimePrimitiveDiagnosticLocation, { type: 'method' }>> & {
	readonly args: readonly unknown[]
	readonly path?: DiagnosticPath
	readonly reason?: string
	readonly details?: JsonValue
}

export type RuntimeMethodResultDiagnostic = DiagnosticBase<'invalid-method-result', Extract<RuntimePrimitiveDiagnosticLocation, { type: 'method' }>> & {
	readonly result: unknown
	readonly path?: DiagnosticPath
	readonly reason?: string
	readonly details?: JsonValue
}

export type RuntimeDependencyTargetFailedDiagnostic = DiagnosticBase<'dependency-target-failed', RuntimePrimitiveDiagnosticLocation> & {
	readonly dependency: BlueprintDependencyReference
	readonly related: NonEmptyReadonlyArray<RuntimePrimitiveDiagnosticLocation>
	readonly cause: RuntimeWidgetDiagnostic
}

export type RuntimeDependencyValueRejectedDiagnostic = DiagnosticBase<'dependency-value-rejected', RuntimePrimitiveDiagnosticLocation> & {
	readonly dependency: BlueprintDependencyReference
	readonly related: NonEmptyReadonlyArray<RuntimePrimitiveDiagnosticLocation>
	readonly received: unknown
}

export type RuntimePropertyDependencyDiagnostic = (RuntimeDependencyTargetFailedDiagnostic | RuntimeDependencyValueRejectedDiagnostic) & {
	readonly location: Extract<RuntimePrimitiveDiagnosticLocation, { type: 'property' }>
}

export type RuntimeMethodDependencyDiagnostic = (RuntimeDependencyTargetFailedDiagnostic | RuntimeDependencyValueRejectedDiagnostic) & {
	readonly location: Extract<RuntimePrimitiveDiagnosticLocation, { type: 'method' }>
}

export type RuntimePropertyDiagnostic = RuntimePropertyResultDiagnostic | RuntimePropertyDependencyDiagnostic
export type RuntimeMethodDiagnostic = RuntimeMethodArgsDiagnostic | RuntimeMethodResultDiagnostic | RuntimeMethodDependencyDiagnostic
export type RuntimeLevelDiagnostic
	= | (DiagnosticBase<'invalid-state-overrides', RuntimeLevelDiagnosticLocation> & { readonly path?: DiagnosticPath, readonly reason?: string })
		| (DiagnosticBase<'unknown-state-override-widget', RuntimeLevelDiagnosticLocation> & { readonly path: DiagnosticPath, readonly reason?: string })
		| (DiagnosticBase<'unsupported-state-override-target', RuntimeLevelDiagnosticLocation> & { readonly path: DiagnosticPath, readonly reason?: string })
		| (DiagnosticBase<'invalid-state-override-fragment', RuntimeLevelDiagnosticLocation> & { readonly path: DiagnosticPath, readonly reason?: string })
		| (DiagnosticBase<'unknown-state-override-member', RuntimeLevelDiagnosticLocation> & { readonly path: DiagnosticPath, readonly reason?: string })

export type RuntimeWidgetDiagnostic = RuntimeStateDiagnostic | RuntimePropertyDiagnostic | RuntimeMethodDiagnostic
export type RuntimeDiagnostic = RuntimeLevelDiagnostic | RuntimeWidgetDiagnostic
