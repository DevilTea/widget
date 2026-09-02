/** Catalog view-model sourced from Core's immutable public WidgetSystem catalog. */

import type { AnyWidgetPluginTuple, WidgetCatalog, WidgetCatalogEntry, WidgetPluginCapabilities, WidgetSystem } from '@deviltea/widget-core'

export interface AuthorCatalogWidget {
	readonly entry: WidgetCatalogEntry
	readonly capabilities: WidgetPluginCapabilities
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
			capabilities: capabilitiesByType.get(entry.type) ?? { config: false, slots: false, state: false, properties: false, methods: false },
		})),
	}
}
