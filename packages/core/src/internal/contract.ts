/**
 * Public Blueprint/Runtime surface plus the framework-internal Blueprint -> Runtime data model.
 *
 * Normative source: issue #10 checkpoint B/C/E/F, amendments "Blueprint recovery edge-case contract",
 * "dependency resolution and compiled-edge invariants", "simplify method graph semantics",
 * "disposed Runtime exact error surface", "overrideStateDefaults is best-effort" and consolidated
 * handoff §6/§9/§11/§13/§14/§15/§19/§20.
 *
 * The public interfaces in this module are re-exported from the package entry. The `Compiled*` model
 * is produced by the Blueprint compiler (U2) and consumed by the Runtime factory (U3); it is not part
 * of the published contract and may be extended additively by the compiler as long as the Runtime's
 * needs keep being satisfied.
 */

import type { DependencyRefinement } from '../dep'
import type { ExecutionResult } from '../execution-result'
import type {
	BlueprintDependencyMember,
	BlueprintDependencyReference,
	BlueprintIssue,
	RuntimeLevelIssue,
	RuntimeMethodIssue,
	RuntimePropertyIssue,
	RuntimeStateIssue,
	WidgetSystemRuntimeIssue,
} from '../issue'
import type {
	AnyWidgetPlugin,
	AnyWidgetPluginTuple,
	ErasedWidgetMethodDefinition,
	ErasedWidgetPropertyDefinition,
	ErasedWidgetStateMemberDefinition,
	WidgetInterfacesOf,
	WidgetPlugin,
	WidgetPluginTypeOf,
} from '../plugin'
import type { WidgetSystem } from '../system'
import type {
	WidgetCapabilityOf,
	WidgetId,
	WidgetInterfaces,
	WidgetMemberKey,
	WidgetMethodKeyOf,
	WidgetMethodOf,
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
} from '../types'

// -------------------------------------------------------------------------------------------------
// Public Blueprint nodes and navigation
// -------------------------------------------------------------------------------------------------

export type WidgetSystemBlueprintStatus = 'valid' | 'invalid'

export interface BlueprintWidgetNodeBase<Plugins extends AnyWidgetPluginTuple = AnyWidgetPluginTuple> {
	/**
	 * The exact source fragment for this recovered node. Never mutated, cloned or frozen by the core.
	 */
	readonly rawDefinition: unknown
	getIssues: () => readonly BlueprintIssue<Plugins>[]
}

/**
 * A node whose widget semantic identity could not be established (missing/invalid `id`,
 * missing/invalid `type`, or unknown plugin type).
 */
export interface UnresolvedBlueprintWidgetNode<Plugins extends AnyWidgetPluginTuple = AnyWidgetPluginTuple> extends BlueprintWidgetNodeBase<Plugins> {
	readonly resolved: false
}

/**
 * Complete declared semantic slot map. Only declared slots appear, every declared slot exists, and an
 * empty slot is an empty array. A plugin without slot capability has `{}`.
 */
export type BlueprintSemanticSlots<
	Interfaces extends WidgetInterfaces,
	Plugins extends AnyWidgetPluginTuple,
> = {
	readonly [Name in WidgetSlotNameOf<Interfaces>]: readonly BlueprintWidgetNode<Plugins>[]
}

export type BlueprintNodeConfigFields<Interfaces extends WidgetInterfaces> = [WidgetCapabilityOf<Interfaces, 'config'>] extends [never]
	? unknown
	: {
			/**
			 * Typed raw config, or `null` when the raw config was omitted or invalid. The exact source
			 * fragment always stays available through `rawDefinition`.
			 */
			readonly rawConfig: WidgetRawConfigOf<Interfaces> | null
			readonly config: WidgetResolvedConfigOf<Interfaces>
		}

/**
 * A node with established widget semantic identity. Later config/slot/structure/dependency errors keep
 * the node resolved while the Blueprint becomes invalid.
 */
export type ResolvedBlueprintWidgetNodeFor<
	Plugin extends AnyWidgetPlugin,
	Plugins extends AnyWidgetPluginTuple = AnyWidgetPluginTuple,
