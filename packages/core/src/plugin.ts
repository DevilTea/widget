/**
 * Plugin semantic contract and the ordered capability-phase builder.
 *
 * Normative source: issue #10 checkpoint A/B/C/D, amendments "reconciliation audit",
 * "WidgetMemberKey domain", "builder completion typestate and finite member-key universe" and
 * consolidated handoff §2/§3/§4.
 */

import type { DependencyBuilder, DependencyConsumer, EmptyRegisteredDeps, RegisteredDeps, ToExecutedDeps } from './dep'
import type {
	BlueprintCompileView,
	BlueprintWidgetNodeView,
	SelfBlueprintWidgetNode,
	SelfBlueprintWidgetNodeView,
	ValidBlueprintView,
} from './internal/contract'
import type {
	IssueCollector,
	RelativePluginStructureIssueInput,
	RelativeSlotStructureIssueInput,
	RelativeValueIssueInput,
} from './issue'
import type {
	WidgetCapabilityOf,
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
	readonly validate: (input: unknown, ctx: any) => boolean
	readonly default?: (ctx: any) => unknown
}

export interface ErasedWidgetPropertyDefinition {
	readonly registerDeps?: (ctx: any) => RegisteredDeps
	readonly compute: (ctx: any) => unknown
}

export interface ErasedWidgetMethodDefinition {
	readonly registerDeps?: (ctx: any) => RegisteredDeps
	readonly validateArgs: (args: readonly unknown[], ctx: any) => boolean
	readonly execute: (ctx: any) => unknown
}

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
}

export interface WidgetPluginBrand<Interfaces extends WidgetInterfaces> {
	readonly interfaces?: Interfaces
	readonly definition: WidgetPluginDefinition
}

/**
 * A completed plugin. Plugin-specific integration options are captured by the plugin factory's
 * closure; there is no `pluginConfig` / `globalConfig`.
 */
export interface WidgetPlugin<
	Type extends string = string,
	Interfaces extends WidgetInterfaces = WidgetInterfaces,
