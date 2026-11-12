/**
 * Plugin semantic contract and the ordered capability-phase builder.
 *
 * Normative contract: DevilTea/widget Discussion #12, Core composition architecture topic. Historical source (migrated): diagnostic #10 checkpoint A/B/C/D, amendments "reconciliation audit",
 * "WidgetMemberKey domain", "builder completion typestate and finite member-key universe" and
 * consolidated handoff §2/§3/§4.
 */

import type { JSONSchema as Draft202012JSONSchema } from 'json-schema-typed/draft-2020-12'
import type { DependencyBuilder, DependencyConsumer, EmptyRegisteredDeps, RegisteredDeps, ToExecutedDeps } from './dep'
import type {
	DiagnosticCollector,
	RelativePluginStructureDiagnosticInput,
	RelativeSlotStructureDiagnosticInput,
	RelativeValueDiagnosticInput,
} from './diagnostic'
import type {
	BlueprintCompileView,
	BlueprintRuntimeView,
	BlueprintWidgetNodeView,
	SelfBlueprintWidgetNode,
	SelfBlueprintWidgetNodeView,
} from './internal/contract'
import type {
	HasWidgetCapability,
	WidgetEventArgsOf,
	WidgetEventKeyOf,
	WidgetInterfaces,
	WidgetInterfacesViolationOf,
	WidgetMemberKey,
	WidgetMethodArgsOf,
	WidgetMethodKeyOf,
	WidgetMethodReturnOf,
	WidgetPropertyKeyOf,
	WidgetPropertyValueOf,
	WidgetRawConfigOf,
	WidgetResolvedConfigOf,
	WidgetSlotNameOf,
	WidgetStateKeyOf,
	WidgetStateValueOf,
} from './types'
import { createReadonlyMap } from './readonly-map'

/**
 * Framework-private brand carrying the plugin's phantom interfaces and its erased definition record.
 */
export const widgetPluginBrand: unique symbol = Symbol('@deviltea/widget-core:widget-plugin')

/**
 * Framework-private section typestate markers.
 *
 * They exist so that an empty mapped object (`{}`) cannot accidentally satisfy a completed section
 * type. They are never user-facing operations.
 */
export const widgetSectionKind: unique symbol = Symbol('@deviltea/widget-core:widget-section-kind')
export const widgetSectionRemaining: unique symbol = Symbol('@deviltea/widget-core:widget-section-remaining')

declare const widgetValueContractType: unique symbol

/**
 * Passive, runtime-readable semantic value-contract descriptor.
 *
 * The generic parameter exists only for Plugin-author type safety. Runtime/integration identity is the
 * stable string `id`; descriptor object identity has no semantic meaning.
 *
 * A contract for `Value` describes every value of that type, so it can be attached to a Property whose
 * value type is the same or narrower (every value the Property produces satisfies the contract):
 * `WidgetValueContract<string>` fits a `'small' | 'large'` Property, but not a `string | null` one.
 */
export interface WidgetValueContract<Value> {
	readonly id: string
	/**
	 * Type-only contravariant brand (`WidgetValueContract<Wide>` is assignable to
	 * `WidgetValueContract<Narrow>`); the factory-created runtime descriptor contains only `id`.
	 */
	readonly [widgetValueContractType]: (value: Value) => void
}

/**
 * Declares a stable semantic value-contract id while retaining the associated TypeScript value type for
 * Plugin-author checking. Core does not interpret, register, validate, or schema-check contract ids.
 */
export function createWidgetValueContract<Value>(id: string): WidgetValueContract<Value> {
	return Object.freeze({ id }) as WidgetValueContract<Value>
}

// -------------------------------------------------------------------------------------------------
// Erased definition records (framework-internal, consumed by Blueprint/Runtime)
// -------------------------------------------------------------------------------------------------

type DeepReadonlySchema<T> = T extends readonly (infer Item)[]
	? readonly DeepReadonlySchema<Item>[]
	: T extends object
		? { readonly [Key in keyof T]: DeepReadonlySchema<T[Key]> }
		: T

export type WidgetConfigJsonSchema = DeepReadonlySchema<Draft202012JSONSchema>

export const WIDGET_CONFIG_JSON_SCHEMA_DIALECT = 'https://json-schema.org/draft/2020-12/schema' as const

export interface ErasedWidgetConfigDefinition {
	readonly description: string
	readonly schema: WidgetConfigJsonSchema | null
	readonly validate: (input: unknown, ctx: any) => boolean
	readonly resolve: (rawConfig: any) => unknown
}

export interface ErasedWidgetSlotDefinition {
	readonly description: string
	readonly validateStructure?: (ctx: any) => void
}

export interface ErasedWidgetStateMemberDefinition {
	readonly authorWritable?: boolean
	readonly validate: (input: unknown, ctx: any) => boolean
	readonly default?: (ctx: any) => unknown
}

export interface ErasedWidgetPropertyDefinition {
	readonly valueContract?: { readonly id: string }
	readonly registerDeps?: (ctx: any) => RegisteredDeps
	readonly compute: (ctx: any) => unknown
}

export interface ErasedWidgetMethodDefinition {
	readonly registerDeps?: (ctx: any) => RegisteredDeps
	readonly validateArgs: (args: readonly unknown[], ctx: any) => boolean
	readonly execute: (ctx: any) => unknown
}

export interface ErasedWidgetEventDefinition {
	readonly description: string
}

/**
 * Erased plugin definition record.
 *
 * `null` means the capability was not declared. Member registries are `Map`s so that declaration
 * order is preserved and special JavaScript names (`constructor`, `__proto__`, ...) stay safe.
 */
export interface WidgetPluginDefinition {
	readonly type: string
	readonly description: string
	readonly config: ErasedWidgetConfigDefinition | null
	readonly slots: ReadonlyMap<WidgetMemberKey, ErasedWidgetSlotDefinition> | null
	readonly validateStructure: ((ctx: any) => void) | null
	readonly state: ReadonlyMap<WidgetMemberKey, ErasedWidgetStateMemberDefinition> | null
	readonly properties: ReadonlyMap<WidgetMemberKey, ErasedWidgetPropertyDefinition> | null
	readonly methods: ReadonlyMap<WidgetMemberKey, ErasedWidgetMethodDefinition> | null
	readonly events: ReadonlyMap<WidgetMemberKey, ErasedWidgetEventDefinition> | null
}