>
	= & BlueprintWidgetNodeBase<Plugins>
		& {
			readonly resolved: true
			readonly id: WidgetId
			readonly type: WidgetPluginTypeOf<Plugin>
			readonly plugin: Plugin
			readonly slots: BlueprintSemanticSlots<WidgetInterfacesOf<Plugin>, Plugins>
		}
		& BlueprintNodeConfigFields<WidgetInterfacesOf<Plugin>>

export type ResolvedBlueprintWidgetNode<Plugins extends AnyWidgetPluginTuple = AnyWidgetPluginTuple> = Plugins[number] extends infer Plugin
	? Plugin extends AnyWidgetPlugin
		? ResolvedBlueprintWidgetNodeFor<Plugin, Plugins>
		: never
	: never

export type BlueprintWidgetNode<Plugins extends AnyWidgetPluginTuple = AnyWidgetPluginTuple>
	= | UnresolvedBlueprintWidgetNode<Plugins>
		| ResolvedBlueprintWidgetNode<Plugins>

/**
 * The semantic node type a plugin author sees for its own widget.
 */
export type SelfBlueprintWidgetNode<Interfaces extends WidgetInterfaces> = ResolvedBlueprintWidgetNodeFor<WidgetPlugin<string, Interfaces>>

/**
 * Compile-time view of {@link BlueprintSemanticSlots}: same complete declared-slot map, but every
 * child is a {@link BlueprintWidgetNodeView} instead of a full node — the view is recursive all the
 * way down, not just at the top level.
 */
export type BlueprintSemanticSlotsView<
	Interfaces extends WidgetInterfaces,
	Plugins extends AnyWidgetPluginTuple,
> = {
	readonly [Name in WidgetSlotNameOf<Interfaces>]: readonly BlueprintWidgetNodeView<Plugins>[]
}

/**
 * Compile-time view of {@link ResolvedBlueprintWidgetNodeFor}: no `getIssues()`, and `.slots`'
 * children are themselves views (recursive), not full nodes.
 */
export type ResolvedBlueprintWidgetNodeViewFor<
	Plugin extends AnyWidgetPlugin,
	Plugins extends AnyWidgetPluginTuple = AnyWidgetPluginTuple,
>
	= & Omit<ResolvedBlueprintWidgetNodeFor<Plugin, Plugins>, 'getIssues' | 'slots'>
		& {
			readonly slots: BlueprintSemanticSlotsView<WidgetInterfacesOf<Plugin>, Plugins>
		}

/**
 * The resolved-only compile-time node view, distributed over the registered plugin tuple, for
 * compile-time locations that are only reachable from a resolved node (slot / slot-child).
 */
export type ResolvedBlueprintWidgetNodeView<Plugins extends AnyWidgetPluginTuple = AnyWidgetPluginTuple> = Plugins[number] extends infer Plugin
	? Plugin extends AnyWidgetPlugin
		? ResolvedBlueprintWidgetNodeViewFor<Plugin, Plugins>
		: never
	: never

/**
 * Compile-time view of {@link BlueprintWidgetNode}: same navigation shape, but with `getIssues()`
 * removed recursively — including through `.slots`' children — not just at the top level.
 *
 * Used only for the types compile-time callbacks (`validateStructure`, `registerDeps`) and
 * {@link BlueprintCompileView} see. The underlying object is not changed at runtime — the very same
 * node object keeps `getIssues` once it is later exposed through the finalized Blueprint — only the
 * static type these compile-time surfaces expose omits it, because compilation is still in progress
 * and no final issue snapshot exists yet.
 */
export type BlueprintWidgetNodeView<Plugins extends AnyWidgetPluginTuple = AnyWidgetPluginTuple>
	= | Omit<UnresolvedBlueprintWidgetNode<Plugins>, 'getIssues'>
		| ResolvedBlueprintWidgetNodeView<Plugins>

/**
 * Compile-time view of {@link SelfBlueprintWidgetNode}, for the same reason as
 * {@link BlueprintWidgetNodeView}.
 */
export type SelfBlueprintWidgetNodeView<Interfaces extends WidgetInterfaces> = ResolvedBlueprintWidgetNodeViewFor<WidgetPlugin<string, Interfaces>>

/**
 * Topology/navigation placement of a recovered node.
 *
 * `slot` is a confirmed semantic slot edge; `raw-slot` is a recovered source edge that was not
 * confirmed semantically.
 */
