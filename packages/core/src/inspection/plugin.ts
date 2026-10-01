/**
 * Plugin-side readonly inspection projection.
 *
 * This surface projects only passive declaration facts required before any authored View/Blueprint exists.
 * It never exposes executable member definitions/callbacks and never executes Plugin semantics.
 */

import type { AnyWidgetPlugin } from '../plugin'
import type {
	PluginInspection,
	PluginInspectionPropertyMember,
	PluginInspectionStateMember,
} from './types'
import { readWidgetPluginDefinition } from '../plugin'
import { createReadonlyMap } from '../readonly-map'

const inspectionCache = new WeakMap<AnyWidgetPlugin, PluginInspection>()

function buildStateMembers(plugin: AnyWidgetPlugin): PluginInspection['state'] {
	const definitions = readWidgetPluginDefinition(plugin).state
	if (definitions === null)
		return null

	const members: Array<readonly [string, PluginInspectionStateMember]> = []
	for (const [name, definition] of definitions) {
		members.push([name, Object.freeze({
			type: 'state' as const,
			name,
			authorWritable: definition.authorWritable === true,
		})])
	}
	return createReadonlyMap(members)
}

function buildPropertyMembers(plugin: AnyWidgetPlugin): PluginInspection['properties'] {
	const definitions = readWidgetPluginDefinition(plugin).properties
	if (definitions === null)
		return null

	const members: Array<readonly [string, PluginInspectionPropertyMember]> = []
	for (const [name, definition] of definitions) {
		members.push([name, Object.freeze({
			type: 'property' as const,
			name,
			valueContractId: definition.valueContract?.id ?? null,
		})])
	}
	return createReadonlyMap(members)
}

/**
 * Returns an identity-stable, readonly/passive projection for the exact completed Plugin object.
 */
export function inspectPlugin(plugin: AnyWidgetPlugin): PluginInspection {
	const existing = inspectionCache.get(plugin)
	if (existing !== undefined)
		return existing

	const inspection: PluginInspection = Object.freeze({
		state: buildStateMembers(plugin),
		properties: buildPropertyMembers(plugin),
	})
	inspectionCache.set(plugin, inspection)
	return inspection
}