export interface WidgetPluginBrand<Interfaces extends WidgetInterfaces> {
	readonly interfaces?: Interfaces
	readonly definition: WidgetPluginDefinition
}

/**
 * Renderer-agnostic runtime-readable capability-presence facts (diagnostic #10 amendment
 * "declaration-presence semantics and public `WidgetPlugin.capabilities`"). Presence booleans only — no
 * member inventories, callbacks, Blueprint state, Runtime state, diagnostics, or renderer concerns. Not
 * an inspection/DevTools API: consumers that already hold the exact plugin object (e.g. a renderer
 * adapter's `useWidget(plugin)`) read this instead of inferring presence from Blueprint object shape or
 * importing `@deviltea/widget-core/inspection`. The shape intentionally matches
 * `BlueprintInspectionCapabilities`, but no object-identity relationship between the two is part of the
 * contract.
 */
export interface WidgetPluginCapabilities {
	readonly config: boolean
	readonly slots: boolean
	readonly state: boolean
	readonly properties: boolean
	readonly methods: boolean
	readonly events: boolean
}

/** Passive RawConfig authoring metadata of a plugin with a config capability. */
export interface WidgetPluginConfigMetadata {
	readonly description: string
	readonly schema: WidgetConfigJsonSchema | null
}

/**
 * A completed plugin. Plugin-specific integration options are captured by the plugin factory's
 * closure; there is no `pluginConfig` / `globalConfig`.
 *
 * A completed plugin is immutable: `done()` freezes it, every section builder is sealed once its build
 * callback returns, and every config, slot and member definition was captured by value when declared,
 * so neither a retained builder section nor later mutation of the author's definition objects changes it.
 */
export interface WidgetPlugin<
	Type extends string = string,
	Interfaces extends WidgetInterfaces = WidgetInterfaces,
> {
	readonly type: Type
	readonly description: string
	/** Compiler/plugin-builder-authoritative declaration-presence facts. Immutable, stable for the plugin's lifetime. */
	readonly capabilities: WidgetPluginCapabilities
	/** Passive RawConfig authoring metadata. Null means no config capability. */
	readonly config: WidgetPluginConfigMetadata | null
	readonly descriptions: {
		readonly config: string | null
		readonly slots: ReadonlyMap<WidgetMemberKey, string> | null
	}
	readonly [widgetPluginBrand]: WidgetPluginBrand<Interfaces>
}

export type AnyWidgetPlugin = WidgetPlugin<string, WidgetInterfaces>

export type AnyWidgetPluginTuple = readonly AnyWidgetPlugin[]

export type WidgetPluginTypeOf<Plugin extends AnyWidgetPlugin> = Plugin extends WidgetPlugin<infer Type, any>
	? Type
	: never

export type WidgetInterfacesOf<Plugin extends AnyWidgetPlugin> = Plugin extends WidgetPlugin<any, infer Interfaces>
	? Interfaces
	: never

/**
 * Provenance probe: true only for plugins completed by this loaded module instance. A plugin from
 * another module instance (its brand is a different Symbol) or a structural look-alike is foreign.
 * Capability separation, not a security sandbox.
 */
export function isCoreWidgetPlugin(value: unknown): value is AnyWidgetPlugin {
	if (typeof value !== 'object' || value === null)
		return false
	const brand = (value as Partial<Record<typeof widgetPluginBrand, { readonly definition?: unknown }>>)[widgetPluginBrand]
	return typeof brand === 'object' && brand !== null && typeof brand.definition === 'object' && brand.definition !== null
}

/**
 * Reads the erased definition record of a plugin.
 */
export function readWidgetPluginDefinition(plugin: AnyWidgetPlugin): WidgetPluginDefinition {
	return plugin[widgetPluginBrand].definition
}

// -------------------------------------------------------------------------------------------------
// Callback contexts
// -------------------------------------------------------------------------------------------------

/**
 * Conditional resolved-config context fragment. Resolves to `unknown` (an intersection identity)
 * when the plugin has no config capability.
 */
export type WidgetResolvedConfigContext<Interfaces extends WidgetInterfaces> = HasWidgetCapability<Interfaces, 'config'> extends true
	? {
			readonly config: WidgetResolvedConfigOf<Interfaces>
		}
	: unknown

export type WidgetConfigValidateContext = DiagnosticCollector<RelativeValueDiagnosticInput>

export type WidgetStateValidateContext<Interfaces extends WidgetInterfaces>
	= & DiagnosticCollector<RelativeValueDiagnosticInput>
		& WidgetResolvedConfigContext<Interfaces>

export type WidgetStateDefaultContext<Interfaces extends WidgetInterfaces> = WidgetResolvedConfigContext<Interfaces>

export type WidgetMethodValidateArgsContext<Interfaces extends WidgetInterfaces>
	= & DiagnosticCollector<RelativeValueDiagnosticInput>
		& WidgetResolvedConfigContext<Interfaces>

export type WidgetSlotValidateStructureContext<
	Interfaces extends WidgetInterfaces,
	SlotName extends WidgetMemberKey,
>
	= & {
		readonly widget: SelfBlueprintWidgetNodeView<Interfaces>
		readonly slot: SlotName
		readonly children: readonly BlueprintWidgetNodeView[]
		readonly blueprint: BlueprintCompileView
	}
	& DiagnosticCollector<RelativeSlotStructureDiagnosticInput>
	& WidgetResolvedConfigContext<Interfaces>