export type WidgetLocation<Plugins extends AnyWidgetPluginTuple = AnyWidgetPluginTuple>
	= | {
		readonly type: 'root'
	}
	| {
		readonly type: 'slot'
		readonly parent: ResolvedBlueprintWidgetNode<Plugins>
		readonly slot: WidgetMemberKey
		readonly index: number
	}
	| {
		readonly type: 'raw-slot'
		readonly parent: BlueprintWidgetNode<Plugins>
		readonly slot: string
		readonly index: number
	}

/**
 * Compile-time view of {@link WidgetLocation}: same topology shape, but `parent` is a
 * {@link BlueprintWidgetNodeView} / {@link ResolvedBlueprintWidgetNodeView} rather than a full node —
 * a `validateStructure`/`registerDeps` author reaching a location through `BlueprintCompileView`
 * cannot get from there to `getIssues()` either.
 */
export type WidgetLocationView<Plugins extends AnyWidgetPluginTuple = AnyWidgetPluginTuple>
	= | {
		readonly type: 'root'
	}
	| {
		readonly type: 'slot'
		readonly parent: ResolvedBlueprintWidgetNodeView<Plugins>
		readonly slot: WidgetMemberKey
		readonly index: number
	}
	| {
		readonly type: 'raw-slot'
		readonly parent: BlueprintWidgetNodeView<Plugins>
		readonly slot: string
		readonly index: number
	}

/**
 * Read-only semantic view handed to compile-time callbacks (`validateStructure`, `registerDeps`).
 *
 * It intentionally exposes no `getIssues()`, no final status, and no runtime machinery, because
 * compilation is still in progress.
 */
export interface BlueprintCompileView<Plugins extends AnyWidgetPluginTuple = AnyWidgetPluginTuple> {
	readonly root: BlueprintWidgetNodeView<Plugins>
	getWidget: (id: WidgetId) => BlueprintWidgetNodeView<Plugins> | null
	getParent: (node: BlueprintWidgetNodeView<Plugins>) => BlueprintWidgetNodeView<Plugins> | null
	getLocation: (node: BlueprintWidgetNodeView<Plugins>) => WidgetLocationView<Plugins> | null
	getChildren: (node: BlueprintWidgetNodeView<Plugins>) => readonly BlueprintWidgetNodeView<Plugins>[]
	getChildrenAt: (node: BlueprintWidgetNodeView<Plugins>, slot: WidgetMemberKey) => readonly BlueprintWidgetNodeView<Plugins>[]
}

/**
 * Read-only valid-Blueprint view handed to runtime semantic callbacks (`compute`, `execute`).
 */
export interface ValidBlueprintView<Plugins extends AnyWidgetPluginTuple = AnyWidgetPluginTuple> {
	readonly root: ResolvedBlueprintWidgetNode<Plugins>
	getWidget: (id: WidgetId) => ResolvedBlueprintWidgetNode<Plugins> | null
	getParent: (node: ResolvedBlueprintWidgetNode<Plugins>) => ResolvedBlueprintWidgetNode<Plugins> | null
	getLocation: (node: ResolvedBlueprintWidgetNode<Plugins>) => WidgetLocation<Plugins> | null
	getChildren: (node: ResolvedBlueprintWidgetNode<Plugins>) => readonly ResolvedBlueprintWidgetNode<Plugins>[]
	getChildrenAt: (node: ResolvedBlueprintWidgetNode<Plugins>, slot: WidgetMemberKey) => readonly ResolvedBlueprintWidgetNode<Plugins>[]
}

// -------------------------------------------------------------------------------------------------
// Public Blueprint
// -------------------------------------------------------------------------------------------------

/**
 * Typed raw representation of one widget. Not the compiler input type: `createBlueprint` takes
 * `unknown` because JSON-parsed/untrusted input is the real boundary.
 */
export type RawWidgetDefinitionFor<
	Plugin extends AnyWidgetPlugin,
	Plugins extends AnyWidgetPluginTuple,