> {
	readonly type: Type
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
export type WidgetResolvedConfigContext<Interfaces extends WidgetInterfaces> = [WidgetCapabilityOf<Interfaces, 'config'>] extends [never]
	? unknown
	: {
			readonly config: WidgetResolvedConfigOf<Interfaces>
		}

export type WidgetConfigValidateContext = IssueCollector<RelativeValueIssueInput>

export type WidgetStateValidateContext<Interfaces extends WidgetInterfaces>
	= & IssueCollector<RelativeValueIssueInput>
		& WidgetResolvedConfigContext<Interfaces>

export type WidgetStateDefaultContext<Interfaces extends WidgetInterfaces> = WidgetResolvedConfigContext<Interfaces>

export type WidgetMethodValidateArgsContext<Interfaces extends WidgetInterfaces>
	= & IssueCollector<RelativeValueIssueInput>
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
	& IssueCollector<RelativeSlotStructureIssueInput>
	& WidgetResolvedConfigContext<Interfaces>

export type WidgetPluginValidateStructureContext<Interfaces extends WidgetInterfaces>
	= & {
		readonly widget: SelfBlueprintWidgetNodeView<Interfaces>
		readonly blueprint: BlueprintCompileView
	}
	& IssueCollector<RelativePluginStructureIssueInput<WidgetSlotNameOf<Interfaces>>>
	& WidgetResolvedConfigContext<Interfaces>

/**
 * `registerDeps` runs once per Blueprint snapshot. It sees the compile semantic view and resolved
 * config, and has no runtime values and no issue collector.
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
		readonly blueprint: ValidBlueprintView
		readonly deps: ToExecutedDeps<Deps, 'property'>
	}
	& IssueCollector<RelativeValueIssueInput>
	& WidgetResolvedConfigContext<Interfaces>

export type WidgetMethodExecuteContext<
	Interfaces extends WidgetInterfaces,
	Name extends WidgetMemberKey,
	Deps extends RegisteredDeps,
>
	= & {
		readonly args: WidgetMethodArgsOf<Interfaces, Name>
		readonly widget: SelfBlueprintWidgetNode<Interfaces>
		readonly blueprint: ValidBlueprintView
		readonly deps: ToExecutedDeps<Deps, 'method'>
	}
	& IssueCollector<RelativeValueIssueInput>
	& WidgetResolvedConfigContext<Interfaces>

// -------------------------------------------------------------------------------------------------
// Member declarations
// -------------------------------------------------------------------------------------------------

export interface WidgetConfigDefinition<Interfaces extends WidgetInterfaces> {
	readonly validate: (input: unknown, ctx: WidgetConfigValidateContext) => input is WidgetRawConfigOf<Interfaces>
	readonly resolve: (rawConfig: WidgetRawConfigOf<Interfaces> | null) => WidgetResolvedConfigOf<Interfaces>
}

export interface WidgetSlotDefinition<
	Interfaces extends WidgetInterfaces,
	SlotName extends WidgetMemberKey,
> {
	readonly validateStructure?: (ctx: WidgetSlotValidateStructureContext<Interfaces, SlotName>) => void
}

export type WidgetSlotDefinitions<Interfaces extends WidgetInterfaces> = {
	readonly [Name in WidgetSlotNameOf<Interfaces>]: WidgetSlotDefinition<Interfaces, Name>
}

/**
 * Rejects a slots object that carries a slot the interfaces never declared, including when the
 * object is supplied through a variable instead of a fresh object literal.
 */
export type ExactWidgetSlotDefinitions<Interfaces extends WidgetInterfaces, Definitions>
	= & WidgetSlotDefinitions<Interfaces>
		& {
			readonly [Name in keyof Definitions as Name extends WidgetSlotNameOf<Interfaces> ? never : Name]: never
		}

export type WidgetPluginValidateStructure<Interfaces extends WidgetInterfaces> = (ctx: WidgetPluginValidateStructureContext<Interfaces>) => void

export interface WidgetStateMemberDefinition<
	Interfaces extends WidgetInterfaces,
	Key extends WidgetMemberKey,
> {
	readonly validate: (input: unknown, ctx: WidgetStateValidateContext<Interfaces>) => input is WidgetStateValueOf<Interfaces, Key>
	readonly default?: (ctx: WidgetStateDefaultContext<Interfaces>) => WidgetStateValueOf<Interfaces, Key>
}

export interface WidgetPropertyDefinition<
	Interfaces extends WidgetInterfaces,
	Name extends WidgetMemberKey,
	Deps extends RegisteredDeps,
> {
	readonly registerDeps?: (ctx: WidgetRegisterDepsContext<Interfaces, 'property'>) => Deps
	readonly compute: (ctx: WidgetPropertyComputeContext<Interfaces, Deps>) => WidgetPropertyValueOf<Interfaces, Name>
}

export interface WidgetMethodDefinition<
	Interfaces extends WidgetInterfaces,
	Name extends WidgetMemberKey,
	Deps extends RegisteredDeps,
> {
	readonly registerDeps?: (ctx: WidgetRegisterDepsContext<Interfaces, 'method'>) => Deps
	readonly validateArgs: (args: readonly unknown[], ctx: WidgetMethodValidateArgsContext<Interfaces>) => args is WidgetMethodArgsOf<Interfaces, Name>
	readonly execute: (ctx: WidgetMethodExecuteContext<Interfaces, Name, Deps>) => WidgetMethodReturnOf<Interfaces, Name>
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
			[Name in Remaining]: <const Deps extends RegisteredDeps = EmptyRegisteredDeps>(
				definition: WidgetMethodDefinition<Interfaces, Name, Deps>,
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

export type WidgetPluginMethodsPhase<Type extends string, Interfaces extends WidgetInterfaces> = [WidgetCapabilityOf<Interfaces, 'methods'>] extends [never]
	? WidgetPluginDonePhase<Type, Interfaces>
	: {
			methods: (
				build: (
					section: WidgetMethodsSection<Interfaces, WidgetMethodKeyOf<Interfaces>>,
				) => WidgetMethodsSection<Interfaces, never>,
			) => WidgetPluginDonePhase<Type, Interfaces>
		}

export type WidgetPluginPropertiesPhase<Type extends string, Interfaces extends WidgetInterfaces> = [WidgetCapabilityOf<Interfaces, 'properties'>] extends [never]
	? WidgetPluginMethodsPhase<Type, Interfaces>
	: {
			properties: (
				build: (
					section: WidgetPropertiesSection<Interfaces, WidgetPropertyKeyOf<Interfaces>>,
				) => WidgetPropertiesSection<Interfaces, never>,
			) => WidgetPluginMethodsPhase<Type, Interfaces>
		}

export type WidgetPluginStatePhase<Type extends string, Interfaces extends WidgetInterfaces> = [WidgetCapabilityOf<Interfaces, 'state'>] extends [never]
	? WidgetPluginPropertiesPhase<Type, Interfaces>
	: {
			state: (
				build: (
					section: WidgetStateSection<Interfaces, WidgetStateKeyOf<Interfaces>>,
				) => WidgetStateSection<Interfaces, never>,
			) => WidgetPluginPropertiesPhase<Type, Interfaces>
		}

export type WidgetPluginSlotsPhase<Type extends string, Interfaces extends WidgetInterfaces> = [WidgetCapabilityOf<Interfaces, 'slots'>] extends [never]
	? WidgetPluginStatePhase<Type, Interfaces>
	: {
			slots: <const Definitions extends ExactWidgetSlotDefinitions<Interfaces, Definitions>>(
				definitions: Definitions,
				validateStructure?: WidgetPluginValidateStructure<Interfaces>,
			) => WidgetPluginStatePhase<Type, Interfaces>
		}

export type WidgetPluginConfigPhase<Type extends string, Interfaces extends WidgetInterfaces> = [WidgetCapabilityOf<Interfaces, 'config'>] extends [never]
	? WidgetPluginSlotsPhase<Type, Interfaces>
	: {
			config: (definition: WidgetConfigDefinition<Interfaces>) => WidgetPluginSlotsPhase<Type, Interfaces>
		}

export interface WidgetPluginInterfacesPhase<Type extends string> {
	interfaces: <Interfaces extends WidgetInterfaces>() => [WidgetInterfacesViolationOf<Interfaces>] extends [never]
		? WidgetPluginConfigPhase<Type, Interfaces>
		: WidgetInterfacesViolation<WidgetInterfacesViolationOf<Interfaces>>
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
}

/**
 * Builds the section keyed-chain object.
 *
 * Declared member keys exist only at the type level, so every string member access resolves to a
 * consuming function; the returned chain object is the same object by identity.
 */
function createSection(sink: Map<WidgetMemberKey, any>): unknown {
	const section: unknown = new Proxy({}, {
		get(_target, key) {
			if (typeof key !== 'string')
				return undefined

			return (definition: unknown) => {
				sink.set(key, definition)
				return section
			}
		},
	})

	return section
}

/**
 * Starts the plugin builder for one plugin `type`.
 *
 * Phase order is `interfaces -> config? -> slots? -> state? -> properties? -> methods? -> done()`;
 * a phase exists only when its capability is declared.
 */
export function createWidgetPlugin<const Type extends string>(type: Type): WidgetPluginInterfacesPhase<Type> {
	const draft: WidgetPluginDraft = {
		config: null,
		slots: null,
		validateStructure: null,
		state: null,
		properties: null,
		methods: null,
	}

	const builder = {
		interfaces: () => builder,

		config(definition: ErasedWidgetConfigDefinition) {
			draft.config = definition
			return builder
		},

		slots(
			definitions: Readonly<Record<WidgetMemberKey, ErasedWidgetSlotDefinition>>,
			validateStructure?: (ctx: any) => void,
		) {
			draft.slots = new Map(Object.entries(definitions))
			draft.validateStructure = validateStructure ?? null
			return builder
		},

		state(build: (section: any) => unknown) {
			const members = new Map<WidgetMemberKey, ErasedWidgetStateMemberDefinition>()
			draft.state = members
			build(createSection(members))
			return builder
		},

		properties(build: (section: any) => unknown) {
			const members = new Map<WidgetMemberKey, ErasedWidgetPropertyDefinition>()
			draft.properties = members
			build(createSection(members))
			return builder
		},

		methods(build: (section: any) => unknown) {
			const members = new Map<WidgetMemberKey, ErasedWidgetMethodDefinition>()
			draft.methods = members
			build(createSection(members))
			return builder
		},

		done(): WidgetPlugin<Type, WidgetInterfaces> {
			const definition: WidgetPluginDefinition = Object.freeze({
				type,
				config: draft.config,
				slots: draft.slots,
				validateStructure: draft.validateStructure,
				state: draft.state,
				properties: draft.properties,
				methods: draft.methods,
			})

			return Object.freeze({
				type,
				[widgetPluginBrand]: Object.freeze({ definition }),
			})
		},
	}

	return builder as unknown as WidgetPluginInterfacesPhase<Type>
}