export type WidgetPluginValidateStructureContext<Interfaces extends WidgetInterfaces>
	= & {
		readonly widget: SelfBlueprintWidgetNodeView<Interfaces>
		readonly blueprint: BlueprintCompileView
	}
	& DiagnosticCollector<RelativePluginStructureDiagnosticInput<WidgetSlotNameOf<Interfaces>>>
	& WidgetResolvedConfigContext<Interfaces>

/**
 * `registerDeps` runs once per Blueprint snapshot. It sees the compile semantic view and resolved
 * config, and has no runtime values and no diagnostic collector.
 */
export type WidgetRegisterDepsContext<
	Interfaces extends WidgetInterfaces,
	Consumer extends DependencyConsumer,
>
	= & {
		readonly widget: SelfBlueprintWidgetNodeView<Interfaces>
		readonly blueprint: BlueprintCompileView
		readonly dep: DependencyBuilder<Interfaces, Consumer>
	}
	& WidgetResolvedConfigContext<Interfaces>

export type WidgetPropertyComputeContext<
	Interfaces extends WidgetInterfaces,
	Deps extends RegisteredDeps,
>
	= & {
		readonly widget: SelfBlueprintWidgetNode<Interfaces>
		readonly blueprint: BlueprintRuntimeView
		readonly deps: ToExecutedDeps<Deps, 'property'>
	}
	& DiagnosticCollector<RelativeValueDiagnosticInput>
	& WidgetResolvedConfigContext<Interfaces>

export type WidgetEventEmitter<Interfaces extends WidgetInterfaces> = {
	readonly [Name in WidgetEventKeyOf<Interfaces>]: (...args: WidgetEventArgsOf<Interfaces, Name>) => void
}

export type WidgetEventEmitterContext<Interfaces extends WidgetInterfaces> = HasWidgetCapability<Interfaces, 'events'> extends true
	? { readonly emit: WidgetEventEmitter<Interfaces> }
	: unknown

export type WidgetMethodExecuteContext<
	Interfaces extends WidgetInterfaces,
	Name extends WidgetMemberKey,
	Deps extends RegisteredDeps,
>
	= & {
		readonly args: WidgetMethodArgsOf<Interfaces, Name>
		readonly widget: SelfBlueprintWidgetNode<Interfaces>
		readonly blueprint: BlueprintRuntimeView
		readonly deps: ToExecutedDeps<Deps, 'method'>
	}
	& DiagnosticCollector<RelativeValueDiagnosticInput>
	& WidgetResolvedConfigContext<Interfaces>
	& WidgetEventEmitterContext<Interfaces>

// -------------------------------------------------------------------------------------------------
// Synchronous results
// -------------------------------------------------------------------------------------------------

type IsAny<T> = 0 extends 1 & T ? true : false

type IsExactlyVoid<T> = (<X>() => X extends T ? 1 : 2) extends (<X>() => X extends void ? 1 : 2) ? true : false

/**
 * Whether `Value` can be a thenable: anything with a callable `then`, which is what the runtime guard
 * rejects (not only a native `PromiseLike`). An object whose `then` is not a function is not one. For a
 * value of a type parameter the check stays deferred, which TypeScript accepts.
 */
type MayBeThenable<Value> = [Extract<Value, { readonly then: (...args: never) => unknown }>] extends [never] ? false : true

/**
 * What a thenable result is checked against. The `then` text is the compile-error message; no callable
 * `then` satisfies it.
 */
interface WidgetSynchronousResultViolation {
	readonly then: 'widget-core: semantic callbacks are synchronous; returning a PromiseLike/thenable is a contract violation'
}

/**
 * The return type a semantic callback is checked against, given `Result`, the callback's own return type:
 * `Result` itself unless it can be a thenable. A `void` (or `unknown`) return type cannot do this on its own:
 * TypeScript lets a `void`-returning function type accept any function, an `async` one included, and every
 * value is assignable to `unknown`. Gating on the callback's own return type rejects a thenable while every
 * synchronous value — an `unknown`-typed expression, a value of a type parameter, an object whose `then` is
 * not a function — still type-checks.
 *
 * `Result` is inferred where the callback is written into the builder (a Method's `execute`, a slot's or the
 * plugin's `validateStructure`) or into `createWidgetSystem`'s options. A standalone definition type has no
 * callback to infer from, so `Result` defaults to `unknown` and it accepts any return: a thenable reaching
 * Core through a callback typed only by such an annotation is caught by the runtime guard instead, which
 * throws a `TypeError`.
 */
export type WidgetSynchronousResult<Result> = Result & (MayBeThenable<Result> extends true ? WidgetSynchronousResultViolation : unknown)

/**
 * `execute`'s return type for the declared Method return `Declared`. A declared type a thenable is
 * assignable to — exactly `void`, `unknown`, `{}`, `object` — gates on the `execute`'s own return type
 * `Result` (see {@link WidgetSynchronousResult}); any other declared type already rejects a PromiseLike (see
 * `WidgetInterfacesViolationOf`). `any` stays unchecked.
 */
type WidgetMethodExecuteResult<Declared, Result> = IsAny<Declared> extends true
	? Declared
	: IsExactlyVoid<Declared> extends true
		? WidgetSynchronousResult<Result>
		: PromiseLike<unknown> extends Declared
			? Declared & WidgetSynchronousResult<Result>
			: Declared

// -------------------------------------------------------------------------------------------------
// Member declarations
// -------------------------------------------------------------------------------------------------

export interface WidgetConfigDefinition<Interfaces extends WidgetInterfaces> {
	readonly description: string
	/** Passive Draft 2020-12 authoring metadata. Core does not validate or execute this schema. */
	readonly schema?: WidgetConfigJsonSchema
	readonly validate: (input: unknown, ctx: WidgetConfigValidateContext) => input is WidgetRawConfigOf<Interfaces>
	readonly resolve: (rawConfig: WidgetRawConfigOf<Interfaces> | null) => WidgetResolvedConfigOf<Interfaces>
}

/** `Result` is the slot validator's own return type (see {@link WidgetSynchronousResult}). */
export interface WidgetSlotDefinition<
	Interfaces extends WidgetInterfaces,
	SlotName extends WidgetMemberKey,
	Result = unknown,