>
	= & {
		readonly id: WidgetId
		readonly type: WidgetPluginTypeOf<Plugin>
	}
	& ([WidgetCapabilityOf<WidgetInterfacesOf<Plugin>, 'config'>] extends [never]
		? unknown
		: { readonly config?: WidgetRawConfigOf<WidgetInterfacesOf<Plugin>> })
	& ([WidgetCapabilityOf<WidgetInterfacesOf<Plugin>, 'slots'>] extends [never]
		? unknown
		: {
				readonly slots?: {
					readonly [Name in WidgetSlotNameOf<WidgetInterfacesOf<Plugin>>]?: readonly RawWidgetDefinition<Plugins>[]
				}
			})

export type RawWidgetDefinition<Plugins extends AnyWidgetPluginTuple> = Plugins[number] extends infer Plugin
	? Plugin extends AnyWidgetPlugin
		? RawWidgetDefinitionFor<Plugin, Plugins>
		: never
	: never

export interface WidgetSystemBlueprintBase<Plugins extends AnyWidgetPluginTuple> {
	readonly system: WidgetSystem<Plugins>
	/**
	 * The exact entire unknown input this Blueprint was compiled from.
	 */
	readonly rawDefinition: unknown
	/**
	 * Observably equivalent to `blueprint.system.createBlueprint(next)`.
	 */
	recompile: (definition: unknown) => WidgetSystemBlueprint<Plugins>
}

export interface ValidWidgetSystemBlueprint<Plugins extends AnyWidgetPluginTuple = AnyWidgetPluginTuple> extends WidgetSystemBlueprintBase<Plugins> {
	readonly status: 'valid'
	readonly root: ResolvedBlueprintWidgetNode<Plugins>
	getWidget: (id: WidgetId) => ResolvedBlueprintWidgetNode<Plugins> | null
	getParent: (node: BlueprintWidgetNode<Plugins>) => ResolvedBlueprintWidgetNode<Plugins> | null
	getLocation: (node: BlueprintWidgetNode<Plugins>) => WidgetLocation<Plugins> | null
	getChildren: (node: BlueprintWidgetNode<Plugins>) => readonly ResolvedBlueprintWidgetNode<Plugins>[]
	getChildrenAt: (node: BlueprintWidgetNode<Plugins>, slot: WidgetMemberKey) => readonly ResolvedBlueprintWidgetNode<Plugins>[]
	getCollectedIssues: () => readonly never[]
	createRuntime: (options?: CreateWidgetSystemRuntimeOptions) => WidgetSystemRuntime<Plugins>
}

export interface InvalidWidgetSystemBlueprint<Plugins extends AnyWidgetPluginTuple = AnyWidgetPluginTuple> extends WidgetSystemBlueprintBase<Plugins> {
	readonly status: 'invalid'
	readonly root: BlueprintWidgetNode<Plugins>
	getWidget: (id: WidgetId) => BlueprintWidgetNode<Plugins> | null
	getParent: (node: BlueprintWidgetNode<Plugins>) => BlueprintWidgetNode<Plugins> | null
	getLocation: (node: BlueprintWidgetNode<Plugins>) => WidgetLocation<Plugins> | null
	getChildren: (node: BlueprintWidgetNode<Plugins>) => readonly BlueprintWidgetNode<Plugins>[]
	getChildrenAt: (node: BlueprintWidgetNode<Plugins>, slot: WidgetMemberKey) => readonly BlueprintWidgetNode<Plugins>[]
	getCollectedIssues: () => readonly BlueprintIssue<Plugins>[]
}

/**
 * Immutable compiled semantic snapshot of one unknown/raw widget tree.
 *
 * A valid Blueprint narrows every node query to resolved nodes, narrows collected issues to empty and
 * is the only variant exposing `createRuntime`.
 */
export type WidgetSystemBlueprint<Plugins extends AnyWidgetPluginTuple = AnyWidgetPluginTuple>
	= | ValidWidgetSystemBlueprint<Plugins>
		| InvalidWidgetSystemBlueprint<Plugins>

// -------------------------------------------------------------------------------------------------
// Public Runtime
// -------------------------------------------------------------------------------------------------

export interface CreateWidgetSystemRuntimeOptions {
	/**
	 * Initialization-only, best-effort candidate map. Own-property presence decides whether an
	 * override exists, so an explicit `undefined` is still an explicit candidate.
	 */
	readonly overrideStateDefaults?: Readonly<Record<WidgetId, Readonly<Record<WidgetMemberKey, unknown>>>>
}

