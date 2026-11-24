/**
 * Plugin semantic contract and the ordered capability-phase builder.
 *
 * Normative contract: DevilTea/widget Discussion #12, Core composition architecture topic. Historical source (migrated): diagnostic #10 checkpoint A/B/C/D, amendments "reconciliation audit",
 * "WidgetMemberKey domain", "builder completion typestate and finite member-key universe" and
 * consolidated handoff §2/§3/§4.
 */

import type { DependencyBuilder, DependencyConsumer, EmptyRegisteredDeps, RegisteredDeps, SlotChildDependencyTarget, ToExecutedDeps } from './dep'
import type {
	DiagnosticCollector,
	RelativePluginStructureDiagnosticInput,
	RelativeSlotStructureDiagnosticInput,
	RelativeValueDiagnosticInput,
} from './diagnostic'
import type {
	CapturedDocsNode,
	WidgetConfigDocs,
	WidgetConfigDocsData,
	WidgetDescription,
	WidgetEventDocs,
	WidgetEventDocsData,
	WidgetMethodDocs,
	WidgetMethodDocsData,
	WidgetPluginDocs,
	WidgetReasonDocs,
	WidgetReasonDocsData,
	WidgetSlotDocs,
	WidgetSlotDocsData,
	WidgetValueDocs,
} from './docs'
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
	WidgetMemberValueOf,
	WidgetMethodArgsOf,
	WidgetMethodKeyOf,
	WidgetMethodReturnOf,
	WidgetPropertyKeyOf,
	WidgetPropertyValueOf,
	WidgetRawConfigOf,
	WidgetReasonKeyOf,
	WidgetReasonsOf,
	WidgetResolvedConfigOf,
	WidgetSlotExpectedOf,
	WidgetSlotNameOf,
	WidgetStateKeyOf,
	WidgetStateValueOf,
} from './types'
import { captureDescription, captureDocsNode, captureDocsPositions, createDocsRecord, undocumented, WidgetDocsSerializer } from './docs'

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

export interface ErasedWidgetConfigDefinition {
	readonly validate: (input: unknown, ctx: any) => boolean
	readonly resolve: (rawConfig: any) => unknown
}

export interface ErasedWidgetSlotDefinition {
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
	/** The declared Events, a frozen copy; checked against the events section by `done()`. */
	readonly emits?: readonly WidgetMemberKey[]
	readonly execute: (ctx: any) => unknown
}

/** A declared Event carries no definition of its own: its name is the whole declaration. */
export type ErasedWidgetEventDefinition = Readonly<Record<never, never>>

/**
 * Erased plugin definition record.
 *
 * `null` means the capability was not declared. Member registries are `Map`s so that declaration
 * order is preserved and special JavaScript names (`constructor`, `__proto__`, ...) stay safe.
 */
