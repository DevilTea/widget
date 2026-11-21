/**
 * Immutable registered plugin universe.
 *
 * Normative contract: DevilTea/widget Discussion #12, Core composition architecture topic. Historical source (migrated): diagnostic #10 amendment "reconciliation audit" (WidgetSystem registration details)
 * and consolidated handoff §5.
 */

import type { DiagnosticCollector, RelativeSystemStructureDiagnosticInput } from './diagnostic'
import type { BlueprintCompileView, WidgetSystemBlueprint } from './internal/contract'
import type { AnyWidgetPlugin, AnyWidgetPluginTuple, WidgetInterfacesOf, WidgetPluginCapabilities, WidgetPluginTypeOf, WidgetSynchronousResult } from './plugin'
import type { WidgetContract, WidgetExpectedPluginTypeOf, WidgetInterfaces, WidgetMemberKey, WidgetSlotsOf } from './types'
import { compileBlueprint } from './blueprint/index'
import { isCoreWidgetPlugin, readWidgetPluginDefinition } from './plugin'

/**
 * The semantic facts of one registered plugin. Prose and schema are not carried by Core: they are generated
 * from the plugin's `Interfaces` type by tooling.
 */
export interface WidgetCatalogEntry {
	readonly type: string
	/** Declaration presence; the same object as `plugin.capabilities`. */
	readonly capabilities: WidgetPluginCapabilities
	/** The declared slot names in declaration order. Null means no slots capability; empty means explicitly empty. */
	readonly slots: readonly WidgetMemberKey[] | null
}

export interface WidgetCatalog {
	readonly widgets: readonly WidgetCatalogEntry[]
}

export type WidgetSystemValidateStructureContext<Plugins extends AnyWidgetPluginTuple>
	= & {
		readonly blueprint: BlueprintCompileView<Plugins>
	}
	& DiagnosticCollector<RelativeSystemStructureDiagnosticInput<Plugins>>

/** `Result` is the validator's own return type (see `WidgetSynchronousResult`). */
export type WidgetSystemValidateStructure<Plugins extends AnyWidgetPluginTuple, Result = unknown> = (ctx: WidgetSystemValidateStructureContext<Plugins>) => WidgetSynchronousResult<Result>

export interface CreateWidgetSystemOptions<Plugins extends AnyWidgetPluginTuple, Result = unknown> {
	readonly plugins: Plugins
	readonly validateStructure?: WidgetSystemValidateStructure<Plugins, Result>
}

/** The plugin types the slots of `Interfaces` name: the members of a plain union and the `Types` of a contract. */
type ExpectedPluginTypeOfSlots<Interfaces extends WidgetInterfaces> = WidgetSlotsOf<Interfaces> extends infer Slots
	? [Slots] extends [never]
			? never
			: { [Name in keyof Slots]-?: WidgetExpectedPluginTypeOf<Slots[Name]> }[keyof Slots]
	: never

/**
 * The plugin types some registered plugin's slot expects but `Plugins` does not register. `never` for a
 * loosely typed System (a plugin typed with a broad `string` may be any of them).
 */
export type UnregisteredSlotPluginTypeOf<Plugins extends AnyWidgetPluginTuple> = Exclude<
	Plugins[number] extends infer Plugin
		? Plugin extends AnyWidgetPlugin ? ExpectedPluginTypeOfSlots<WidgetInterfacesOf<Plugin>> : never
		: never,
	WidgetPluginTypeOf<Plugins[number]>
>

/**
 * What `plugins` is checked against when a slot expects a plugin type the System does not register;
 * `Type` names it. Type-level only: nothing is checked at run time.
 */
export interface WidgetSystemSlotTypeViolation<Type extends string> {
	readonly 'widget-core: a slot expects a plugin type that is not registered in this System': Type
}

type ContractSectionName = 'state' | 'properties' | 'methods' | 'events'

/**
 * The members of one section of a contract's `Shape` that `Target` does not satisfy, as messages: a member
 * the plugin does not declare, or one whose type is not assignable to the contract's.
 */
type ContractSectionViolation<Shape, Target, Section extends ContractSectionName, Subject extends string> = Shape extends Record<Section, infer Expected>
	? (Target extends Record<Section, infer Declared> ? Declared : Record<never, never>) extends infer Actual
			? {
					[Member in Extract<keyof Expected, string>]: Member extends keyof Actual
						? [Actual[Member]] extends [Expected[Member]]
								? never
								: `${Subject} declares the ${Section} member "${Member}" with a type that is not assignable to the contract's`
						: `${Subject} declares no ${Section} member "${Member}"`
				}[Extract<keyof Expected, string>]
			: never
	: never