> {
	readonly description: string
	readonly validateStructure?: (ctx: WidgetSlotValidateStructureContext<Interfaces, SlotName>) => WidgetSynchronousResult<Result>
}

export type WidgetSlotDefinitions<Interfaces extends WidgetInterfaces> = {
	readonly [Name in WidgetSlotNameOf<Interfaces>]: WidgetSlotDefinition<Interfaces, Name>
}

/** The return type of the `validateStructure` a slots object declares for `Name`, or `unknown`. */
type WidgetSlotStructureResultOf<Definitions, Name extends PropertyKey> = Definitions extends { readonly [Key in Name]: { readonly validateStructure?: (...args: never) => infer Result } }
	? Result
	: unknown

/**
 * Rejects a slots object that carries a slot the interfaces never declared, including when the
 * object is supplied through a variable instead of a fresh object literal, and a slot validator that
 * returns a thenable.
 */
export type ExactWidgetSlotDefinitions<Interfaces extends WidgetInterfaces, Definitions>
	= & {
		readonly [Name in WidgetSlotNameOf<Interfaces>]: WidgetSlotDefinition<Interfaces, Name, WidgetSlotStructureResultOf<Definitions, Name>>
	}
	& {
		readonly [Name in keyof Definitions as Name extends WidgetSlotNameOf<Interfaces> ? never : Name]: never
	}

/** `Result` is the validator's own return type (see {@link WidgetSynchronousResult}). */
export type WidgetPluginValidateStructure<Interfaces extends WidgetInterfaces, Result = unknown> = (ctx: WidgetPluginValidateStructureContext<Interfaces>) => WidgetSynchronousResult<Result>

export interface WidgetStateMemberDefinition<
	Interfaces extends WidgetInterfaces,
	Key extends WidgetMemberKey,
> {
	/** Passive authoring policy. Omitted means this State member is not author-writable. */
	readonly authorWritable?: boolean
	readonly validate: (input: unknown, ctx: WidgetStateValidateContext<Interfaces>) => input is WidgetStateValueOf<Interfaces, Key>
	readonly default?: (ctx: WidgetStateDefaultContext<Interfaces>) => WidgetStateValueOf<Interfaces, Key>
}

export interface WidgetPropertyDefinition<
	Interfaces extends WidgetInterfaces,
	Name extends WidgetMemberKey,
	Deps extends RegisteredDeps,
> {
	/** Passive semantic value contract for integration/tooling inspection. */
	readonly valueContract?: WidgetValueContract<WidgetPropertyValueOf<Interfaces, Name>>
	readonly registerDeps?: (ctx: WidgetRegisterDepsContext<Interfaces, 'property'>) => Deps
	readonly compute: (ctx: WidgetPropertyComputeContext<Interfaces, Deps>) => WidgetPropertyValueOf<Interfaces, Name>
}

/** `Result` is `execute`'s own return type (see {@link WidgetMethodExecuteResult}). */
export interface WidgetMethodDefinition<
	Interfaces extends WidgetInterfaces,
	Name extends WidgetMemberKey,
	Deps extends RegisteredDeps,
	Result = unknown,
> {
	readonly registerDeps?: (ctx: WidgetRegisterDepsContext<Interfaces, 'method'>) => Deps
	readonly validateArgs: (args: readonly unknown[], ctx: WidgetMethodValidateArgsContext<Interfaces>) => args is WidgetMethodArgsOf<Interfaces, Name>
	readonly execute: (ctx: WidgetMethodExecuteContext<Interfaces, Name, Deps>) => WidgetMethodExecuteResult<WidgetMethodReturnOf<Interfaces, Name>, Result>
}

export interface WidgetEventDefinition {
	readonly description: string
}

// -------------------------------------------------------------------------------------------------
// Section keyed-chain typestate
// -------------------------------------------------------------------------------------------------

/**
 * Phantom section typestate. `Remaining` is part of the marker type, so a section is complete only
 * when `Remaining` has been reduced to `never`.
 */
export interface WidgetSectionMarker<Kind extends string, Remaining extends WidgetMemberKey> {
	readonly [widgetSectionKind]: Kind
	readonly [widgetSectionRemaining]: Remaining
}

export type WidgetStateSection<
	Interfaces extends WidgetInterfaces,
	Remaining extends WidgetStateKeyOf<Interfaces>,
>
	= & WidgetSectionMarker<'state', Remaining>
		& {
			[Key in Remaining]: (
				definition: WidgetStateMemberDefinition<Interfaces, Key>,
			) => WidgetStateSection<Interfaces, Exclude<Remaining, Key>>
		}

export type WidgetPropertiesSection<
	Interfaces extends WidgetInterfaces,
	Remaining extends WidgetPropertyKeyOf<Interfaces>,
>
	= & WidgetSectionMarker<'properties', Remaining>
		& {
			[Name in Remaining]: <const Deps extends RegisteredDeps = EmptyRegisteredDeps>(
				definition: WidgetPropertyDefinition<Interfaces, Name, Deps>,
			) => WidgetPropertiesSection<Interfaces, Exclude<Remaining, Name>>
		}

export type WidgetMethodsSection<
	Interfaces extends WidgetInterfaces,
	Remaining extends WidgetMethodKeyOf<Interfaces>,
>
	= & WidgetSectionMarker<'methods', Remaining>
		& {
			[Name in Remaining]: <const Deps extends RegisteredDeps = EmptyRegisteredDeps, Result = unknown>(
				definition: WidgetMethodDefinition<Interfaces, Name, Deps, Result>,
			) => WidgetMethodsSection<Interfaces, Exclude<Remaining, Name>>
		}

export type WidgetEventsSection<
	Interfaces extends WidgetInterfaces,
	Remaining extends WidgetEventKeyOf<Interfaces>,
>
	= & WidgetSectionMarker<'events', Remaining>
		& {
			[Name in Remaining]: (
				definition: WidgetEventDefinition,
			) => WidgetEventsSection<Interfaces, Exclude<Remaining, Name>>
		}

