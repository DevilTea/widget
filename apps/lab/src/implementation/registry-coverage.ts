/**
 * Registry-shape sanity for curated `sources.ts` modules (issue #25 P3 Scope F "registry shape
 * sanity: every referenced plugin type exists in the corresponding system — import the systems and
 * assert coverage/no-dangling entries").
 *
 * Framework-agnostic, pure — no Vue import, matching `src/implementation/types.ts`'s split.
 */

import type { AnyWidgetPluginTuple, WidgetSystem } from '@deviltea/widget-core'
import type { SourcesRegistry } from './types'

/**
 * Every registry key that is NOT a real plugin type registered on `system`. A typo'd/renamed/removed
 * plugin type would otherwise silently curate an entry the Implementation panel can never reach (no
 * Blueprint node ever resolves to a type the system does not register). An empty array is the passing
 * case.
 */
export function findDanglingRegistryTypes(
	registry: SourcesRegistry,
	system: WidgetSystem<AnyWidgetPluginTuple>,
): readonly string[] {
	const knownTypes = new Set(system.plugins.map(plugin => plugin.type))
	return Object.keys(registry)
		.filter(type => !knownTypes.has(type))
}

/**
 * Every plugin type registered on `system` that the registry does NOT curate. Not necessarily an
 * error on its own (a showcase may deliberately leave a trivial/uninteresting type uncurated), but
 * callers that want full-coverage assurance for a given showcase can assert this is empty.
 */
export function findUncuratedPluginTypes(
	registry: SourcesRegistry,
	system: WidgetSystem<AnyWidgetPluginTuple>,
): readonly string[] {
	return system.plugins
		.map(plugin => plugin.type)
		.filter(type => !(type in registry))
}