type ContractViolation<Shape, Target, Subject extends string>
	= | ContractSectionViolation<Shape, Target, 'state', Subject>
		| ContractSectionViolation<Shape, Target, 'properties', Subject>
		| ContractSectionViolation<Shape, Target, 'methods', Subject>
		| ContractSectionViolation<Shape, Target, 'events', Subject>

/** The contract violations of the slots of one registered plugin (`Parent`), against the plugins its contracts name. */
type SlotContractViolationOfPlugin<Plugins extends AnyWidgetPluginTuple, Parent extends AnyWidgetPlugin> = WidgetSlotsOf<WidgetInterfacesOf<Parent>> extends infer Slots
	? [Slots] extends [never]
			? never
			: {
					[Name in Extract<keyof Slots, string>]: Slots[Name] extends WidgetContract<infer Shape, infer Types>
						? Types extends string
							// An unregistered name selects no plugin here; it is reported by the registration check.
							? Extract<Plugins[number], { readonly type: Types }> extends infer Target
								? Target extends AnyWidgetPlugin
									? ContractViolation<Shape, WidgetInterfacesOf<Target>, `plugin "${Types}" (expected by slot "${Name}" of plugin "${WidgetPluginTypeOf<Parent>}")`>
									: never
								: never
							: never
						: never
				}[Extract<keyof Slots, string>]
	: never

/**
 * Every way a registered plugin fails the `WidgetContract` of a slot that names it, as messages naming the
 * plugin and the member; `never` when every listed plugin satisfies its contracts. A contract without `Types`
 * names no plugin and is not checked.
 */
export type SlotContractViolationOf<Plugins extends AnyWidgetPluginTuple> = Plugins[number] extends infer Parent
	? Parent extends AnyWidgetPlugin ? SlotContractViolationOfPlugin<Plugins, Parent> : never
	: never

/**
 * What `plugins` is checked against when a plugin named by a slot's `WidgetContract` does not have the members
 * the contract's `Shape` declares; `Reason` names the plugin and the member. Type-level only.
 */
export interface WidgetSystemSlotContractViolation<Reason extends string> {
	readonly 'widget-core: a plugin does not satisfy the WidgetContract of a slot that expects it': Reason
}

type IsAnyType<T> = 0 extends 1 & T ? true : false

type WidgetSystemSlotTypeCheck<Plugins extends AnyWidgetPluginTuple> = [UnregisteredSlotPluginTypeOf<Plugins>] extends [never]
	? unknown
	: { readonly plugins: WidgetSystemSlotTypeViolation<UnregisteredSlotPluginTypeOf<Plugins>> }

type WidgetSystemSlotContractCheck<Plugins extends AnyWidgetPluginTuple> = [SlotContractViolationOf<Plugins>] extends [never]
	? unknown
	: { readonly plugins: WidgetSystemSlotContractViolation<SlotContractViolationOf<Plugins>> }

/**
 * `unknown` (an intersection identity) when every plugin type a slot names is registered and every plugin
 * named by a slot's `WidgetContract` satisfies the contract's `Shape`. A loosely typed System (an `any`-typed
 * entry, or a plugin typed with a broad `string`) is left unchecked.
 */
export type WidgetSystemPluginsCheck<Plugins extends AnyWidgetPluginTuple> = IsAnyType<Plugins[number]> extends true
	? unknown
	: IsAnyType<UnregisteredSlotPluginTypeOf<Plugins>> extends true
		? unknown
		: string extends WidgetPluginTypeOf<Plugins[number]>
			? unknown
			: WidgetSystemSlotTypeCheck<Plugins> & WidgetSystemSlotContractCheck<Plugins>

/**
 * Selects one registered plugin by its `type` discriminator.
 */
export type WidgetPluginOf<Plugins extends AnyWidgetPluginTuple, Type extends string> = Extract<Plugins[number], { readonly type: Type }>

/** The registered plugin types that are string literals; a plugin typed with a broad `string` adds none. */
type WidgetPluginLiteralTypeOf<Plugins extends AnyWidgetPluginTuple> = WidgetPluginTypeOf<Plugins[number]> extends infer Type
	? Type extends string ? (string extends Type ? never : Type) : never
	: never