// -------------------------------------------------------------------------------------------------
// Outer capability-phase typestate
// -------------------------------------------------------------------------------------------------

/**
 * Returned instead of the next builder phase when the supplied `WidgetInterfaces` is outside the
 * supported declaration domain. It exposes no builder operation, so the chain cannot continue.
 */
export interface WidgetInterfacesViolation<Reason extends string> {
	readonly 'widget-core: unsupported WidgetInterfaces': Reason
}

export interface WidgetPluginDonePhase<Type extends string, Interfaces extends WidgetInterfaces> {
	done: () => WidgetPlugin<Type, Interfaces>
}

/**
 * Outer builder phases in their fixed call order: every capability phase plus the optional,
 * capability-independent `structure` phase. Part of the type-level order diagnostics only; the runtime
 * builder is order-agnostic.
 */
type WidgetPluginPhaseOrder = readonly ['config', 'slots', 'structure', 'state', 'properties', 'methods', 'events']

type WidgetPluginPhaseName = WidgetPluginPhaseOrder[number]

type WidgetPluginCapabilityPhaseName = Exclude<WidgetPluginPhaseName, 'structure'>

/**
 * The phases available for `Interfaces`: every phase whose capability was declared, plus `structure`,
 * which every plugin may call (at most once) regardless of its capabilities.
 */
type WidgetPluginAvailablePhaseName<Interfaces extends WidgetInterfaces> = 'structure' | {
	[Phase in WidgetPluginCapabilityPhaseName]: HasWidgetCapability<Interfaces, Phase> extends true ? Phase : never
}[WidgetPluginCapabilityPhaseName]

type WidgetPluginPhaseIsBefore<
	A extends WidgetPluginPhaseName,
	B extends WidgetPluginPhaseName,
	Order extends readonly WidgetPluginPhaseName[] = WidgetPluginPhaseOrder,
> = Order extends readonly [infer Head, ...infer Tail extends readonly WidgetPluginPhaseName[]]
	? Head extends A ? true : Head extends B ? false : WidgetPluginPhaseIsBefore<A, B, Tail>
	: false

/**
 * Type-only order marker: the message of the compile error raised when an available phase is called at
 * the wrong position. The marker name and reason text are diagnostics, not protocol.
 */
export interface WidgetPluginPhaseOrderViolation<Reason extends string> {
	readonly 'widget-core: builder phase order violation': Reason
}

/**
 * Argument list of a misplaced marker: the real phase's arguments, with the first one intersected with
 * the order violation. The call therefore fails at its first argument with the violation (and its
 * reason) in the message, while the function constituent keeps callbacks contextually typed, so no
 * implicit-`any` follow-on errors appear. Section builders may return anything.
 */
type WidgetPluginMisplacedArguments<Interfaces extends WidgetInterfaces, Phase extends WidgetPluginPhaseName, Violation>
	= Phase extends 'config' ? [definition: Violation & WidgetConfigDefinition<Interfaces>]
		: Phase extends 'slots' ? [definitions: Violation & WidgetSlotDefinitions<Interfaces>]
			: Phase extends 'structure' ? [validateStructure: Violation & WidgetPluginValidateStructure<Interfaces>]
				: Phase extends 'state' ? [build: Violation & ((section: WidgetStateSection<Interfaces, WidgetStateKeyOf<Interfaces>>) => unknown)]
					: Phase extends 'properties' ? [build: Violation & ((section: WidgetPropertiesSection<Interfaces, WidgetPropertyKeyOf<Interfaces>>) => unknown)]
						: Phase extends 'methods' ? [build: Violation & ((section: WidgetMethodsSection<Interfaces, WidgetMethodKeyOf<Interfaces>>) => unknown)]
							: [build: Violation & ((section: WidgetEventsSection<Interfaces, WidgetEventKeyOf<Interfaces>>) => unknown)]

type WidgetPluginPhaseOrderReason<
	Phase extends WidgetPluginPhaseName,
	Stage extends WidgetPluginPhaseName | 'done',
> = Stage extends WidgetPluginPhaseName
	? WidgetPluginPhaseIsBefore<Phase, Stage> extends true
		? `'.${Phase}()' was already called or must be called earlier; the next phase is '.${Stage}()'. Order: description -> interfaces -> config? -> slots? -> structure? -> state? -> properties? -> methods? -> events? -> done()`
		: `'.${Phase}()' is called too early; call '.${Stage}()' first. Order: description -> interfaces -> config? -> slots? -> structure? -> state? -> properties? -> methods? -> events? -> done()`
	: `'.${Phase}()' cannot be called here; the declared phases are already complete, so only '.done()' remains. Order: description -> interfaces -> config? -> slots? -> structure? -> state? -> properties? -> methods? -> events? -> done()`

/**
 * Adds type-only order markers for every available phase that is not in `Callable` (by default just
 * `Stage`, the next phase; the `structure` stage also keeps the optional `structure` phase callable).
 * A marker takes the real phase's arguments with the first one intersected with
 * `WidgetPluginPhaseOrderViolation`, so no real value satisfies it and the call fails with an
 * order-specific diagnostic relative to `Stage` (the function constituent keeps a callback passed to it
 * contextually typed, so no implicit-`any` follow-on errors appear). It returns the same phase, so a
 * misplaced call never advances the chain.
 */
export type WidgetPluginOrderedPhase<
	Phase,
	Interfaces extends WidgetInterfaces,
	Stage extends WidgetPluginPhaseName | 'done',
	Callable extends WidgetPluginPhaseName | 'done' = Stage,
> = [Exclude<WidgetPluginAvailablePhaseName<Interfaces>, Callable>] extends [never]
	? Phase
	: Phase & {
		[Misplaced in Exclude<WidgetPluginAvailablePhaseName<Interfaces>, Callable>]: (
			...args: WidgetPluginMisplacedArguments<Interfaces, Misplaced, WidgetPluginPhaseOrderViolation<WidgetPluginPhaseOrderReason<Misplaced, Stage>>>
		) => WidgetPluginOrderedPhase<Phase, Interfaces, Stage, Callable>
	}

