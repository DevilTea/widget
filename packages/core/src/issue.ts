/**
 * Diagnostic model.
 *
 * Normative source: issue #10 checkpoint C/E, amendments "Blueprint diagnostic locations and
 * dependency issue surface", "callback addIssue() relative authoring", "rename Runtime override
 * diagnostics to state-override", "Issue machine-readable contract" and consolidated handoff §7/§12.
 *
 * There is no issue-level discriminator: `source.type` is the discriminator, `related` always lives
 * inside `source`, and `message` is human-readable only (never a machine protocol).
 */

import type { BlueprintWidgetNode, ResolvedBlueprintWidgetNode } from './internal/contract'
import type { AnyWidgetPluginTuple } from './plugin'
import type { NonEmptyReadonlyArray, WidgetId, WidgetMemberKey } from './types'

/**
 * Relative diagnostic path inside an arbitrary validated value.
 *
 * Intentionally not JSON Pointer/JSONPath and intentionally wider than {@link WidgetMemberKey}
 * because it traverses arbitrary runtime payloads (including array indices).
 */
export type IssuePath = readonly PropertyKey[]

export interface Issue<Source> {
	readonly source: Source
	readonly message: string
}

/**
 * Canonical empty issue snapshot.
 *
 * Reused by identity so that a success -> success transition does not create an issue notification
 * under `alien-signals` strict inequality semantics.
 */
export const EMPTY_ISSUES: readonly never[] = Object.freeze([])

/**
 * Thrown by every live Runtime query/operation and by every new subscription after
 * `runtime.dispose()`. `instanceof` is the stable machine discriminator; the message is not.
 */
export class WidgetSystemRuntimeDisposedError extends Error {
	override readonly name = 'WidgetSystemRuntimeDisposedError'

	constructor(message = 'The widget system runtime has been disposed.') {
		super(message)
	}
}

// -------------------------------------------------------------------------------------------------
// Callback-authored (relative) issue inputs
// -------------------------------------------------------------------------------------------------

/**
 * Relative value diagnostic authored by `config.validate`, `state.validate`, `method.validateArgs`,
 * `property.compute` and `method.execute`. The framework injects absolute ownership/payload fields.
 */
export interface RelativeValueIssueInput {
	readonly message: string
	readonly path?: IssuePath
}

/**
 * Slot-level `validateStructure` input. Current widget and current slot are implicit; the input may
 * identify either the slot itself or one child index.
 */
export interface RelativeSlotStructureIssueInput {
	readonly message: string
	readonly index?: number
}

/**
 * Plugin-level `validateStructure` input. Current widget is implicit; the input may identify the
 * widget, a slot, or a slot child index.
 */
export type RelativePluginStructureIssueInput<SlotName extends WidgetMemberKey = WidgetMemberKey>
	= | {
		readonly message: string
	}
	| {
		readonly message: string
		readonly slot: SlotName
	}
	| {
		readonly message: string
		readonly slot: SlotName
		readonly index: number
	}

/**
 * System-level `validateStructure` input. No implicit current widget, so the location is explicit.
 */
export interface RelativeSystemStructureIssueInput<Plugins extends AnyWidgetPluginTuple = AnyWidgetPluginTuple> {
	readonly message: string
	readonly location: BlueprintStructureIssueLocation<Plugins>
	readonly related?: NonEmptyReadonlyArray<BlueprintStructureIssueLocation<Plugins>>
}

/**
 * Callback-facing local issue collector. `hasAnyIssue()` observes only the current
 * callback/operation-local collector, never a previous snapshot or global diagnostics.
 */
export interface IssueCollector<Input> {
	addIssue: (issue: Input) => void
	hasAnyIssue: () => boolean
}

// -------------------------------------------------------------------------------------------------
// Blueprint diagnostic locations
// -------------------------------------------------------------------------------------------------