export interface WidgetPluginDefinition {
	readonly type: string
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
	/** Compiler/plugin-builder-authoritative declaration-presence facts. Immutable, stable for the plugin's lifetime. */
	readonly capabilities: WidgetPluginCapabilities
	/**
	 * The plugin's documentation, as written in the builder: plain, serializable data (see
	 * {@link WidgetPluginDocs}). Core never reads it, and it is not part of the catalog, inspection, Blueprints or
	 * the Inspector protocol.
	 */
	readonly docs: WidgetPluginDocs
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

export type WidgetConfigValidateContext<Interfaces extends WidgetInterfaces = WidgetInterfaces> = DiagnosticCollector<RelativeValueDiagnosticInput<Interfaces>>

export type WidgetStateValidateContext<Interfaces extends WidgetInterfaces>
	= & DiagnosticCollector<RelativeValueDiagnosticInput<Interfaces>>
		& WidgetResolvedConfigContext<Interfaces>

export type WidgetStateDefaultContext<Interfaces extends WidgetInterfaces> = WidgetResolvedConfigContext<Interfaces>

export type WidgetMethodValidateArgsContext<Interfaces extends WidgetInterfaces>
	= & DiagnosticCollector<RelativeValueDiagnosticInput<Interfaces>>
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
	& DiagnosticCollector<RelativeSlotStructureDiagnosticInput<Interfaces>>
	& WidgetResolvedConfigContext<Interfaces>

export type WidgetPluginValidateStructureContext<Interfaces extends WidgetInterfaces>
	= & {
		readonly widget: SelfBlueprintWidgetNodeView<Interfaces>
		readonly blueprint: BlueprintCompileView
	}
	& DiagnosticCollector<RelativePluginStructureDiagnosticInput<WidgetSlotNameOf<Interfaces>, Interfaces>>
	& WidgetResolvedConfigContext<Interfaces>

/**
 * The `slot(name)` of a `registerDeps` context: the resolved children of the widget's own slot `name`, in
 * Blueprint order, each as a dependency target. A target is the one `dep.widget(child.id)` returns (not a new
 * target kind), typed by what the slot expects (see {@link SlotChildDependencyTarget}); the types are the
 * declaration's and are not checked at run time, so `.validate()` stays available on every read.
 */
export type WidgetRegisterDepsSlotContext<
	Interfaces extends WidgetInterfaces,
	Consumer extends DependencyConsumer,
> = HasWidgetCapability<Interfaces, 'slots'> extends true
	? {
			readonly slot: <Name extends WidgetSlotNameOf<Interfaces>>(name: Name) => readonly SlotChildDependencyTarget<WidgetSlotExpectedOf<Interfaces, Name>, Consumer>[]
		}
	: unknown

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
	& WidgetRegisterDepsSlotContext<Interfaces, Consumer>
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
	& DiagnosticCollector<RelativeValueDiagnosticInput<Interfaces>>
	& WidgetResolvedConfigContext<Interfaces>

export type WidgetEventEmitter<Interfaces extends WidgetInterfaces> = {
	readonly [Name in WidgetEventKeyOf<Interfaces>]: (...args: WidgetEventArgsOf<Interfaces, Name>) => void
}

/** The `emit` one Method receives carries exactly the Events it declares in `emits`. */
export type WidgetMethodEventEmitter<Interfaces extends WidgetInterfaces, Emits extends WidgetEventKeyOf<Interfaces>> = {
	readonly [Name in Emits]: (...args: WidgetEventArgsOf<Interfaces, Name>) => void
}

export type WidgetEventEmitterContext<Interfaces extends WidgetInterfaces, Emits extends WidgetEventKeyOf<Interfaces> = never> = HasWidgetCapability<Interfaces, 'events'> extends true
	? { readonly emit: WidgetMethodEventEmitter<Interfaces, Emits> }
	: unknown

export type WidgetMethodExecuteContext<
	Interfaces extends WidgetInterfaces,
	Name extends WidgetMemberKey,
	Deps extends RegisteredDeps,
	Emits extends WidgetEventKeyOf<Interfaces> = never,
>
	= & {
		readonly args: WidgetMethodArgsOf<Interfaces, Name>
		readonly widget: SelfBlueprintWidgetNode<Interfaces>
		readonly blueprint: BlueprintRuntimeView
		readonly deps: ToExecutedDeps<Deps, 'method'>
	}
	& DiagnosticCollector<RelativeValueDiagnosticInput<Interfaces>>
	& WidgetResolvedConfigContext<Interfaces>
	& WidgetEventEmitterContext<Interfaces, Emits>

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

interface WidgetConfigDefinitionFields<Interfaces extends WidgetInterfaces> {
	readonly validate: (input: unknown, ctx: WidgetConfigValidateContext<Interfaces>) => input is WidgetRawConfigOf<Interfaces>
	readonly resolve: (rawConfig: WidgetRawConfigOf<Interfaces> | null) => WidgetResolvedConfigOf<Interfaces>
}

/**
 * The config definition: `description`, the docs of `raw` and `resolved` (see `FieldDocs`), `validate` and
 * `resolve`. With an `undocumented` description, `raw` and `resolved` may be left out.
 */
export type WidgetConfigDefinition<Interfaces extends WidgetInterfaces>
	= & WidgetConfigDocs<WidgetRawConfigOf<Interfaces>, WidgetResolvedConfigOf<Interfaces>>
		& WidgetConfigDefinitionFields<Interfaces>

/** `Result` is the slot validator's own return type (see {@link WidgetSynchronousResult}). */
export interface WidgetSlotDefinition<
	Interfaces extends WidgetInterfaces,
	SlotName extends WidgetMemberKey,
	Result = unknown,
> extends WidgetSlotDocs {
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

interface WidgetStateMemberDefinitionFields<
	Interfaces extends WidgetInterfaces,
	Key extends WidgetMemberKey,
> {
	/** Passive authoring policy. Omitted means this State member is not author-writable. */
	readonly authorWritable?: boolean
	readonly validate: (input: unknown, ctx: WidgetStateValidateContext<Interfaces>) => input is WidgetStateValueOf<Interfaces, Key>
	readonly default?: (ctx: WidgetStateDefaultContext<Interfaces>) => WidgetStateValueOf<Interfaces, Key>
}

/** A State member: `description` plus the nested docs of its value type (see `ShapeDocs`), and its callbacks. */
export type WidgetStateMemberDefinition<
	Interfaces extends WidgetInterfaces,
	Key extends WidgetMemberKey,
> = WidgetValueDocs<WidgetStateValueOf<Interfaces, Key>> & WidgetStateMemberDefinitionFields<Interfaces, Key>

interface WidgetPropertyDefinitionFields<
	Interfaces extends WidgetInterfaces,
	Name extends WidgetMemberKey,
	Deps extends RegisteredDeps,
> {
	/** Passive semantic value contract for integration/tooling inspection. */
	readonly valueContract?: WidgetValueContract<WidgetPropertyValueOf<Interfaces, Name>>
	readonly registerDeps?: (ctx: WidgetRegisterDepsContext<Interfaces, 'property'>) => Deps
	readonly compute: (ctx: WidgetPropertyComputeContext<Interfaces, Deps>) => WidgetPropertyValueOf<Interfaces, Name>
}

/** A Property: `description` plus the nested docs of its value type (see `ShapeDocs`), and its callbacks. */
export type WidgetPropertyDefinition<
	Interfaces extends WidgetInterfaces,
	Name extends WidgetMemberKey,
	Deps extends RegisteredDeps,
> = WidgetValueDocs<WidgetPropertyValueOf<Interfaces, Name>> & WidgetPropertyDefinitionFields<Interfaces, Name, Deps>

interface WidgetMethodDefinitionFields<
	Interfaces extends WidgetInterfaces,
	Name extends WidgetMemberKey,
	Deps extends RegisteredDeps,
	Result,
	Emits extends WidgetEventKeyOf<Interfaces>,
> {
	readonly registerDeps?: (ctx: WidgetRegisterDepsContext<Interfaces, 'method'>) => Deps
	readonly validateArgs: (args: readonly unknown[], ctx: WidgetMethodValidateArgsContext<Interfaces>) => args is WidgetMethodArgsOf<Interfaces, Name>
	/**
	 * The Events this Method may emit. Omitted or empty means none. A Method that emits an Event, itself or
	 * through the Methods it invokes, is not read-only, so no Property may depend on it.
	 */
	readonly emits?: readonly Emits[]
	readonly execute: (ctx: WidgetMethodExecuteContext<Interfaces, Name, Deps, Emits>) => WidgetMethodExecuteResult<WidgetMethodReturnOf<Interfaces, Name>, Result>
}

/**
 * `Result` is `execute`'s own return type (see {@link WidgetMethodExecuteResult}). `Emits` is the union of
 * the Events the Method declares: whenever it is not `never`, `execute` receives an `emit` with those
 * Events, so `emits` is required (a definition that types `emit` without declaring it would throw at its
 * first emit).
 */
export type WidgetMethodDefinition<
	Interfaces extends WidgetInterfaces,
	Name extends WidgetMemberKey,
	Deps extends RegisteredDeps,
	Result = unknown,
	Emits extends WidgetEventKeyOf<Interfaces> = never,
>
	= & WidgetMethodDocs<WidgetMethodArgsOf<Interfaces, Name>, WidgetMethodReturnOf<Interfaces, Name>>
		& WidgetMethodDefinitionFields<Interfaces, Name, Deps, Result, Emits>
		& ([Emits] extends [never] ? unknown : { readonly emits: readonly Emits[] })

/**
 * What `.events()` takes: one docs entry for every Event of `Interfaces['events']`, keyed by the Event name
 * (the keys are the Events declared at run time). Each entry has a `description` and a `payload`, one docs
 * entry per payload position.
 */
export type WidgetEventDefinitions<Interfaces extends WidgetInterfaces> = {
	readonly [Name in WidgetEventKeyOf<Interfaces>]: WidgetEventDocs<WidgetEventArgsOf<Interfaces, Name>>
}

/** What `.reasons()` takes: one docs entry for every reason of `Interfaces['reasons']`. */
export type WidgetReasonDefinitions<Interfaces extends WidgetInterfaces> = {
	readonly [Reason in WidgetReasonKeyOf<Interfaces>]: WidgetReasonDocs<WidgetMemberValueOf<WidgetReasonsOf<Interfaces>, Reason>>
}

/** What a docs record passed through a variable with a key the interfaces do not declare is checked against. */
export interface WidgetUndeclaredMemberViolation<Section extends string> {
	readonly 'widget-core: this name is not declared in the interfaces': Section
}

/**
 * Rejects an `.events()` or `.reasons()` record with a name the interfaces never declared, also when the record
 * is supplied through a variable instead of a fresh object literal.
 */
type ExactMemberRecord<Declared extends PropertyKey, Names extends PropertyKey, Section extends string> = {
	readonly [Name in Exclude<Names, Declared>]: WidgetUndeclaredMemberViolation<Section>
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
			[Name in Remaining]: <const Deps extends RegisteredDeps = EmptyRegisteredDeps, Result = unknown, const Emits extends WidgetEventKeyOf<Interfaces> = never>(
				definition: WidgetMethodDefinition<Interfaces, Name, Deps, Result, Emits>,
			) => WidgetMethodsSection<Interfaces, Exclude<Remaining, Name>>
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
 * Outer builder phases after `.interfaces()` in their fixed call order: every capability phase, the
 * optional, capability-independent `structure` phase, and `reasons`, whose phase exists when
 * `Interfaces['reasons']` is declared (it is not a capability). Part of the type-level order diagnostics
 * only; past `.description()` and `.interfaces()` the runtime builder is order-agnostic.
 */
type WidgetPluginPhaseOrder = readonly ['config', 'slots', 'structure', 'state', 'properties', 'methods', 'events', 'reasons']

type WidgetPluginPhaseName = WidgetPluginPhaseOrder[number]

/** The phases that exist only when their `Interfaces` key is declared. */
type WidgetPluginCapabilityPhaseName = Exclude<WidgetPluginPhaseName, 'structure'>

type WidgetPluginPhaseOrderText = 'Order: description -> interfaces -> config? -> slots? -> structure? -> state? -> properties? -> methods? -> events? -> reasons? -> done()'

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
							: Phase extends 'events' ? [definitions: Violation & WidgetEventDefinitions<Interfaces>]
								: [definitions: Violation & WidgetReasonDefinitions<Interfaces>]

type WidgetPluginPhaseOrderReason<
	Phase extends WidgetPluginPhaseName,
	Stage extends WidgetPluginPhaseName | 'done',
> = Stage extends WidgetPluginPhaseName
	? WidgetPluginPhaseIsBefore<Phase, Stage> extends true
		? `'.${Phase}()' was already called or must be called earlier; the next phase is '.${Stage}()'. ${WidgetPluginPhaseOrderText}`
		: `'.${Phase}()' is called too early; call '.${Stage}()' first. ${WidgetPluginPhaseOrderText}`
	: `'.${Phase}()' cannot be called here; the declared phases are already complete, so only '.done()' remains. ${WidgetPluginPhaseOrderText}`

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

interface WidgetPluginReasonsPhaseMembers<Type extends string, Interfaces extends WidgetInterfaces> {
	/**
	 * Documents the diagnostic reasons: one entry for every reason of `Interfaces['reasons']`, with `details`
	 * (the docs of the payload) when the payload is not `void`.
	 */
	reasons: <const Names extends PropertyKey = never>(
		definitions: WidgetReasonDefinitions<Interfaces> & ExactMemberRecord<WidgetReasonKeyOf<Interfaces>, Names, 'reasons'> & { readonly [Name in Names]?: unknown },
	) => WidgetPluginOrderedPhase<WidgetPluginDonePhase<Type, Interfaces>, Interfaces, 'done'>
}

interface WidgetPluginEventsPhaseMembers<Type extends string, Interfaces extends WidgetInterfaces> {
	/**
	 * Declares the Events: one docs entry for every Event of `Interfaces['events']`, keyed by its name, with a
	 * `description` and a `payload` (one docs entry per payload position).
	 */
	events: <const Names extends PropertyKey = never>(
		definitions: WidgetEventDefinitions<Interfaces> & ExactMemberRecord<WidgetEventKeyOf<Interfaces>, Names, 'events'> & { readonly [Name in Names]?: unknown },
	) => WidgetPluginReasonsPhase<Type, Interfaces>
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

/** The `.reasons()` phase, present when `Interfaces['reasons']` is declared (and then required). */
export type WidgetPluginReasonsPhase<Type extends string, Interfaces extends WidgetInterfaces> = HasWidgetCapability<Interfaces, 'reasons'> extends true
	? WidgetPluginOrderedPhase<WidgetPluginReasonsPhaseMembers<Type, Interfaces>, Interfaces, 'reasons'>
	: WidgetPluginOrderedPhase<WidgetPluginDonePhase<Type, Interfaces>, Interfaces, 'done'>

export type WidgetPluginEventsPhase<Type extends string, Interfaces extends WidgetInterfaces> = HasWidgetCapability<Interfaces, 'events'> extends true
	? WidgetPluginOrderedPhase<WidgetPluginEventsPhaseMembers<Type, Interfaces>, Interfaces, 'events'>
	: WidgetPluginReasonsPhase<Type, Interfaces>

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
				: HasWidgetCapability<Interfaces, 'reasons'> extends true
					? WidgetPluginStructureStage<Type, Interfaces, 'reasons', WidgetPluginReasonsPhaseMembers<Type, Interfaces>>
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

/**
 * The first builder phase: `.description(text)`, the plugin's description (Markdown prose, or `undocumented`).
 * `.interfaces()` is an order marker here: calling it fails type-checking with the reason, and throws a
 * `TypeError` at run time.
 */
export interface WidgetPluginDescriptionPhase<Type extends string> {
	description: (description: WidgetDescription) => WidgetPluginInterfacesPhase<Type>
	readonly interfaces: WidgetPluginPhaseOrderViolation<`'.interfaces()' is called too early; call '.description()' first. ${WidgetPluginPhaseOrderText}`>
}

// -------------------------------------------------------------------------------------------------
// Builder implementation
// -------------------------------------------------------------------------------------------------

interface WidgetPluginDraft {
	config: ErasedWidgetConfigDefinition | null
	slots: Map<WidgetMemberKey, ErasedWidgetSlotDefinition> | null
	validateStructure: ((ctx: any) => void) | null
	state: Map<WidgetMemberKey, ErasedWidgetStateMemberDefinition> | null
	properties: Map<WidgetMemberKey, ErasedWidgetPropertyDefinition> | null
	methods: Map<WidgetMemberKey, ErasedWidgetMethodDefinition> | null
	/** The Methods that declared `emits`, in declaration order; `null` when none did (the common case). */
	emittingMethods: WidgetMemberKey[] | null
	events: Map<WidgetMemberKey, ErasedWidgetEventDefinition> | null
	docs: WidgetPluginDocsDraft
}

interface CapturedConfigDocs {
	readonly description: string | null
	readonly raw?: CapturedDocsNode | null
	readonly resolved?: CapturedDocsNode | null
}

interface CapturedMethodDocs {
	readonly description: string | null
	readonly params?: readonly (CapturedDocsNode | null)[]
	readonly returns?: CapturedDocsNode | null
}

interface CapturedEventDocs {
	readonly description: string | null
	readonly payload?: readonly (CapturedDocsNode | null)[]
}

interface CapturedReasonDocs {
	readonly description: string | null
	readonly details?: CapturedDocsNode | null
}

/** The docs captured so far, by value; serialized into `plugin.docs` by `done()`. */
interface WidgetPluginDocsDraft {
	description: string | null
	config: CapturedConfigDocs | null
	slots: Map<WidgetMemberKey, string | null> | null
	state: Map<WidgetMemberKey, CapturedDocsNode> | null
	properties: Map<WidgetMemberKey, CapturedDocsNode> | null
	methods: Map<WidgetMemberKey, CapturedMethodDocs> | null
	events: Map<WidgetMemberKey, CapturedEventDocs> | null
	reasons: Map<WidgetMemberKey, CapturedReasonDocs> | null
}

type WidgetPluginSectionName = 'config' | 'slots' | 'state' | 'properties' | 'methods' | 'events' | 'reasons'

/** The sections declared with definition objects; Events and reasons are declared by docs only. */
type WidgetPluginDefinitionSectionName = Exclude<WidgetPluginSectionName, 'events' | 'reasons'>

type WidgetPluginMemberSectionName = Exclude<WidgetPluginDefinitionSectionName, 'config' | 'slots'>

type WidgetPluginFieldKind = 'function' | 'boolean' | 'value-contract'

type WidgetPluginFieldRule = readonly [field: string, kind: WidgetPluginFieldKind, required: boolean]

/**
 * The callbacks each section's definition type requires, plus its optional
 * fields. Untyped (JavaScript / dynamically loaded) plugins are checked against these at registration,
 * so a malformed plugin fails before `done()` returns instead of at its first interaction.
 */
const definitionFieldRules: Readonly<Record<WidgetPluginDefinitionSectionName, readonly WidgetPluginFieldRule[]>> = {
	config: [['validate', 'function', true], ['resolve', 'function', true]],
	slots: [['validateStructure', 'function', false]],
	state: [['validate', 'function', true], ['default', 'function', false], ['authorWritable', 'boolean', false]],
	properties: [['compute', 'function', true], ['registerDeps', 'function', false], ['valueContract', 'value-contract', false]],
	methods: [['validateArgs', 'function', true], ['execute', 'function', true], ['registerDeps', 'function', false]],
}

/** The one definition every declared Event shares. */
const EVENT_DEFINITION: ErasedWidgetEventDefinition = Object.freeze({})

const fieldKindExpectations: Readonly<Record<WidgetPluginFieldKind, string>> = {
	'function': 'a function',
	'boolean': 'a boolean',
	'value-contract': 'a value contract created by createWidgetValueContract()',
}

/** A dense array of strings (a hole or a non-string entry is not a name). */
function isNameArray(value: unknown): value is readonly string[] {
	if (!Array.isArray(value))
		return false
	for (let index = 0; index < value.length; index++) {
		if (!(index in value) || typeof value[index] !== 'string')
			return false
	}
	return true
}

function matchesFieldKind(value: unknown, kind: WidgetPluginFieldKind): boolean {
	switch (kind) {
		case 'function':
			return typeof value === 'function'
		case 'boolean':
			return typeof value === 'boolean'
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
function captureDefinition(pluginType: string, section: WidgetPluginDefinitionSectionName, subject: string, definition: unknown): any {
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

	// A Method's declared Event names are checked and captured by value too. Only a Method that declares
	// `emits` pays for it (a copy of the list and of the frozen definition): every other definition costs one
	// comparison and one property read here, and is returned exactly as it was frozen above.
	if (section === 'methods') {
		const emits = captured.emits
		if (emits !== undefined) {
			if (!isNameArray(emits))
				throw pluginContractViolation(pluginType, subject, `has an invalid "emits" field (expected an array of Event names, got ${describeValue(emits)})`)
			return Object.freeze({ ...captured, emits: Object.freeze([...emits]) })
		}
	}
	return captured
}

/** The keys of a State or Property definition that hold its docs. */
const VALUE_DOCS_KEYS = ['description', 'fields', 'items', 'values', 'ref'] as const

const EVENT_DOCS_KEYS: ReadonlySet<string> = new Set(['description', 'payload'])

const REASON_DOCS_KEYS: ReadonlySet<string> = new Set(['description', 'details'])

function docsSubject(pluginType: string, subject: string): string {
	return `Widget plugin "${pluginType}": ${subject}`
}

/** The docs of a State member or Property: its description and the nested docs of its value. */
function captureValueDocs(pluginType: string, subject: string, definition: Readonly<Record<string, unknown>>): CapturedDocsNode {
	const picked: Record<string, unknown> = {}
	for (const key of VALUE_DOCS_KEYS) {
		if (definition[key] !== undefined)
			picked[key] = definition[key]
	}
	return captureDocsNode(picked, docsSubject(pluginType, subject), '', true)!
}

/** The docs of a Method: its description, `params` and `returns`. */
function captureMethodDocs(pluginType: string, subject: string, definition: Readonly<Record<string, unknown>>): CapturedMethodDocs {
	const where = docsSubject(pluginType, subject)
	const docs: { description: string | null, params?: readonly (CapturedDocsNode | null)[], returns?: CapturedDocsNode | null } = {
		description: captureDescription(definition.description, where, ''),
	}
	if (definition.params !== undefined)
		docs.params = captureDocsPositions(definition.params, where, 'params')
	if (definition.returns !== undefined)
		docs.returns = captureDocsNode(definition.returns, where, 'returns', true)
	return docs
}

/** One entry of a docs record (`.events()`, `.reasons()`): `undocumented` or an object with only the `allowed` keys. */
function captureDocsEntry(where: string, entry: unknown, allowed: ReadonlySet<string>): Readonly<Record<string, unknown>> | null {
	if (entry === undocumented)
		return null
	if (typeof entry !== 'object' || entry === null || Array.isArray(entry))
		throw new TypeError(`${where} must be a docs object or undocumented, got ${describeValue(entry)}. This is a plugin implementation bug.`)
	for (const key of Object.keys(entry)) {
		if (!allowed.has(key))
			throw new TypeError(`${where} has an unknown docs key "${key}". This is a plugin implementation bug.`)
	}
	return entry as Readonly<Record<string, unknown>>
}

/** The entries of an `.events()` or `.reasons()` record, in declaration order. */
function readDocsRecord(pluginType: string, section: 'events' | 'reasons', definitions: unknown): readonly (readonly [WidgetMemberKey, unknown])[] {
	if (typeof definitions !== 'object' || definitions === null || Array.isArray(definitions))
		throw pluginContractViolation(pluginType, `section "${section}"`, `must be declared with an object of docs keyed by name, got ${describeValue(definitions)}`)
	return Object.keys(definitions)
		.map(name => [name, (definitions as Readonly<Record<string, unknown>>)[name]] as const)
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
function buildSection<Docs>(
	pluginType: string,
	sectionName: WidgetPluginMemberSectionName,
	members: Map<WidgetMemberKey, any>,
	build: (section: any) => unknown,
	/** Captures the docs of one member definition (after its callbacks were checked). */
	captureDocs: (subject: string, definition: Readonly<Record<string, unknown>>) => Docs,
	docs: Map<WidgetMemberKey, Docs>,
	/** Called with the name of each member whose definition declares `emits` (only the Methods section passes it). */
	onDeclaresEmits?: (key: WidgetMemberKey) => void,
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

				const captured = captureDefinition(pluginType, sectionName, subject, definition)
				const capturedDocs = captureDocs(subject, captured)
				members.set(key, captured)
				docs.set(key, capturedDocs)
				// Recorded as soon as the member is captured, so the draft's list matches `members` even when
				// the build callback later throws and the caller carries on.
				if (onDeclaresEmits !== undefined && captured.emits !== undefined)
					onDeclaresEmits(key)
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
 * Phase order is `description -> interfaces -> config? -> slots? -> structure? -> state? -> properties? -> methods? -> events? -> reasons? -> done()`;
 * a capability phase exists only when its capability is declared, the `reasons` phase only when
 * `Interfaces['reasons']` is declared, while the optional `structure` phase (the plugin-level structure
 * validator) is available to every plugin. Calling a phase out of order (or repeating it) fails type-checking
 * with an order-specific diagnostic. At run time `.description()` must come first (`.interfaces()` before it
 * throws a `TypeError`); the phases after `.interfaces()` are order-agnostic.
 */
export function createWidgetPlugin<const Type extends string>(type: Type): WidgetPluginDescriptionPhase<Type> {
	const draft: WidgetPluginDraft = {
		config: null,
		slots: null,
		validateStructure: null,
		state: null,
		properties: null,
		methods: null,
		emittingMethods: null,
		events: null,
		docs: {
			description: null,
			config: null,
			slots: null,
			state: null,
			properties: null,
			methods: null,
			events: null,
			reasons: null,
		},
	}

	const builder = {
		interfaces: () => builder,

		config(definition: ErasedWidgetConfigDefinition) {
			const subject = 'section "config"'
			const captured = captureDefinition(type, 'config', subject, definition) as Readonly<Record<string, unknown>>
			const where = docsSubject(type, subject)
			const docs: { description: string | null, raw?: CapturedDocsNode | null, resolved?: CapturedDocsNode | null } = {
				description: captureDescription(captured.description, where, ''),
			}
			if (captured.raw !== undefined)
				docs.raw = captureDocsNode(captured.raw, where, 'raw', false)
			if (captured.resolved !== undefined)
				docs.resolved = captureDocsNode(captured.resolved, where, 'resolved', false)
			draft.config = captured as unknown as ErasedWidgetConfigDefinition
			draft.docs.config = docs
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

			const slots = new Map<WidgetMemberKey, ErasedWidgetSlotDefinition>()
			const docs = new Map<WidgetMemberKey, string | null>()
			for (const [name, slot] of Object.entries(definitions)) {
				const subject = memberSubject('slots', name)
				const captured = captureDefinition(type, 'slots', subject, slot) as Readonly<Record<string, unknown>>
				docs.set(name, captureDescription(captured.description, docsSubject(type, subject), ''))
				slots.set(name, captured as ErasedWidgetSlotDefinition)
			}
			draft.slots = slots
			draft.docs.slots = docs
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
			const docs = new Map<WidgetMemberKey, CapturedDocsNode>()
			draft.state = members
			draft.docs.state = docs
			buildSection(type, 'state', members, build, (subject, definition) => captureValueDocs(type, subject, definition), docs)
			return builder
		},

		properties(build: (section: any) => unknown) {
			const members = new Map<WidgetMemberKey, ErasedWidgetPropertyDefinition>()
			const docs = new Map<WidgetMemberKey, CapturedDocsNode>()
			draft.properties = members
			draft.docs.properties = docs
			buildSection(type, 'properties', members, build, (subject, definition) => captureValueDocs(type, subject, definition), docs)
			return builder
		},

		methods(build: (section: any) => unknown) {
			const members = new Map<WidgetMemberKey, ErasedWidgetMethodDefinition>()
			const docs = new Map<WidgetMemberKey, CapturedMethodDocs>()
			draft.methods = members
			draft.docs.methods = docs
			draft.emittingMethods = null
			buildSection(type, 'methods', members, build, (subject, definition) => captureMethodDocs(type, subject, definition), docs, (key) => {
				(draft.emittingMethods ??= []).push(key)
			})
			return builder
		},

		events(definitions: Readonly<Record<WidgetMemberKey, unknown>>) {
			const members = new Map<WidgetMemberKey, ErasedWidgetEventDefinition>()
			const docs = new Map<WidgetMemberKey, CapturedEventDocs>()
			for (const [name, entry] of readDocsRecord(type, 'events', definitions)) {
				const where = docsSubject(type, memberSubject('events', name))
				const source = captureDocsEntry(where, entry, EVENT_DOCS_KEYS)
				const captured: { description: string | null, payload?: readonly (CapturedDocsNode | null)[] } = {
					description: source === null ? null : captureDescription(source.description, where, ''),
				}
				if (source !== null && source.payload !== undefined)
					captured.payload = captureDocsPositions(source.payload, where, 'payload')
				members.set(name, EVENT_DEFINITION)
				docs.set(name, captured)
			}
			draft.events = members
			draft.docs.events = docs
			return builder
		},

		reasons(definitions: Readonly<Record<WidgetMemberKey, unknown>>) {
			const docs = new Map<WidgetMemberKey, CapturedReasonDocs>()
			for (const [name, entry] of readDocsRecord(type, 'reasons', definitions)) {
				const where = docsSubject(type, memberSubject('reasons', name))
				const source = captureDocsEntry(where, entry, REASON_DOCS_KEYS)
				const captured: { description: string | null, details?: CapturedDocsNode | null } = {
					description: source === null ? null : captureDescription(source.description, where, ''),
				}
				if (source !== null && source.details !== undefined)
					captured.details = captureDocsNode(source.details, where, 'details', false)
				docs.set(name, captured)
			}
			draft.docs.reasons = docs
			return builder
		},

		done(): WidgetPlugin<Type, WidgetInterfaces> {
			// Events are declared after Methods, so a declared `emits` is checked against them here. Only the
			// Methods that declared one are visited, with no allocation (a duplicate is an earlier equal entry).
			if (draft.emittingMethods !== null) {
				for (const name of draft.emittingMethods) {
					const emits = draft.methods?.get(name)?.emits
					if (emits === undefined)
						continue
					for (let index = 0; index < emits.length; index++) {
						const event = emits[index]!
						if (draft.events === null || !draft.events.has(event))
							throw pluginContractViolation(type, memberSubject('methods', name), `has an invalid "emits" field (Event "${event}" is not declared in section "events")`)
						if (emits.indexOf(event) !== index)
							throw pluginContractViolation(type, memberSubject('methods', name), `has an invalid "emits" field (Event "${event}" is listed more than once)`)
					}
				}
			}

			const docs = serializePluginDocs(type, draft.docs)

			const definition: WidgetPluginDefinition = Object.freeze({
				type,
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

			return Object.freeze({
				type,
				capabilities,
				docs,
				[widgetPluginBrand]: Object.freeze({ definition }),
			})
		},
	}

	const start = {
		description(description: unknown) {
			draft.docs.description = captureDescription(description, docsSubject(type, 'phase "description"'), '')
			return builder
		},
		interfaces() {
			throw pluginContractViolation(type, 'phase "interfaces"', 'was called before ".description()"; the builder starts with ".description(text)" (text or undocumented)')
		},
	}

	return start as unknown as WidgetPluginDescriptionPhase<Type>
}

/** Serializes the captured docs into the plain, frozen `plugin.docs` data. */
function serializePluginDocs(pluginType: string, docs: WidgetPluginDocsDraft): WidgetPluginDocs {
	const serializer = new WidgetDocsSerializer(`Widget plugin "${pluginType}": docs`)

	function record<Captured, Serialized>(
		section: string,
		members: ReadonlyMap<WidgetMemberKey, Captured> | null,
		serialize: (captured: Captured, path: string) => Serialized,
	): { readonly [name: string]: Serialized } | null {
		if (members === null)
			return null
		return createDocsRecord([...members].map(([name, captured]) => [name, serialize(captured, `${section}.${name}`)] as const))
	}

	let config: WidgetConfigDocsData | null = null
	if (docs.config !== null) {
		const data: { description: string | null, raw?: WidgetConfigDocsData['raw'], resolved?: WidgetConfigDocsData['resolved'] } = {
			description: docs.config.description,
		}
		if (docs.config.raw !== undefined)
			data.raw = serializer.node(docs.config.raw, 'config.raw')
		if (docs.config.resolved !== undefined)
			data.resolved = serializer.node(docs.config.resolved, 'config.resolved')
		config = Object.freeze(data)
	}

	const slots = record<string | null, WidgetSlotDocsData>('slots', docs.slots, description => Object.freeze({ description }))
	const state = record('state', docs.state, (captured, path) => serializer.described(captured, path)!)
	const properties = record('properties', docs.properties, (captured, path) => serializer.described(captured, path)!)
	const methods = record<CapturedMethodDocs, WidgetMethodDocsData>('methods', docs.methods, (captured, path) => {
		const data: { description: string | null, params?: WidgetMethodDocsData['params'], returns?: WidgetMethodDocsData['returns'] } = {
			description: captured.description,
		}
		if (captured.params !== undefined)
			data.params = serializer.positions(captured.params, `${path}.params`)
		if (captured.returns !== undefined)
			data.returns = serializer.described(captured.returns, `${path}.returns`)
		return Object.freeze(data)
	})
	const events = record<CapturedEventDocs, WidgetEventDocsData>('events', docs.events, (captured, path) => {
		const data: { description: string | null, payload?: WidgetEventDocsData['payload'] } = { description: captured.description }
		if (captured.payload !== undefined)
			data.payload = serializer.positions(captured.payload, `${path}.payload`)
		return Object.freeze(data)
	})
	const reasons = record<CapturedReasonDocs, WidgetReasonDocsData>('reasons', docs.reasons, (captured, path) => {
		const data: { description: string | null, details?: WidgetReasonDocsData['details'] } = { description: captured.description }
		if (captured.details !== undefined)
			data.details = serializer.node(captured.details, `${path}.details`)
		return Object.freeze(data)
	})

	return Object.freeze({
		description: docs.description,
		config,
		slots,
		state,
		properties,
		methods,
		events,
		reasons,
		types: serializer.types(),
	})
}
