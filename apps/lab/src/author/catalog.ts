/**
 * Catalog view-model sourced from Core's immutable public WidgetSystem catalog, with the prose from the showcase's generated
 * documentation (`widget-docs.ts`) and the config JSON Schemas the showcase hands to the Lab (Core 0.3 carries neither).
 */

import type { AnyWidgetPluginTuple, WidgetCatalog, WidgetCatalogEntry, WidgetPluginCapabilities, WidgetSystem } from '@deviltea/widget-core'
import type { ConfigSchemaMap } from '../showcase-host'
import type { WidgetDocs } from './widget-docs'
import { inspectPlugin } from '@deviltea/widget-core/inspection'
import { docText, memberDocText, pluginDocsOf } from './widget-docs'

/** One declared Event: its name and its documentation (`''` when it has none; Core publishes nothing else about an Event). */
export interface AuthorCatalogEvent {
	readonly name: string
	readonly description: string
}

/** One declared slot: its name and its documentation (`''` when it has none). */
export interface AuthorCatalogSlot {
	readonly name: string
	readonly description: string
}

export interface AuthorCatalogWidget {
	readonly entry: WidgetCatalogEntry
	readonly capabilities: WidgetPluginCapabilities
	/** The documentation of the plugin's `Interfaces` type; `''` when it has none. */
	readonly description: string
	/** The documentation of its `config` member; `null` without the config capability, `''` when undocumented. */
	readonly configDescription: string | null
	/** The declared slots in declaration order with their documentation; empty without the slots capability. */
	readonly slots: readonly AuthorCatalogSlot[]
	/**
	 * The plugin's declared Events in declaration order; empty when it declares none (`capabilities.events` tells an
	 * absent capability from an explicitly empty one). `system.catalog` does not carry Events, so they are read through
	 * `inspectPlugin`.
	 */
	readonly events: readonly AuthorCatalogEvent[]
	/** The config JSON Schema the showcase hands to the Lab for this plugin; null without config or without a schema. */
	readonly configSchema: Readonly<Record<string, unknown>> | null
	/** Pretty JSON of `configSchema`; null when there is none. */
	readonly configSchemaText: string | null
}

export interface AuthorCatalogViewModel {
	/** Identity-preserving reference to the public catalog; never the curated Implementation registry. */
	readonly catalog: WidgetCatalog
	readonly widgets: readonly AuthorCatalogWidget[]
}

/** What the Lab knows about a System besides its catalog: the generated documentation and the config schemas. */
export interface AuthorCatalogSources {
	readonly docs?: WidgetDocs
	readonly configSchemas?: ConfigSchemaMap
}

type CatalogPlugin = WidgetSystem<AnyWidgetPluginTuple>['plugins'][number]

function declaredEventNames(plugin: CatalogPlugin | undefined): readonly string[] {
	const events = plugin === undefined ? null : inspectPlugin(plugin).events
	return events === null ? [] : [...events.values()].map(event => event.name)
}

export function createAuthorCatalogViewModel(system: WidgetSystem<AnyWidgetPluginTuple>, { docs, configSchemas = {} }: AuthorCatalogSources = {}): AuthorCatalogViewModel {
	const pluginsByType = new Map(system.plugins.map(plugin => [plugin.type, plugin] as const))
	return {
		catalog: system.catalog,
		widgets: system.catalog.widgets.map((entry) => {
			const documentation = pluginDocsOf(docs, entry.type)
			const configSchema = entry.capabilities.config && Object.hasOwn(configSchemas, entry.type) ? configSchemas[entry.type]! : null
			return {
				entry,
				capabilities: pluginsByType.get(entry.type)?.capabilities ?? { config: false, slots: false, state: false, properties: false, methods: false, events: false },
				description: docText(documentation),
				configDescription: entry.capabilities.config ? docText(documentation?.config) : null,
				slots: (entry.slots ?? []).map(name => ({ name, description: memberDocText(documentation?.slots, name) })),
				events: declaredEventNames(pluginsByType.get(entry.type))
					.map(name => ({ name, description: memberDocText(documentation?.events, name) })),
				configSchema,
				configSchemaText: configSchema === null ? null : JSON.stringify(configSchema, null, 2),
			}
		}),
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
 * Plain JSON projection of the public catalog ("AI context"), with the prose of the generated documentation (`''` where a
 * member has none) and the config JSON Schema the showcase hands to the Lab (`null` when it has none). Events are not part
 * of `system.catalog`, so they are added from the view-model's `inspectPlugin` reading (`null` without the capability).
 * `widgets` is required, and must hold every catalog entry, so that `events: null` can only mean "no capability".
 */
export function catalogToJson(catalog: WidgetCatalog, widgets: readonly AuthorCatalogWidget[]): AuthorCatalogJson {
	const widgetsByType = new Map(widgets.map(widget => [widget.entry.type, widget] as const))
	return {
		widgets: catalog.widgets.map((entry) => {
			const widget = widgetsByType.get(entry.type)
			if (widget === undefined)
				throw new Error(`The catalog entry "${entry.type}" has no view-model widget to read its Events from.`)
			return {
				type: entry.type,
				description: widget.description,
				config: !entry.capabilities.config ? null : { description: widget.configDescription ?? '', schema: widget.configSchema },
				slots: entry.slots === null ? null : Object.fromEntries(widget.slots.map(slot => [slot.name, slot.description])),
				events: !widget.capabilities.events ? null : Object.fromEntries(widget.events.map(event => [event.name, event.description])),
			}
		}),
	}
}