export interface BlueprintWidgetIssueLocation<Plugins extends AnyWidgetPluginTuple = AnyWidgetPluginTuple> {
	readonly type: 'widget'
	readonly node: BlueprintWidgetNode<Plugins>
}

export interface BlueprintSlotIssueLocation<Plugins extends AnyWidgetPluginTuple = AnyWidgetPluginTuple> {
	readonly type: 'slot'
	readonly node: ResolvedBlueprintWidgetNode<Plugins>
	readonly slot: WidgetMemberKey
}

export interface BlueprintSlotChildIssueLocation<Plugins extends AnyWidgetPluginTuple = AnyWidgetPluginTuple> {
	readonly type: 'slot-child'
	readonly node: ResolvedBlueprintWidgetNode<Plugins>
	readonly slot: WidgetMemberKey
	readonly index: number
}

export interface BlueprintPropertyIssueLocation<Plugins extends AnyWidgetPluginTuple = AnyWidgetPluginTuple> {
	readonly type: 'property'
	readonly node: ResolvedBlueprintWidgetNode<Plugins>
	readonly name: WidgetMemberKey
}

export interface BlueprintMethodIssueLocation<Plugins extends AnyWidgetPluginTuple = AnyWidgetPluginTuple> {
	readonly type: 'method'
	readonly node: ResolvedBlueprintWidgetNode<Plugins>
	readonly name: WidgetMemberKey
}

export type BlueprintIssueLocation<Plugins extends AnyWidgetPluginTuple = AnyWidgetPluginTuple>
	= | BlueprintWidgetIssueLocation<Plugins>
		| BlueprintSlotIssueLocation<Plugins>
		| BlueprintSlotChildIssueLocation<Plugins>
		| BlueprintPropertyIssueLocation<Plugins>
		| BlueprintMethodIssueLocation<Plugins>

/**
 * Locations that can participate in structure diagnostics.
 */
export type BlueprintStructureIssueLocation<Plugins extends AnyWidgetPluginTuple = AnyWidgetPluginTuple>
	= | BlueprintWidgetIssueLocation<Plugins>
		| BlueprintSlotIssueLocation<Plugins>
		| BlueprintSlotChildIssueLocation<Plugins>

/**
 * Locations that can participate in dependency diagnostics.
 */
export type BlueprintDependencyIssueLocation<Plugins extends AnyWidgetPluginTuple = AnyWidgetPluginTuple>
	= | BlueprintWidgetIssueLocation<Plugins>
		| BlueprintPropertyIssueLocation<Plugins>
		| BlueprintMethodIssueLocation<Plugins>

// -------------------------------------------------------------------------------------------------
// Blueprint issue sources
// -------------------------------------------------------------------------------------------------

/**
 * Owner member of a dependency diagnostic.
 */
export type BlueprintDependencyMember
	= | {
		readonly type: 'property'
		readonly name: WidgetMemberKey
	}
	| {
		readonly type: 'method'
		readonly name: WidgetMemberKey
	}

/**
 * Stable public description of one declared dependency expression.
 *
 * Deliberately excludes `.validate()` refinements, nested `RegisteredDeps` container placement,
 * internal node ids, the opaque fluent expression object, and Runtime objects.
 */
export interface BlueprintDependencyReference {
	readonly target:
		| { readonly type: 'self' }
		| { readonly type: 'root' }
		| {
			readonly type: 'parent'
			readonly optional: boolean
		}
		| {
			readonly type: 'widget'
			readonly widgetId: WidgetId
			readonly optional: boolean
		}

	readonly operation:
		| {
			readonly type: 'state-get'
			readonly key: WidgetMemberKey
		}
		| {
			readonly type: 'state-set'
			readonly key: WidgetMemberKey
		}
		| {
			readonly type: 'property-get'
			readonly name: WidgetMemberKey
		}
		| {
			readonly type: 'method-invoke'
			readonly name: WidgetMemberKey
		}
}

export type BlueprintDependencyTarget = BlueprintDependencyReference['target']