/**
 * `getPlugin` overloads. `Plugins` appears only in type-parameter constraints and in `WidgetPluginOf`, so
 * a precisely typed System stays assignable to a loosely typed one (`WidgetSystem`).
 */
interface WidgetSystemGetPlugin<Plugins extends AnyWidgetPluginTuple> {
	/** A registered literal type (or a union of them): that exact plugin. */
	<Type extends WidgetPluginLiteralTypeOf<Plugins>>(type: Type): WidgetPluginOf<Plugins, Type>
	/** Any type on a loosely typed System (one with a broad `string` plugin type), which may be unregistered. */
	<Type extends WidgetPluginTypeOf<Plugins[number]>>(type: Type): AnyWidgetPlugin | null
	/** A broad `string`, which may name no registered plugin. An unregistered literal on a precisely typed System stays a type error. */
	<Type extends string>(type: string extends Type ? Type : never): AnyWidgetPlugin | null
}

export interface WidgetSystem<Plugins extends AnyWidgetPluginTuple = AnyWidgetPluginTuple> {
	/**
	 * The registered plugin tuple. It defines this instance's TypeScript universe; there is no
	 * global/module augmentation.
	 */
	readonly plugins: Plugins
	readonly validateStructure: WidgetSystemValidateStructure<Plugins> | null
	readonly catalog: WidgetCatalog
	/** The registered plugin of `type`, or `null` when no plugin of that type is registered. */
	getPlugin: WidgetSystemGetPlugin<Plugins>
	/**
	 * The compilation boundary. The input is `unknown` because JSON-parsed/untrusted document data is
	 * the real boundary; malformed input still produces an inspectable Blueprint.
	 *
	 * Ownership: `definition` is retained **by reference**. `blueprint.source` is that exact value and
	 * each recovered node's `source` is a reference into the same graph; Core never clones, freezes or
	 * Proxy-wraps it. Passing it here transfers semantic ownership: neither the caller nor any reader of
	 * `blueprint.source` may mutate it (or anything inside it) afterwards, and behavior after such a
	 * mutation is unspecified. Pass a copy (for example `structuredClone` for JSON-domain data) to keep
	 * editing your own object.
	 */
	createBlueprint: (definition: unknown) => WidgetSystemBlueprint<Plugins>
	/**
	 * Parses `text` with `JSON.parse` and compiles the result. Equivalent to
	 * `createBlueprint(JSON.parse(text))`, including its diagnostics: a value Core parsed itself can only
	 * leave the authored JSON domain through a non-finite number (`1e400` parses to `Infinity`, diagnosed as
	 * `json-incompatible-value` / `non-finite-number`) or through nesting deeper than `MAX_JSON_DEPTH`, so Core
	 * replaces the descriptor-level JSON-domain inspection with a cheaper scan for exactly those two cases and
	 * runs the full inspection when the scan finds either. `sourceJsonCompatible` is `true` only when that
	 * proof succeeds. Invalid JSON text throws the `SyntaxError` from `JSON.parse`, unchanged. The parsed
	 * source is referenced by nothing but the Blueprint.
	 */
	createBlueprintFromJson: (text: string) => WidgetSystemBlueprint<Plugins>
}

export type WidgetSystemConfigurationErrorCode = 'invalid-options' | 'foreign-plugin' | 'duplicate-plugin-type'

/**
 * Thrown by `createWidgetSystem` for invalid options or an invalid plugin registration. Discriminate by
 * class and `code`; `message` is not protocol. The options shape is checked first, then the plugin
 * entries in tuple order.
 *
 * - `invalid-options`: `options` is not an object, `options.plugins` is not an array, or
 *   `options.validateStructure` is present (neither `undefined` nor `null`) but not a function.
 *   `pluginIndex`, `pluginType` and `firstPluginIndex` are `null`.
 * - `foreign-plugin`: the entry at `pluginIndex` was not completed by this loaded module instance
 *   (another module instance or a structural look-alike). `pluginType` is its `type` when a string,
 *   else `null`. `firstPluginIndex` is `null`.
 * - `duplicate-plugin-type`: the entry at `pluginIndex` repeats `pluginType`, first registered at
 *   `firstPluginIndex`.
 */
export class WidgetSystemConfigurationError extends Error {
	override readonly name = 'WidgetSystemConfigurationError'

