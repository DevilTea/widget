/**
 * Immutable registered plugin universe.
 *
 * Normative source: diagnostic #10 amendment "reconciliation audit" (WidgetSystem registration details)
 * and consolidated handoff §5.
 */

import type { DiagnosticCollector, RelativeSystemStructureDiagnosticInput } from './diagnostic'
import type { BlueprintCompileView, WidgetSystemBlueprint } from './internal/contract'
import type { AnyWidgetPlugin, AnyWidgetPluginTuple, WidgetPluginConfigMetadata, WidgetPluginTypeOf, WidgetSynchronousVoidResult } from './plugin'
import { compileBlueprint } from './blueprint/index'
import { isCoreWidgetPlugin } from './plugin'
import { createReadonlyMap } from './readonly-map'

export interface WidgetCatalogEntry {
	readonly type: string
	readonly description: string
	/** Null means no config capability; otherwise schema may itself be null. */
	readonly config: WidgetPluginConfigMetadata | null
	readonly descriptions: {
		readonly config: string | null
		readonly slots: ReadonlyMap<string, string> | null
	}
}

export interface WidgetCatalog {
	readonly widgets: readonly WidgetCatalogEntry[]
}

export type WidgetSystemValidateStructureContext<Plugins extends AnyWidgetPluginTuple>
	= & {
		readonly blueprint: BlueprintCompileView<Plugins>
	}
	& DiagnosticCollector<RelativeSystemStructureDiagnosticInput<Plugins>>

export type WidgetSystemValidateStructure<Plugins extends AnyWidgetPluginTuple> = (ctx: WidgetSystemValidateStructureContext<Plugins>) => WidgetSynchronousVoidResult

export interface CreateWidgetSystemOptions<Plugins extends AnyWidgetPluginTuple> {
	readonly plugins: Plugins
	readonly validateStructure?: WidgetSystemValidateStructure<Plugins>
}

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
 * `plugin.type` are rejected with a `WidgetSystemConfigurationError`.
 */
export function createWidgetSystem<const Plugins extends AnyWidgetPluginTuple>(
	options: CreateWidgetSystemOptions<Plugins>,
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
		widgets: Object.freeze(plugins.map(plugin => Object.freeze({
			type: plugin.type,
			description: plugin.description,
			config: plugin.config,
			descriptions: Object.freeze({
				config: plugin.descriptions.config,
				slots: plugin.descriptions.slots === null
					? null
					: createReadonlyMap(plugin.descriptions.slots),
			}),
		}))),
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