export type BlueprintDependencyOperation = BlueprintDependencyReference['operation']

/**
 * Malformed widget identity/shape/capability document problems. `path` is relative to that node's
 * `rawDefinition`.
 */
export interface BlueprintDefinitionIssueSource<Plugins extends AnyWidgetPluginTuple = AnyWidgetPluginTuple> {
	readonly type: 'definition'
	readonly node: BlueprintWidgetNode<Plugins>
	readonly path?: IssuePath
	readonly related?: NonEmptyReadonlyArray<BlueprintWidgetIssueLocation<Plugins>>
}

/**
 * Plugin config validation diagnostics. Only reachable once plugin identity is resolved.
 */
export interface BlueprintConfigIssueSource<Plugins extends AnyWidgetPluginTuple = AnyWidgetPluginTuple> {
	readonly type: 'config'
	readonly node: ResolvedBlueprintWidgetNode<Plugins>
	readonly input: unknown
	readonly path?: IssuePath
	readonly related?: NonEmptyReadonlyArray<BlueprintWidgetIssueLocation<Plugins>>
}

/**
 * Current semantic structure validation diagnostics.
 *
 * The primary location is a true union of widget / widget + slot / widget + slot + index, so an
 * `index` without a `slot` is structurally impossible.
 */
export type BlueprintStructureIssueSource<Plugins extends AnyWidgetPluginTuple = AnyWidgetPluginTuple>
	= | {
		readonly type: 'structure'
		readonly node: ResolvedBlueprintWidgetNode<Plugins>
		readonly related?: NonEmptyReadonlyArray<BlueprintStructureIssueLocation<Plugins>>
	}
	| {
		readonly type: 'structure'
		readonly node: ResolvedBlueprintWidgetNode<Plugins>
		readonly slot: WidgetMemberKey
		readonly related?: NonEmptyReadonlyArray<BlueprintStructureIssueLocation<Plugins>>
	}
	| {
		readonly type: 'structure'
		readonly node: ResolvedBlueprintWidgetNode<Plugins>
		readonly slot: WidgetMemberKey
		readonly index: number
		readonly related?: NonEmptyReadonlyArray<BlueprintStructureIssueLocation<Plugins>>
	}

/**
 * Dependency resolution, Property purity and Property-containing evaluation-cycle diagnostics.
 *
 * `dependency` is present for diagnostics tied to one concrete direct dependency reference and
 * absent for SCC-oriented cycle diagnostics.
 */
export interface BlueprintDependencyIssueSource<Plugins extends AnyWidgetPluginTuple = AnyWidgetPluginTuple> {
	readonly type: 'dependency'
	readonly node: ResolvedBlueprintWidgetNode<Plugins>
	readonly member: BlueprintDependencyMember
	readonly dependency?: BlueprintDependencyReference
	readonly related?: NonEmptyReadonlyArray<BlueprintDependencyIssueLocation<Plugins>>
}

export type BlueprintIssueSource<Plugins extends AnyWidgetPluginTuple = AnyWidgetPluginTuple>
	= | BlueprintDefinitionIssueSource<Plugins>
		| BlueprintConfigIssueSource<Plugins>
		| BlueprintStructureIssueSource<Plugins>
		| BlueprintDependencyIssueSource<Plugins>

export type BlueprintIssue<Plugins extends AnyWidgetPluginTuple = AnyWidgetPluginTuple> = Issue<BlueprintIssueSource<Plugins>>

/**
 * All Blueprint issues are node-local because even malformed input has a recovered root.
 */
export type BlueprintNodeIssue<Plugins extends AnyWidgetPluginTuple = AnyWidgetPluginTuple> = BlueprintIssue<Plugins>

// -------------------------------------------------------------------------------------------------
// Runtime issue sources
// -------------------------------------------------------------------------------------------------

/**
 * Direct primitive semantic location. Never a Runtime object reference and never a recursive copy of
 * the target's issue tree.
 */