interface WidgetPluginEventsPhaseMembers<Type extends string, Interfaces extends WidgetInterfaces> {
	events: (
		build: (
			section: WidgetEventsSection<Interfaces, WidgetEventKeyOf<Interfaces>>,
		) => WidgetEventsSection<Interfaces, never>,
	) => WidgetPluginOrderedPhase<WidgetPluginDonePhase<Type, Interfaces>, Interfaces, 'done'>
}

interface WidgetPluginMethodsPhaseMembers<Type extends string, Interfaces extends WidgetInterfaces> {
	methods: (
		build: (
			section: WidgetMethodsSection<Interfaces, WidgetMethodKeyOf<Interfaces>>,
		) => WidgetMethodsSection<Interfaces, never>,
	) => WidgetPluginEventsPhase<Type, Interfaces>
}

interface WidgetPluginPropertiesPhaseMembers<Type extends string, Interfaces extends WidgetInterfaces> {
	properties: (
		build: (
			section: WidgetPropertiesSection<Interfaces, WidgetPropertyKeyOf<Interfaces>>,
		) => WidgetPropertiesSection<Interfaces, never>,
	) => WidgetPluginMethodsPhase<Type, Interfaces>
}

interface WidgetPluginStatePhaseMembers<Type extends string, Interfaces extends WidgetInterfaces> {
	state: (
		build: (
			section: WidgetStateSection<Interfaces, WidgetStateKeyOf<Interfaces>>,
		) => WidgetStateSection<Interfaces, never>,
	) => WidgetPluginPropertiesPhase<Type, Interfaces>
}

export type WidgetPluginEventsPhase<Type extends string, Interfaces extends WidgetInterfaces> = HasWidgetCapability<Interfaces, 'events'> extends true
	? WidgetPluginOrderedPhase<WidgetPluginEventsPhaseMembers<Type, Interfaces>, Interfaces, 'events'>
	: WidgetPluginOrderedPhase<WidgetPluginDonePhase<Type, Interfaces>, Interfaces, 'done'>

export type WidgetPluginMethodsPhase<Type extends string, Interfaces extends WidgetInterfaces> = HasWidgetCapability<Interfaces, 'methods'> extends true
	? WidgetPluginOrderedPhase<WidgetPluginMethodsPhaseMembers<Type, Interfaces>, Interfaces, 'methods'>
	: WidgetPluginEventsPhase<Type, Interfaces>

export type WidgetPluginPropertiesPhase<Type extends string, Interfaces extends WidgetInterfaces> = HasWidgetCapability<Interfaces, 'properties'> extends true
	? WidgetPluginOrderedPhase<WidgetPluginPropertiesPhaseMembers<Type, Interfaces>, Interfaces, 'properties'>
	: WidgetPluginMethodsPhase<Type, Interfaces>

export type WidgetPluginStatePhase<Type extends string, Interfaces extends WidgetInterfaces> = HasWidgetCapability<Interfaces, 'state'> extends true
	? WidgetPluginOrderedPhase<WidgetPluginStatePhaseMembers<Type, Interfaces>, Interfaces, 'state'>
	: WidgetPluginPropertiesPhase<Type, Interfaces>

/**
 * The `structure` stage: the optional `.structure()` call and the first declared phase after it (or
 * `.done()`) are both callable. Order markers report relative to that next phase, since `structure` may
 * be skipped.
 */
type WidgetPluginStructureStage<
	Type extends string,
	Interfaces extends WidgetInterfaces,
	Next extends WidgetPluginPhaseName | 'done',
	NextMembers,
> = WidgetPluginOrderedPhase<{
	structure: <Result = unknown>(validateStructure: WidgetPluginValidateStructure<Interfaces, Result>) => WidgetPluginStatePhase<Type, Interfaces>
} & NextMembers, Interfaces, Next, 'structure' | Next>

/**
 * The optional plugin-level structure validator phase. It is not a capability: every plugin may call
 * `.structure(validateStructure)` at most once, after `slots?` and before `state?`, and it changes
 * neither `plugin.capabilities`, the catalog, nor inspection.
 */
export type WidgetPluginStructurePhase<Type extends string, Interfaces extends WidgetInterfaces> = HasWidgetCapability<Interfaces, 'state'> extends true
	? WidgetPluginStructureStage<Type, Interfaces, 'state', WidgetPluginStatePhaseMembers<Type, Interfaces>>
	: HasWidgetCapability<Interfaces, 'properties'> extends true
		? WidgetPluginStructureStage<Type, Interfaces, 'properties', WidgetPluginPropertiesPhaseMembers<Type, Interfaces>>
		: HasWidgetCapability<Interfaces, 'methods'> extends true
			? WidgetPluginStructureStage<Type, Interfaces, 'methods', WidgetPluginMethodsPhaseMembers<Type, Interfaces>>
			: HasWidgetCapability<Interfaces, 'events'> extends true
				? WidgetPluginStructureStage<Type, Interfaces, 'events', WidgetPluginEventsPhaseMembers<Type, Interfaces>>
				: WidgetPluginStructureStage<Type, Interfaces, 'done', WidgetPluginDonePhase<Type, Interfaces>>

/**
 * `slots: never` is the canonical explicit-empty slots declaration (diagnostic #10 amendment
 * "declaration-presence semantics and public `WidgetPlugin.capabilities`"): the phase still exists —
 * gated on `HasWidgetCapability`, never on whether `WidgetCapabilityOf<Interfaces, 'slots'>` happens to
 * be `never` — and completes as `.slots({})`, since `ExactWidgetSlotDefinitions` for zero slot names is
 * exactly `{}`. A plugin-level structure validator is declared with the following `.structure()` phase.
 */
