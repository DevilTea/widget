/** Catalog view-model sourced from Core's immutable public WidgetSystem catalog. */

import type { AnyWidgetPluginTuple, WidgetCatalog, WidgetCatalogEntry, WidgetPluginCapabilities, WidgetSystem } from '@deviltea/widget-core'

export interface AuthorCatalogWidget {
	readonly entry: WidgetCatalogEntry
	readonly capabilities: WidgetPluginCapabilities
	/** Pretty JSON of `entry.config?.schema`; null when the plugin has no config or publishes no schema. */
	readonly configSchemaText: string | null
}

export interface AuthorCatalogViewModel {
	/** Identity-preserving reference to the public catalog; never the curated Implementation registry. */
	readonly catalog: WidgetCatalog
	readonly widgets: readonly AuthorCatalogWidget[]
}

export function createAuthorCatalogViewModel(system: WidgetSystem<AnyWidgetPluginTuple>): AuthorCatalogViewModel {
	const capabilitiesByType = new Map(system.plugins.map(plugin => [plugin.type, plugin.capabilities] as const))
	return {
		catalog: system.catalog,
		widgets: system.catalog.widgets.map(entry => ({
			entry,
			capabilities: capabilitiesByType.get(entry.type) ?? { config: false, slots: false, state: false, properties: false, methods: false, events: false },
			configSchemaText: entry.config?.schema == null ? null : JSON.stringify(entry.config.schema, null, 2),
		})),
	}
}

export interface AuthorCatalogJson {
	readonly widgets: readonly {
		readonly type: string
		readonly description: string
		readonly config: { readonly description: string, readonly schema: unknown } | null
		readonly slots: Readonly<Record<string, string>> | null
	}[]
}

/** Plain JSON projection of the public catalog ("AI context"): Core's slot Map becomes an object. */
export function catalogToJson(catalog: WidgetCatalog): AuthorCatalogJson {
	return {
		widgets: catalog.widgets.map(entry => ({
			type: entry.type,
			description: entry.description,
			config: entry.config === null ? null : { description: entry.config.description, schema: entry.config.schema },
			slots: entry.descriptions.slots === null ? null : Object.fromEntries(entry.descriptions.slots),
		})),
	}
}
