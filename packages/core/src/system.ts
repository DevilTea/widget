/**
 * Immutable registered plugin universe.
 *
 * Normative source: diagnostic #10 amendment "reconciliation audit" (WidgetSystem registration details)
 * and consolidated handoff §5.
 */

import type { DiagnosticCollector, RelativeSystemStructureDiagnosticInput } from './diagnostic'
import type { BlueprintCompileView, WidgetSystemBlueprint } from './internal/contract'
import type { AnyWidgetPlugin, AnyWidgetPluginTuple, WidgetPluginConfigMetadata, WidgetPluginTypeOf } from './plugin'
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

export type WidgetSystemValidateStructure<Plugins extends AnyWidgetPluginTuple> = (ctx: WidgetSystemValidateStructureContext<Plugins>) => void

export interface CreateWidgetSystemOptions<Plugins extends AnyWidgetPluginTuple> {
	readonly plugins: Plugins
	readonly validateStructure?: WidgetSystemValidateStructure<Plugins>
}

/**
 * Selects one registered plugin by its `type` discriminator.
 */
export type WidgetPluginOf<Plugins extends AnyWidgetPluginTuple, Type extends string> = Extract<Plugins[number], { readonly type: Type }>

export interface WidgetSystem<Plugins extends AnyWidgetPluginTuple = AnyWidgetPluginTuple> {
	/**
	 * The registered plugin tuple. It defines this instance's TypeScript universe; there is no
	 * global/module augmentation.
	 */
	readonly plugins: Plugins
	readonly validateStructure: WidgetSystemValidateStructure<Plugins> | null
	readonly catalog: WidgetCatalog
	getPlugin: <Type extends WidgetPluginTypeOf<Plugins[number]>>(type: Type) => WidgetPluginOf<Plugins, Type>
	/**
	 * The compilation boundary. The input is `unknown` because JSON-parsed/untrusted document data is
	 * the real boundary; malformed input still produces an inspectable Blueprint.
	 */
	createBlueprint: (definition: unknown) => WidgetSystemBlueprint<Plugins>
}

export type WidgetSystemConfigurationErrorCode = 'foreign-plugin' | 'duplicate-plugin-type'

/**
 * Thrown by `createWidgetSystem` for an invalid plugin registration. Discriminate by class and `code`;
 * `message` is not protocol.
 *
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
		readonly pluginIndex: number,
		readonly pluginType: string | null,
		readonly firstPluginIndex: number | null = null,
		message = code === 'foreign-plugin'
			? `The widget plugin at index ${pluginIndex} was not created by this widget core instance.`
			: `Duplicate widget plugin type "${pluginType}" at index ${pluginIndex} (first registered at index ${firstPluginIndex}).`,
	) {
		super(message)
	}
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
 * Creates an instance-scoped, immutable widget system. Duplicate `plugin.type` is rejected.
 */
export function createWidgetSystem<const Plugins extends AnyWidgetPluginTuple>(
	options: CreateWidgetSystemOptions<Plugins>,
): WidgetSystem<Plugins> {
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

		getPlugin(type) {
			return pluginsByType.get(type) as WidgetPluginOf<Plugins, typeof type>
		},

		createBlueprint(definition) {
			return compileBlueprint(system, definition)
		},
	}

	return Object.freeze(system)
}
