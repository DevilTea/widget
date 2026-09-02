/**
 * Phase 3 Author commands and source projection.
 *
 * This module deliberately owns the translation from a high-level Structure command to a Core
 * `SourcePatch`. It never compiles a definition itself: `LabSession.author()` submits the returned patch
 * to the authoritative `WidgetDocument` and then runs the same Runtime promotion lifecycle as JSON Apply.
 */

import type { AnyWidgetPluginTuple, JsonPrimitive, SourcePatch, WidgetSystemBlueprint } from '@deviltea/widget-core'
import type { BlueprintInspectionNode, InspectionNodeId } from '@deviltea/widget-core/inspection'
import type { AuthorCommand, ReplaceConfigScalarCommand } from './types'
import { inspectBlueprint } from '@deviltea/widget-core/inspection'

export interface AuthorConfigScalar {
	readonly key: string
	readonly value: Exclude<JsonPrimitive, null>
}

export type AuthorPatchResult
	= | { readonly ok: true, readonly patch: SourcePatch }
		| { readonly ok: false, readonly reason: 'stale-selection' | 'widget-not-found' | 'config-not-found' | 'config-value-not-scalar' | 'invalid-value' }

function isPlainObject(value: unknown): value is Record<string, unknown> {
	if (typeof value !== 'object' || value === null || Array.isArray(value))
		return false
	const prototype = Object.getPrototypeOf(value)
	return prototype === Object.prototype || prototype === null
}

function isJsonPrimitive(value: unknown): value is JsonPrimitive {
	return value === null || typeof value === 'string' || (typeof value === 'number' && Number.isFinite(value)) || typeof value === 'boolean'
}

/** Returns only existing non-null scalar config fields; null and nested values stay editable in JSON. */
export function getAuthorConfigScalars(node: BlueprintInspectionNode): readonly AuthorConfigScalar[] {
	if (!node.resolved || !isPlainObject(node.node.source) || !isPlainObject(node.node.source.config))
		return []

	return Object.entries(node.node.source.config)
		.filter((entry): entry is [string, Exclude<JsonPrimitive, null>] => entry[1] !== null && isJsonPrimitive(entry[1]))
		.map(([key, value]) => ({ key, value }))
}

function findSourcePath(source: unknown, target: unknown): readonly (string | number)[] | null {
	const visited = new Set<object>()

	function visit(value: unknown, path: readonly (string | number)[]): readonly (string | number)[] | null {
		if (value === target)
			return path
		if (typeof value !== 'object' || value === null || visited.has(value))
			return null
		visited.add(value)

		if (Array.isArray(value)) {
			for (let index = 0; index < value.length; index++) {
				const result = visit(value[index], [...path, index])
				if (result !== null)
					return result
			}
			return null
		}

		if (!isPlainObject(value))
			return null
		for (const [key, child] of Object.entries(value)) {
			const result = visit(child, [...path, key])
			if (result !== null)
				return result
		}
		return null
	}

	return visit(source, [])
}

function findNodeById<Plugins extends AnyWidgetPluginTuple>(blueprint: WidgetSystemBlueprint<Plugins>, nodeId: InspectionNodeId): BlueprintInspectionNode<Plugins> | null {
	const inspection = inspectBlueprint(blueprint)
	return inspection.getNode(nodeId)
}

/** Lowers one supported author command without touching Core compilation or the Implementation registry. */
export function createAuthorPatch<Plugins extends AnyWidgetPluginTuple>(
	blueprint: WidgetSystemBlueprint<Plugins>,
	command: AuthorCommand,
	documentRevision: number,
): AuthorPatchResult {
	if (command.type !== 'replace-config-scalar')
		return { ok: false, reason: 'widget-not-found' }
	if (command.documentRevision !== documentRevision)
		return { ok: false, reason: 'stale-selection' }
	if (!isJsonPrimitive(command.value))
		return { ok: false, reason: 'invalid-value' }

	const node = findNodeById(blueprint, command.nodeId)
	if (node === null)
		return { ok: false, reason: 'widget-not-found' }
	if (!isPlainObject(node.node.source) || !isPlainObject(node.node.source.config))
		return { ok: false, reason: 'config-not-found' }

	const config = node.node.source.config
	if (!Object.hasOwn(config, command.configKey))
		return { ok: false, reason: 'config-not-found' }
	if (!isJsonPrimitive(config[command.configKey]))
		return { ok: false, reason: 'config-value-not-scalar' }

	const widgetPath = findSourcePath(blueprint.source, node.node.source)
	if (widgetPath === null)
		return { ok: false, reason: 'widget-not-found' }

	return {
		ok: true,
		patch: [{
			op: 'replace',
			path: [...widgetPath, 'config', command.configKey],
			value: command.value,
		}],
	}
}

export function replaceConfigScalar(documentRevision: number, nodeId: InspectionNodeId, configKey: string, value: JsonPrimitive): ReplaceConfigScalarCommand {
	return { type: 'replace-config-scalar', documentRevision, nodeId, configKey, value }
}