export type WidgetPluginSlotsPhase<Type extends string, Interfaces extends WidgetInterfaces> = HasWidgetCapability<Interfaces, 'slots'> extends true
	? WidgetPluginOrderedPhase<{
		slots: <const Definitions extends ExactWidgetSlotDefinitions<Interfaces, Definitions>>(
			definitions: Definitions,
		) => WidgetPluginStructurePhase<Type, Interfaces>
	}, Interfaces, 'slots'>
	: WidgetPluginStructurePhase<Type, Interfaces>

export type WidgetPluginConfigPhase<Type extends string, Interfaces extends WidgetInterfaces> = HasWidgetCapability<Interfaces, 'config'> extends true
	? WidgetPluginOrderedPhase<{
		config: (definition: WidgetConfigDefinition<Interfaces>) => WidgetPluginSlotsPhase<Type, Interfaces>
	}, Interfaces, 'config'>
	: WidgetPluginSlotsPhase<Type, Interfaces>

export interface WidgetPluginInterfacesPhase<Type extends string> {
	interfaces: <Interfaces extends WidgetInterfaces>() => [WidgetInterfacesViolationOf<Interfaces>] extends [never]
		? WidgetPluginConfigPhase<Type, Interfaces>
		: WidgetInterfacesViolation<WidgetInterfacesViolationOf<Interfaces>>
}

export interface WidgetPluginDescriptionPhase<Type extends string> {
	description: (description: string) => WidgetPluginInterfacesPhase<Type>
}

// -------------------------------------------------------------------------------------------------
// Builder implementation
// -------------------------------------------------------------------------------------------------

interface WidgetPluginDraft {
	description: string
	config: ErasedWidgetConfigDefinition | null
	slots: Map<WidgetMemberKey, ErasedWidgetSlotDefinition> | null
	validateStructure: ((ctx: any) => void) | null
	state: Map<WidgetMemberKey, ErasedWidgetStateMemberDefinition> | null
	properties: Map<WidgetMemberKey, ErasedWidgetPropertyDefinition> | null
	methods: Map<WidgetMemberKey, ErasedWidgetMethodDefinition> | null
	events: Map<WidgetMemberKey, ErasedWidgetEventDefinition> | null
}

type WidgetPluginSectionName = 'config' | 'slots' | 'state' | 'properties' | 'methods' | 'events'

type WidgetPluginMemberSectionName = Exclude<WidgetPluginSectionName, 'config' | 'slots'>

type WidgetPluginFieldKind = 'function' | 'string' | 'boolean' | 'schema' | 'value-contract'

type WidgetPluginFieldRule = readonly [field: string, kind: WidgetPluginFieldKind, required: boolean]

/**
 * The callbacks and description fields each section's definition type requires, plus its optional
 * fields. Untyped (JavaScript / dynamically loaded) plugins are checked against these at registration,
 * so a malformed plugin fails before `done()` returns instead of at its first interaction.
 */
const definitionFieldRules: Readonly<Record<WidgetPluginSectionName, readonly WidgetPluginFieldRule[]>> = {
	config: [['description', 'string', true], ['validate', 'function', true], ['resolve', 'function', true], ['schema', 'schema', false]],
	slots: [['description', 'string', true], ['validateStructure', 'function', false]],
	state: [['validate', 'function', true], ['default', 'function', false], ['authorWritable', 'boolean', false]],
	properties: [['compute', 'function', true], ['registerDeps', 'function', false], ['valueContract', 'value-contract', false]],
	methods: [['validateArgs', 'function', true], ['execute', 'function', true], ['registerDeps', 'function', false]],
	events: [['description', 'string', true]],
}

const fieldKindExpectations: Readonly<Record<WidgetPluginFieldKind, string>> = {
	'function': 'a function',
	'string': 'a string',
	'boolean': 'a boolean',
	'schema': 'a JSON Schema (a boolean or an object)',
	'value-contract': 'a value contract created by createWidgetValueContract()',
}

function matchesFieldKind(value: unknown, kind: WidgetPluginFieldKind): boolean {
	switch (kind) {
		case 'function':
			return typeof value === 'function'
		case 'string':
			return typeof value === 'string'
		case 'boolean':
			return typeof value === 'boolean'
		case 'schema':
			// `null` is the erased "no schema" form.
			return value === null || typeof value === 'boolean' || (typeof value === 'object' && !Array.isArray(value))
		case 'value-contract':
			return typeof value === 'object' && value !== null && typeof (value as { readonly id?: unknown }).id === 'string'
	}
}

function describeValue(value: unknown): string {
	return value === null ? 'null' : Array.isArray(value) ? 'array' : typeof value
}

function memberSubject(section: WidgetPluginSectionName, key: WidgetMemberKey): string {
	return `member "${key}" of section "${section}"`
}

/** Plugin contract violations throw uncoded `TypeError`s. */
function pluginContractViolation(pluginType: string, subject: string, problem: string): TypeError {
	return new TypeError(`Widget plugin "${pluginType}": ${subject} ${problem}. This is a plugin implementation bug.`)
}

/**
 * Captures one definition by value (shallow copy, frozen), the same way for config, slots and members,
 * after checking that it is an object carrying the fields its section requires. Optional fields are
 * type-checked only when present (not `undefined`).
 */
function captureDefinition(pluginType: string, section: WidgetPluginSectionName, subject: string, definition: unknown): any {
	if (typeof definition !== 'object' || definition === null)
		throw pluginContractViolation(pluginType, subject, `must be declared with a definition object, got ${describeValue(definition)}`)

	const captured: Readonly<Record<string, unknown>> = Object.freeze({ ...definition })
	for (const [field, kind, required] of definitionFieldRules[section]) {
		const value = captured[field]
		if (value === undefined) {
			if (required)
				throw pluginContractViolation(pluginType, subject, `is missing the required "${field}" field (expected ${fieldKindExpectations[kind]})`)
			continue
		}
		if (!matchesFieldKind(value, kind))
			throw pluginContractViolation(pluginType, subject, `has an invalid "${field}" field (expected ${fieldKindExpectations[kind]}, got ${describeValue(value)})`)
	}
	return captured
}

