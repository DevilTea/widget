/**
 * Plugin-side readonly inspection projection.
 *
 * This surface projects only passive declaration facts required before any authored View/Blueprint exists:
 * everything the catalog entry carries plus capability presence and member facts. It never exposes
 * executable member definitions/callbacks and never executes Plugin semantics.
 */

import type { AnyWidgetPlugin } from '../plugin'
import type {
	PluginInspection,
	PluginInspectionEventMember,
	PluginInspectionPropertyMember,
	PluginInspectionSlot,
	PluginInspectionStateMember,
} from './types'
import { isCoreWidgetPlugin, readWidgetPluginDefinition } from '../plugin'
import { createReadonlyMap } from '../readonly-map'
import { WidgetInspectionError } from './errors'

const inspectionCache = new WeakMap<AnyWidgetPlugin, PluginInspection>()

function buildSlots(plugin: AnyWidgetPlugin): PluginInspection['slots'] {
	const definitions = readWidgetPluginDefinition(plugin).slots
	if (definitions === null)
		return null

	const slots: Array<readonly [string, PluginInspectionSlot]> = []
	for (const [name, definition] of definitions) {
		slots.push([name, Object.freeze({
			type: 'slot' as const,
			name,
			description: definition.description,
		})])
	}
	return createReadonlyMap(slots)
}

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

function buildEventMembers(plugin: AnyWidgetPlugin): PluginInspection['events'] {
	const definitions = readWidgetPluginDefinition(plugin).events
	if (definitions === null)
		return null

	const members: Array<readonly [string, PluginInspectionEventMember]> = []
	for (const [name, definition] of definitions) {
		members.push([name, Object.freeze({
			type: 'event' as const,
			name,
			description: definition.description,
		})])
	}
	return createReadonlyMap(members)
}

/**
 * Returns an identity-stable, readonly/passive projection for the exact completed Plugin object.
 */
export function inspectPlugin(plugin: AnyWidgetPlugin): PluginInspection {
	if (!isCoreWidgetPlugin(plugin))
		throw new WidgetInspectionError('foreign-plugin')

	const existing = inspectionCache.get(plugin)
	if (existing !== undefined)
		return existing

	const inspection: PluginInspection = Object.freeze({
		type: plugin.type,
		description: plugin.description,
		capabilities: plugin.capabilities,
		config: plugin.config,
		slots: buildSlots(plugin),
		state: buildStateMembers(plugin),
		properties: buildPropertyMembers(plugin),
		events: buildEventMembers(plugin),
	})
	inspectionCache.set(plugin, inspection)
	return inspection
}