	constructor(
		readonly code: WidgetSystemConfigurationErrorCode,
		readonly pluginIndex: number | null,
		readonly pluginType: string | null,
		readonly firstPluginIndex: number | null = null,
		message = code === 'invalid-options'
			? 'The createWidgetSystem options are malformed.'
			: code === 'foreign-plugin'
				? `The widget plugin at index ${pluginIndex} was not created by this widget core instance.`
				: `Duplicate widget plugin type "${pluginType}" at index ${pluginIndex} (first registered at index ${firstPluginIndex}).`,
	) {
		super(message)
	}
}

function describeOptionValue(value: unknown): string {
	return value === null ? 'null' : Array.isArray(value) ? 'array' : typeof value
}

function invalidOptions(problem: string): WidgetSystemConfigurationError {
	return new WidgetSystemConfigurationError('invalid-options', null, null, null, `Invalid createWidgetSystem options: ${problem}.`)
}

/**
 * Checks the options shape before any plugin entry is inspected.
 */
function assertWidgetSystemOptions(options: unknown): asserts options is CreateWidgetSystemOptions<AnyWidgetPluginTuple> {
	if (typeof options !== 'object' || options === null)
		throw invalidOptions(`expected an options object, got ${describeOptionValue(options)}`)

	const { plugins, validateStructure } = options as { readonly plugins?: unknown, readonly validateStructure?: unknown }
	if (!Array.isArray(plugins))
		throw invalidOptions(`"plugins" must be an array of widget plugins, got ${describeOptionValue(plugins)}`)
	if (validateStructure !== undefined && validateStructure !== null && typeof validateStructure !== 'function')
		throw invalidOptions(`"validateStructure" must be a function when provided, got ${describeOptionValue(validateStructure)}`)
}

/**
 * Best-effort read of a foreign entry's `type`; a throwing accessor must not leak as an uncoded failure.
 */
function readForeignPluginType(entry: unknown): string | null {
	try {
		const type = (entry as { readonly type?: unknown } | null | undefined)?.type
		return typeof type === 'string' ? type : null
	}
	catch {
		return null
	}
}

/**
 * Creates an instance-scoped, immutable widget system. Malformed options, foreign plugins and duplicate
 * `plugin.type` are rejected with a `WidgetSystemConfigurationError`. A slot that names a plugin type the
 * System does not register, and a plugin that does not satisfy the `WidgetContract` of a slot that names it,
 * are type errors on `plugins` (type-level only).
 */
export function createWidgetSystem<const Plugins extends AnyWidgetPluginTuple, Result = unknown>(
	options: CreateWidgetSystemOptions<Plugins, Result> & WidgetSystemPluginsCheck<Plugins>,
): WidgetSystem<Plugins> {
	assertWidgetSystemOptions(options)

	const plugins = Object.freeze([...options.plugins]) as unknown as Plugins
	const pluginsByType = new Map<string, AnyWidgetPlugin>()
	const firstIndexByType = new Map<string, number>()

	// Tuple order; the first offending index wins, and provenance precedes the duplicate check.
	for (const [index, plugin] of plugins.entries()) {
		if (!isCoreWidgetPlugin(plugin)) {
			throw new WidgetSystemConfigurationError('foreign-plugin', index, readForeignPluginType(plugin))
		}

		const firstIndex = firstIndexByType.get(plugin.type)
		if (firstIndex !== undefined)
			throw new WidgetSystemConfigurationError('duplicate-plugin-type', index, plugin.type, firstIndex)

		firstIndexByType.set(plugin.type, index)
		pluginsByType.set(plugin.type, plugin)
	}

	const catalog: WidgetCatalog = Object.freeze({
		widgets: Object.freeze(plugins.map((plugin) => {
			const slots = readWidgetPluginDefinition(plugin).slots
			return Object.freeze({
				type: plugin.type,
				capabilities: plugin.capabilities,
				slots: slots === null ? null : Object.freeze([...slots.keys()]),
			})
		})),
	})

	const system: WidgetSystem<Plugins> = {
		plugins,
		validateStructure: options.validateStructure ?? null,
		catalog,

		getPlugin: ((type: string) => pluginsByType.get(type) ?? null) as WidgetSystemGetPlugin<Plugins>,

		createBlueprint(definition) {
			return compileBlueprint(system, definition)
		},

		createBlueprintFromJson(text) {
			return compileBlueprint(system, JSON.parse(text), true)
		},
	}

	return Object.freeze(system)
}