/**
 * Runs one section build callback against the section keyed-chain object, registering its members into
 * `members` in declaration order.
 *
 * Declared member keys exist only at the type level, so every string member access resolves to a
 * registrar; the returned chain object is the same object by identity. A registrar accepts only a
 * definition object, which it validates and captures by value, so probing the section
 * (`JSON.stringify`, string coercion, thenable detection) registers nothing. The section is sealed once
 * the build callback returns or throws: a later registrar call (from a retained section) throws and
 * changes nothing.
 */
function buildSection(
	pluginType: string,
	sectionName: WidgetPluginMemberSectionName,
	members: Map<WidgetMemberKey, any>,
	build: (section: any) => unknown,
): void {
	let sealed = false
	const section: unknown = new Proxy({}, {
		get(_target, key) {
			if (typeof key !== 'string')
				return undefined

			return (definition: unknown) => {
				const subject = memberSubject(sectionName, key)
				if (sealed)
					throw pluginContractViolation(pluginType, subject, 'was declared after the section\'s build callback returned')

				members.set(key, captureDefinition(pluginType, sectionName, subject, definition))
				return section
			}
		},
	})

	try {
		build(section)
	}
	finally {
		sealed = true
	}
}

/**
 * Starts the plugin builder for one plugin `type`.
 *
 * Phase order is `description -> interfaces -> config? -> slots? -> structure? -> state? -> properties? -> methods? -> events? -> done()`;
 * a capability phase exists only when its capability is declared, while the optional `structure` phase
 * (the plugin-level structure validator) is available to every plugin. Calling a phase out of order (or
 * repeating it) fails type-checking with an order-specific diagnostic; the runtime builder itself is
 * order-agnostic.
 */
export function createWidgetPlugin<const Type extends string>(type: Type): WidgetPluginDescriptionPhase<Type> {
	const draft: WidgetPluginDraft = {
		description: '',
		config: null,
		slots: null,
		validateStructure: null,
		state: null,
		properties: null,
		methods: null,
		events: null,
	}

	const builder = {
		description(description: string) {
			draft.description = description
			return builder
		},
		interfaces: () => builder,

		config(definition: ErasedWidgetConfigDefinition) {
			const captured: ErasedWidgetConfigDefinition = captureDefinition(type, 'config', 'section "config"', definition)
			draft.config = Object.freeze({
				...captured,
				schema: captured.schema ?? null,
			})
			return builder
		},

		slots(
			definitions: Readonly<Record<WidgetMemberKey, ErasedWidgetSlotDefinition>>,
			...removedArguments: readonly unknown[]
		) {
			if (typeof definitions !== 'object' || definitions === null)
				throw pluginContractViolation(type, 'section "slots"', `must be declared with a slot definitions object, got ${describeValue(definitions)}`)
			// The plugin-level validator moved to `.structure()`; silently dropping it would lose validation.
			if (removedArguments.some(argument => argument !== undefined))
				throw pluginContractViolation(type, 'section "slots"', 'takes only the slot definitions; declare a plugin-level validateStructure with ".structure()"')

			draft.slots = new Map(Object.entries(definitions)
				.map(([name, slot]) => [name, captureDefinition(type, 'slots', memberSubject('slots', name), slot)]))
			return builder
		},

		structure(validateStructure: (ctx: any) => void) {
			if (typeof validateStructure !== 'function')
				throw pluginContractViolation(type, 'phase "structure"', `must be given a validateStructure function, got ${describeValue(validateStructure)}`)

			draft.validateStructure = validateStructure
			return builder
		},

		state(build: (section: any) => unknown) {
			const members = new Map<WidgetMemberKey, ErasedWidgetStateMemberDefinition>()
			draft.state = members
			buildSection(type, 'state', members, build)
			return builder
		},

		properties(build: (section: any) => unknown) {
			const members = new Map<WidgetMemberKey, ErasedWidgetPropertyDefinition>()
			draft.properties = members
			buildSection(type, 'properties', members, build)
			return builder
		},

		methods(build: (section: any) => unknown) {
			const members = new Map<WidgetMemberKey, ErasedWidgetMethodDefinition>()
			draft.methods = members
			buildSection(type, 'methods', members, build)
			return builder
		},

		events(build: (section: any) => unknown) {
			const members = new Map<WidgetMemberKey, ErasedWidgetEventDefinition>()
			draft.events = members
			buildSection(type, 'events', members, build)
			return builder
		},

		done(): WidgetPlugin<Type, WidgetInterfaces> {
			const definition: WidgetPluginDefinition = Object.freeze({
				type,
				description: draft.description,
				config: draft.config,
				slots: draft.slots,
				validateStructure: draft.validateStructure,
				state: draft.state,
				properties: draft.properties,
				methods: draft.methods,
				events: draft.events,
			})

			// Declaration-presence facts, read off the same `!== null` authoritative check the rest of the
			// compiler/Runtime already uses (`readWidgetPluginDefinition(...).state !== null`, etc.) — a
			// capability's builder phase only ever runs (setting the registry to a `Map`, possibly empty)
			// when `HasWidgetCapability` was `true` for it, so this single runtime fact source stays
			// consistent with the type-level presence predicate by construction.
			const capabilities: WidgetPluginCapabilities = Object.freeze({
				config: definition.config !== null,
				slots: definition.slots !== null,
				state: definition.state !== null,
				properties: definition.properties !== null,
				methods: definition.methods !== null,
				events: definition.events !== null,
			})

			const config = definition.config === null
				? null
				: Object.freeze({
						description: definition.config.description,
						schema: definition.config.schema,
					})

			const descriptions = Object.freeze({
				config: config?.description ?? null,
				slots: definition.slots === null
					? null
					: createReadonlyMap([...definition.slots].map(([key, slot]) => [key, slot.description] as const)),
			})

			return Object.freeze({
				type,
				description: draft.description,
				capabilities,
				config,
				descriptions,
				[widgetPluginBrand]: Object.freeze({ definition }),
			})
		},
	}

	return builder as unknown as WidgetPluginDescriptionPhase<Type>
}