export interface RuntimeState<T> {
	get: () => T | null
	set: (value: T) => ExecutionResult<T, RuntimeStateIssue>
	subscribe: (listener: (value: T | null) => void) => () => void
	getIssues: () => readonly RuntimeStateIssue[]
	subscribeIssues: (listener: (issues: readonly RuntimeStateIssue[]) => void) => () => void
}

export interface RuntimeProperty<T> {
	get: () => ExecutionResult<T | null, RuntimePropertyIssue>
	subscribe: (listener: (result: ExecutionResult<T | null, RuntimePropertyIssue>) => void) => () => void
	getIssues: () => readonly RuntimePropertyIssue[]
	subscribeIssues: (listener: (issues: readonly RuntimePropertyIssue[]) => void) => () => void
}

export interface RuntimeMethod<Fn extends (...args: any[]) => any> {
	(...args: Parameters<Fn>): ExecutionResult<ReturnType<Fn> | null, RuntimeMethodIssue>
	getIssues: () => readonly RuntimeMethodIssue[]
	subscribeIssues: (listener: (issues: readonly RuntimeMethodIssue[]) => void) => () => void
}

export type RuntimeStateSurface<Interfaces extends WidgetInterfaces> = [WidgetStateOf<Interfaces>] extends [never]
	? unknown
	: {
			readonly state: {
				readonly [Key in WidgetStateKeyOf<Interfaces>]: RuntimeState<WidgetStateValueOf<Interfaces, Key>>
			}
		}

export type RuntimePropertySurface<Interfaces extends WidgetInterfaces> = [WidgetPropertiesOf<Interfaces>] extends [never]
	? unknown
	: {
			readonly properties: {
				readonly [Name in WidgetPropertyKeyOf<Interfaces>]: RuntimeProperty<WidgetPropertyValueOf<Interfaces, Name>>
			}
		}

/**
 * Gated on capability presence (`WidgetMethodsOf`), not on the declared member-key union: an
 * explicitly-declared-empty `methods: {}` capability is present (and therefore exposes an empty
 * `methods` surface), matching Runtime assembly's `definition.methods !== null` check. Gating on
 * `WidgetMethodKeyOf` instead would collapse "declared empty" into "absent" because both have an
 * empty key union.
 */
export type RuntimeMethodSurface<Interfaces extends WidgetInterfaces> = [WidgetMethodsOf<Interfaces>] extends [never]
	? unknown
	: {
			readonly methods: {
				readonly [Name in WidgetMethodKeyOf<Interfaces>]: RuntimeMethod<WidgetMethodOf<Interfaces, Name>>
			}
		}

export type RuntimeWidgetFor<
	Plugin extends AnyWidgetPlugin,
	Plugins extends AnyWidgetPluginTuple = AnyWidgetPluginTuple,
>
	= & {
		readonly id: WidgetId
		readonly type: WidgetPluginTypeOf<Plugin>
		readonly blueprint: ResolvedBlueprintWidgetNodeFor<Plugin, Plugins>
	}
	& RuntimeStateSurface<WidgetInterfacesOf<Plugin>>
	& RuntimePropertySurface<WidgetInterfacesOf<Plugin>>
	& RuntimeMethodSurface<WidgetInterfacesOf<Plugin>>

export type RuntimeWidget<Plugins extends AnyWidgetPluginTuple = AnyWidgetPluginTuple> = Plugins[number] extends infer Plugin
	? Plugin extends AnyWidgetPlugin
		? RuntimeWidgetFor<Plugin, Plugins>
		: never
	: never

/**
 * Executable instance of a valid Blueprint.
 *
 * After `dispose()`, `isDisposed` and `blueprint` stay readable while every live query/operation and
 * every new subscription throws `WidgetSystemRuntimeDisposedError`.
 */
