/**
 * Immutable registered plugin universe.
 *
 * Normative source: diagnostic #10 amendment "reconciliation audit" (WidgetSystem registration details)
 * and consolidated handoff §5.
 */

import type { DiagnosticCollector, RelativeSystemStructureDiagnosticInput } from './diagnostic'
import type { BlueprintCompileView, WidgetSystemBlueprint } from './internal/contract'
import type { AnyWidgetPlugin, AnyWidgetPluginTuple, WidgetPluginTypeOf } from './plugin'
import { compileBlueprint } from './blueprint/index'
import { createReadonlyMap } from './readonly-map'

export interface WidgetCatalogEntry {
	readonly type: string
	readonly description: string
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

/**
 * Creates an instance-scoped, immutable widget system. Duplicate `plugin.type` is rejected.
 */
export function createWidgetSystem<const Plugins extends AnyWidgetPluginTuple>(
	options: CreateWidgetSystemOptions<Plugins>,
): WidgetSystem<Plugins> {
	const plugins = Object.freeze([...options.plugins]) as unknown as Plugins
	const pluginsByType = new Map<string, AnyWidgetPlugin>()

	for (const plugin of plugins) {
		if (pluginsByType.has(plugin.type))
			throw new Error(`Duplicate widget plugin type: "${plugin.type}".`)

		pluginsByType.set(plugin.type, plugin)
	}

	const catalog: WidgetCatalog = Object.freeze({
		widgets: Object.freeze(plugins.map(plugin => Object.freeze({
			type: plugin.type,
			description: plugin.description,
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
