/** Catalog view-model sourced from Core's immutable public WidgetSystem catalog. */

import type { AnyWidgetPluginTuple, WidgetCatalog, WidgetCatalogEntry, WidgetPluginCapabilities, WidgetSystem } from '@deviltea/widget-core'
import { inspectPlugin } from '@deviltea/widget-core/inspection'

/** One declared Event: its name and the description its plugin gave it (Core publishes nothing else about an Event). */
export interface AuthorCatalogEvent {
	readonly name: string
	readonly description: string
}

export interface AuthorCatalogWidget {
	readonly entry: WidgetCatalogEntry
	readonly capabilities: WidgetPluginCapabilities
	/**
	 * The plugin's declared Events in declaration order; empty when it declares none (`capabilities.events` tells an
	 * absent capability from an explicitly empty one). `system.catalog` does not carry Events, so they are read through
	 * `inspectPlugin`.
	 */
	readonly events: readonly AuthorCatalogEvent[]
	/** Pretty JSON of `entry.config?.schema`; null when the plugin has no config or publishes no schema. */
	readonly configSchemaText: string | null
}

export interface AuthorCatalogViewModel {
	/** Identity-preserving reference to the public catalog; never the curated Implementation registry. */
	readonly catalog: WidgetCatalog
	readonly widgets: readonly AuthorCatalogWidget[]
}

type CatalogPlugin = WidgetSystem<AnyWidgetPluginTuple>['plugins'][number]

function declaredEvents(plugin: CatalogPlugin | undefined): readonly AuthorCatalogEvent[] {
	const events = plugin === undefined ? null : inspectPlugin(plugin).events
	return events === null ? [] : [...events.values()].map(event => ({ name: event.name, description: event.description }))
}

export function createAuthorCatalogViewModel(system: WidgetSystem<AnyWidgetPluginTuple>): AuthorCatalogViewModel {
	const pluginsByType = new Map(system.plugins.map(plugin => [plugin.type, plugin] as const))
	return {
		catalog: system.catalog,
		widgets: system.catalog.widgets.map(entry => ({
			entry,
			capabilities: pluginsByType.get(entry.type)?.capabilities ?? { config: false, slots: false, state: false, properties: false, methods: false, events: false },
			events: declaredEvents(pluginsByType.get(entry.type)),
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
		/** Declared Event names with their descriptions; `null` when the plugin declares no Events capability. */
		readonly events: Readonly<Record<string, string>> | null
	}[]
}

/**
 * Plain JSON projection of the public catalog ("AI context"): Core's slot Map becomes an object. Events are not part
 * of `system.catalog`, so they are added from the view-model's `inspectPlugin` reading (`null` without the capability).
 */
export function catalogToJson(catalog: WidgetCatalog, widgets: readonly AuthorCatalogWidget[] = []): AuthorCatalogJson {
	const eventsByType = new Map(widgets.map(widget => [widget.entry.type, widget] as const))
	return {
		widgets: catalog.widgets.map((entry) => {
			const declared = eventsByType.get(entry.type)
			return {
				type: entry.type,
				description: entry.description,
				config: entry.config === null ? null : { description: entry.config.description, schema: entry.config.schema },
				slots: entry.descriptions.slots === null ? null : Object.fromEntries(entry.descriptions.slots),
				events: declared === undefined || !declared.capabilities.events ? null : Object.fromEntries(declared.events.map(event => [event.name, event.description])),
			}
		}),
	}
}