export interface WidgetSystemRuntime<Plugins extends AnyWidgetPluginTuple = AnyWidgetPluginTuple> {
	readonly blueprint: ValidWidgetSystemBlueprint<Plugins>
	readonly isDisposed: boolean
	getWidget: (id: WidgetId) => RuntimeWidget<Plugins> | null
	/**
	 * Runtime-level issues only.
	 */
	getIssues: () => readonly RuntimeLevelIssue[]
	/**
	 * Runtime-level issues plus the current state/property/method issue snapshots, in deterministic
	 * order. Never history, and never activates property evaluation.
	 */
	getCollectedIssues: () => readonly WidgetSystemRuntimeIssue[]
	subscribeCollectedIssues: (listener: (issues: readonly WidgetSystemRuntimeIssue[]) => void) => () => void
	dispose: () => void
}

// -------------------------------------------------------------------------------------------------
// Internal compiled model (Blueprint -> Runtime)
// -------------------------------------------------------------------------------------------------

/**
 * Compiler-internal node identity. Never public.
 */
export type InternalNodeId = number

export const compiledDependencyBrand: unique symbol = Symbol('@deviltea/widget-core:compiled-dependency')

export interface CompiledDependencyBase {
	readonly [compiledDependencyBrand]: true
	readonly reference: BlueprintDependencyReference
	readonly refinements: readonly DependencyRefinement[]
}

/**
 * A dependency whose target node, capability and member were all resolved.
 */
export interface ResolvedCompiledDependency extends CompiledDependencyBase {
	readonly status: 'resolved'
	readonly targetNodeId: InternalNodeId
}

/**
 * The only legal non-resolved compiled leaf: an optional `parent` / `widget(id)` target with zero
 * cardinality. It contributes no graph edge, no effect and no cycle.
 */
export interface AbsentCompiledDependency extends CompiledDependencyBase {
	readonly status: 'absent'
}

export type CompiledDependency = ResolvedCompiledDependency | AbsentCompiledDependency

/**
 * Registered dependency container with every branded expression leaf replaced by its compiled leaf.
 */
export type CompiledDependencyTree
	= | CompiledDependency
		| { readonly [key: string]: CompiledDependencyTree }
		| readonly CompiledDependencyTree[]

export function isCompiledDependency(value: unknown): value is CompiledDependency {
	return typeof value === 'object' && value !== null && compiledDependencyBrand in value
}

export interface CompiledStateMember {
	readonly key: WidgetMemberKey
	readonly definition: ErasedWidgetStateMemberDefinition
}

export interface CompiledPropertyMember {
	readonly name: WidgetMemberKey
	readonly definition: ErasedWidgetPropertyDefinition
	readonly deps: CompiledDependencyTree
}

export interface CompiledMethodMember {
	readonly name: WidgetMemberKey
	readonly definition: ErasedWidgetMethodDefinition
	readonly deps: CompiledDependencyTree
	/**
	 * Transitive write effect from the Method write-effect fixed point. A writeful Method is valid;
	 * only a Property depending on one is not.
	 */
	readonly transitivelyWrites: boolean
}

export interface CompiledRawSlot {
	readonly slot: string
	/**
	 * One entry per recovered source position, including malformed values and sparse holes.
	 */
	readonly childNodeIds: readonly InternalNodeId[]
}

export interface CompiledWidgetNodeBase<Plugins extends AnyWidgetPluginTuple = AnyWidgetPluginTuple> {
	readonly nodeId: InternalNodeId
	readonly publicNode: BlueprintWidgetNode<Plugins>
	readonly rawDefinition: unknown
	readonly parentNodeId: InternalNodeId | null
	readonly location: WidgetLocation<Plugins>
	readonly rawSlots: readonly CompiledRawSlot[]
	readonly issues: readonly BlueprintIssue<Plugins>[]
}

export interface CompiledUnresolvedWidgetNode<Plugins extends AnyWidgetPluginTuple = AnyWidgetPluginTuple> extends CompiledWidgetNodeBase<Plugins> {
	readonly resolved: false
	/**
	 * A valid string id participates in the id index even when the node itself is unresolved.
	 */
	readonly id: WidgetId | null
}