export type RuntimeIssueLocation
	= | {
		readonly type: 'state'
		readonly widgetId: WidgetId
		readonly key: WidgetMemberKey
	}
	| {
		readonly type: 'property'
		readonly widgetId: WidgetId
		readonly name: WidgetMemberKey
	}
	| {
		readonly type: 'method'
		readonly widgetId: WidgetId
		readonly name: WidgetMemberKey
	}

export interface RuntimeStateValidationIssueSource {
	readonly type: 'state-validation'
	readonly widgetId: WidgetId
	readonly key: WidgetMemberKey
	readonly candidate: unknown
	readonly path?: IssuePath
}

export interface RuntimePropertyResultIssueSource {
	readonly type: 'property-result'
	readonly widgetId: WidgetId
	readonly name: WidgetMemberKey
	readonly result: unknown
	readonly path?: IssuePath
}

/**
 * Consumer-local dependency diagnostic owned by a Property.
 *
 * `received` carries the value rejected by a consumer `.validate()` refinement; wrapped target
 * failures preserve the target message and point at the direct target primitive through `related`.
 */
export interface RuntimePropertyDependencyIssueSource {
	readonly type: 'property-dependency'
	readonly widgetId: WidgetId
	readonly name: WidgetMemberKey
	readonly dependency: BlueprintDependencyReference
	readonly received?: unknown
	readonly related?: NonEmptyReadonlyArray<RuntimeIssueLocation>
}

export interface RuntimeMethodArgsIssueSource {
	readonly type: 'method-args'
	readonly widgetId: WidgetId
	readonly name: WidgetMemberKey
	readonly args: readonly unknown[]
	readonly path?: IssuePath
}

export interface RuntimeMethodResultIssueSource {
	readonly type: 'method-result'
	readonly widgetId: WidgetId
	readonly name: WidgetMemberKey
	readonly result: unknown
	readonly path?: IssuePath
}

/**
 * Consumer-local dependency diagnostic owned by a Method.
 */
export interface RuntimeMethodDependencyIssueSource {
	readonly type: 'method-dependency'
	readonly widgetId: WidgetId
	readonly name: WidgetMemberKey
	readonly dependency: BlueprintDependencyReference
	readonly received?: unknown
	readonly related?: NonEmptyReadonlyArray<RuntimeIssueLocation>
}

/**
 * Runtime-level `overrideStateDefaults` topology/shape diagnostics.
 *
 * A candidate for a known state member that fails `state.validate` stays an ordinary
 * `state-validation` issue and is never duplicated here.
 */
export type RuntimeStateOverrideIssueSource
	= | {
		readonly type: 'state-override'
	}
	| {
		readonly type: 'state-override'
		readonly widgetId: WidgetId
	}
	| {
		readonly type: 'state-override'
		readonly widgetId: WidgetId
		readonly key: WidgetMemberKey
	}

export type RuntimeStateIssue = Issue<RuntimeStateValidationIssueSource>

export type RuntimePropertyDependencyIssue = Issue<RuntimePropertyDependencyIssueSource>

export type RuntimeMethodDependencyIssue = Issue<RuntimeMethodDependencyIssueSource>

export type RuntimePropertyIssue = Issue<RuntimePropertyResultIssueSource | RuntimePropertyDependencyIssueSource>

export type RuntimeMethodIssue = Issue<RuntimeMethodArgsIssueSource | RuntimeMethodResultIssueSource | RuntimeMethodDependencyIssueSource>

/**
 * Runtime-level issues, i.e. diagnostics without a natural primitive owner.
 */
export type RuntimeLevelIssue = Issue<RuntimeStateOverrideIssueSource>

/**
 * Aggregate Runtime diagnostic snapshot element.
 */
export type WidgetSystemRuntimeIssue
	= | RuntimeLevelIssue
		| RuntimeStateIssue
		| RuntimePropertyIssue
		| RuntimeMethodIssue
