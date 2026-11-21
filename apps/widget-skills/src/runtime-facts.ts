/**
 * Reads the runtime side of a System (`system.catalog` and `inspectPlugin`) into plain data, so the extractor
 * can cross-check the names it read from the types.
 *
 * `loadRuntimeFacts` imports the System's module and Core's inspection entry from the same module graph: Core
 * identifies its plugins by module-private brands, so both must come from one Core instance.
 */

import type { RuntimeFacts } from './ir'
import { pathToFileURL } from 'node:url'

interface InspectionLike {
	readonly capabilities: Readonly<Record<string, unknown>>
	readonly config: unknown
	readonly slots: ReadonlyMap<PropertyKey, { readonly description: string }> | null
	readonly state: ReadonlyMap<PropertyKey, { readonly authorWritable: boolean }> | null
	readonly properties: ReadonlyMap<PropertyKey, unknown> | null
	readonly events: ReadonlyMap<PropertyKey, { readonly description: string }> | null
}

interface SystemLike {
	readonly plugins: readonly { readonly type: string, readonly description: string, readonly descriptions: { readonly config: string | null } }[]
	readonly catalog: { readonly widgets: readonly { readonly type: string }[] }
}

export function collectRuntimeFacts(system: unknown, inspectPlugin: (plugin: never) => unknown): RuntimeFacts {
	const { plugins, catalog } = system as SystemLike
	const catalogTypes = catalog.widgets.map(widget => widget.type)
	const pluginTypes = plugins.map(plugin => plugin.type)
	if (catalogTypes.join('\n') !== pluginTypes.join('\n'))
		throw new Error(`system.catalog lists [${catalogTypes.join(', ')}] but system.plugins is [${pluginTypes.join(', ')}].`)
	return {
		plugins: plugins.map((plugin) => {
			const inspection = inspectPlugin(plugin as never) as InspectionLike
			return {
				type: plugin.type,
				description: plugin.description,
				configDescription: plugin.descriptions.config,
				hasConfig: inspection.config !== null,
				hasMethods: inspection.capabilities.methods === true,
				slots: inspection.slots === null ? null : [...inspection.slots].map(([name, slot]) => ({ name: String(name), description: slot.description })),
				state: inspection.state === null ? null : [...inspection.state].map(([name, member]) => ({ name: String(name), authorWritable: member.authorWritable })),
				properties: inspection.properties === null ? null : [...inspection.properties.keys()].map(String),
				events: inspection.events === null ? null : [...inspection.events].map(([name, member]) => ({ name: String(name), description: member.description })),
			}
		}),
	}
}

/** Imports `modulePath` (absolute) and reads the facts of its export `exportName`. Needs a TypeScript loader (tsx). */
export async function loadRuntimeFacts(modulePath: string, exportName: string): Promise<RuntimeFacts> {
	const module = await import(pathToFileURL(modulePath).href) as Record<string, unknown>
	const system = module[exportName]
	if (system === undefined || system === null)
		throw new Error(`${modulePath} has no export "${exportName}".`)
	const inspection = await import('@deviltea/widget-core/inspection') as { inspectPlugin: (plugin: never) => unknown }
	return collectRuntimeFacts(system, inspection.inspectPlugin)
}