export interface CompiledResolvedWidgetNode<Plugins extends AnyWidgetPluginTuple = AnyWidgetPluginTuple> extends CompiledWidgetNodeBase<Plugins> {
	readonly resolved: true
	readonly id: WidgetId
	readonly type: string
	readonly plugin: AnyWidgetPlugin
	readonly rawConfig: unknown
	readonly config: unknown
	/**
	 * Declared semantic slots only, complete, in declaration order.
	 */
	readonly semanticSlots: ReadonlyMap<WidgetMemberKey, readonly InternalNodeId[]>
	readonly state: ReadonlyMap<WidgetMemberKey, CompiledStateMember>
	readonly properties: ReadonlyMap<WidgetMemberKey, CompiledPropertyMember>
	readonly methods: ReadonlyMap<WidgetMemberKey, CompiledMethodMember>
}

export type CompiledWidgetNode<Plugins extends AnyWidgetPluginTuple = AnyWidgetPluginTuple>
	= | CompiledUnresolvedWidgetNode<Plugins>
		| CompiledResolvedWidgetNode<Plugins>

export interface CompiledMemberRef {
	readonly nodeId: InternalNodeId
	readonly member: BlueprintDependencyMember
}

/**
 * Graph analysis outcome. The SCC decomposition itself has no public/domain meaning; only the
 * derived facts do.
 */
export interface CompiledGraphAnalysis {
	/**
	 * Methods with a transitive write effect, as `${nodeId}:${methodName}` keys.
	 */
	readonly writefulMethods: ReadonlySet<string>
	/**
	 * Cyclic SCCs containing at least one Property. Each one invalidates the Blueprint.
	 */
	readonly invalidCycles: readonly (readonly CompiledMemberRef[])[]
}

/**
 * The compiled snapshot the Runtime factory consumes.
 */
export interface CompiledBlueprint<Plugins extends AnyWidgetPluginTuple = AnyWidgetPluginTuple> {
	readonly system: WidgetSystem<Plugins>
	readonly rawDefinition: unknown
	readonly status: WidgetSystemBlueprintStatus
	readonly rootNodeId: InternalNodeId
	/**
	 * Indexed by `InternalNodeId`.
	 */
	readonly nodes: readonly CompiledWidgetNode<Plugins>[]
	readonly nodeIdByPublicNode: ReadonlyMap<BlueprintWidgetNode<Plugins>, InternalNodeId>
	/**
	 * Cardinality index over valid string ids, including unresolved nodes.
	 */
	readonly nodeIdsByWidgetId: ReadonlyMap<WidgetId, readonly InternalNodeId[]>
	/**
	 * Semantic traversal order, used for deterministic diagnostic aggregation.
	 */
	readonly semanticOrder: readonly InternalNodeId[]
	readonly issues: readonly BlueprintIssue<Plugins>[]
	readonly analysis: CompiledGraphAnalysis
}

export const blueprintInternals: unique symbol = Symbol('@deviltea/widget-core:blueprint-internals')

/**
 * Attached by the Blueprint compiler to every Blueprint it produces. Not part of the published
 * Blueprint contract.
 */
export interface BlueprintInternalsCarrier<Plugins extends AnyWidgetPluginTuple = AnyWidgetPluginTuple> {
	readonly [blueprintInternals]: CompiledBlueprint<Plugins>
}

/**
 * Reads the compiled snapshot carried by a Blueprint.
 */
export function readCompiledBlueprint<Plugins extends AnyWidgetPluginTuple>(
	blueprint: WidgetSystemBlueprint<Plugins>,
): CompiledBlueprint<Plugins> {
	const carrier = blueprint as unknown as Partial<BlueprintInternalsCarrier<Plugins>>
	const compiled = carrier[blueprintInternals]

	if (compiled === undefined)
		throw new Error('The blueprint was not produced by this widget core build.')

	return compiled
}

/**
 * Signature the Blueprint compiler (U2) implements in `./blueprint/index.ts`.
 */
export type CompileBlueprintFn = <Plugins extends AnyWidgetPluginTuple>(
	system: WidgetSystem<Plugins>,
	definition: unknown,
) => WidgetSystemBlueprint<Plugins>

/**
 * Signature the Runtime factory (U3) implements in `./runtime/index.ts`.
 */
export type CreateWidgetSystemRuntimeFn = <Plugins extends AnyWidgetPluginTuple>(
	blueprint: ValidWidgetSystemBlueprint<Plugins>,
	options?: CreateWidgetSystemRuntimeOptions,
) => WidgetSystemRuntime<Plugins>
