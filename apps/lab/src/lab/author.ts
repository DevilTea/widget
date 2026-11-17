/**
 * Phase 3 Author commands and source projection.
 *
 * This module deliberately owns the translation from a high-level Structure command to a Core
 * `SourcePatch`. It never compiles a definition itself: `LabSession.author()` submits the returned patch
 * to the authoritative `WidgetDocument` and then runs the same Runtime promotion lifecycle as JSON Apply.
 *
 * Two commands exist: replacing one existing top-level scalar config value (`replace-config-scalar`), and the
 * general config edit of issue #230 PR 3c (`edit-config`: replace, add or remove a value at any path inside a
 * widget's config). Both address the widget by its Document `InspectionNodeId` and the Document revision, and
 * both are lowered to an array-form `SourcePatch` addressed by the node's Core-computed `sourcePath`.
 */

import type { AnyWidgetPluginTuple, JsonPrimitive, SourcePatch, WidgetSystemBlueprint } from '@deviltea/widget-core'
import type { BlueprintInspectionNode, InspectionNodeId } from '@deviltea/widget-core/inspection'
import type { AuthorCommand, AuthorUnsupportedReason, ConfigEdit, EditConfigCommand, ReplaceConfigScalarCommand } from './types'
import { isJsonValue } from '@deviltea/widget-core'
import { inspectBlueprint } from '@deviltea/widget-core/inspection'

export type AuthorPatchResult
	= | { readonly ok: true, readonly patch: SourcePatch }
		| { readonly ok: false, readonly reason: AuthorUnsupportedReason }

function isPlainObject(value: unknown): value is Record<string, unknown> {
	if (typeof value !== 'object' || value === null || Array.isArray(value))
		return false
	const prototype = Object.getPrototypeOf(value)
	return prototype === Object.prototype || prototype === null
}

function isJsonPrimitive(value: unknown): value is JsonPrimitive {
	return value === null || typeof value === 'string' || (typeof value === 'number' && Number.isFinite(value)) || typeof value === 'boolean'
}

function findNodeById<Plugins extends AnyWidgetPluginTuple>(blueprint: WidgetSystemBlueprint<Plugins>, nodeId: InspectionNodeId): BlueprintInspectionNode<Plugins> | null {
	const inspection = inspectBlueprint(blueprint)
	return inspection.getNode(nodeId)
}

/** A SourcePath in JSON Pointer form (RFC 6901); the one form that can address "append to an array" (`/-`). */
function toPointer(segments: readonly (string | number)[]): string {
	return segments.map(segment => `/${String(segment)
		.replaceAll('~', '~0')
		.replaceAll('/', '~1')}`)
		.join('')
}

function lowerScalar<Plugins extends AnyWidgetPluginTuple>(
	blueprint: WidgetSystemBlueprint<Plugins>,
	command: ReplaceConfigScalarCommand,
	documentRevision: number,
): AuthorPatchResult {
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

	return {
		ok: true,
		patch: [{
			op: 'replace',
			path: [...node.sourcePath, 'config', command.configKey],
			value: command.value,
		}],
	}
}

function lowerEdit<Plugins extends AnyWidgetPluginTuple>(
	blueprint: WidgetSystemBlueprint<Plugins>,
	command: EditConfigCommand,
	documentRevision: number,
): AuthorPatchResult {
	if (command.documentRevision !== documentRevision)
		return { ok: false, reason: 'stale-selection' }
	if (command.configPath.length === 0)
		return { ok: false, reason: 'config-path-not-found' }
	if (command.edit.op !== 'remove' && !isJsonValue(command.edit.value))
		return { ok: false, reason: 'invalid-value' }

	const node = findNodeById(blueprint, command.nodeId)
	if (node === null)
		return { ok: false, reason: 'widget-not-found' }
	if (!isPlainObject(node.node.source))
		return { ok: false, reason: 'config-not-found' }

	const edit: ConfigEdit = command.edit
	const configPath = [...node.sourcePath, 'config']
	const config = node.node.source.config

	// A widget authored without a `config` yet: the first added key creates it.
	if (config === undefined) {
		if (edit.op !== 'add' || command.configPath.length !== 1)
			return { ok: false, reason: 'config-not-found' }
		return { ok: true, patch: [{ op: 'add', path: configPath, value: { [command.configPath[0]!]: edit.value } }] }
	}

	let parent: unknown = config
	for (const segment of command.configPath.slice(0, -1)) {
		if (Array.isArray(parent) && typeof segment === 'number')
			parent = parent[segment]
		else if (isPlainObject(parent) && typeof segment === 'string' && Object.hasOwn(parent, segment))
			parent = parent[segment]
		else
			return { ok: false, reason: 'config-path-not-found' }
	}
	const last = command.configPath.at(-1)!
	const path = [...configPath, ...command.configPath]

	if (Array.isArray(parent)) {
		if (typeof last !== 'number' || !Number.isInteger(last) || last < 0)
			return { ok: false, reason: 'config-path-not-found' }
		if (edit.op === 'add') {
			if (last > parent.length)
				return { ok: false, reason: 'config-path-not-found' }
			// Array-form paths cannot say "append"; the pointer form can.
			return { ok: true, patch: [{ op: 'add', path: last === parent.length ? toPointer([...configPath, ...command.configPath.slice(0, -1), '-']) : path, value: edit.value }] }
		}
		if (last >= parent.length)
			return { ok: false, reason: 'config-path-not-found' }
	}
	else if (isPlainObject(parent)) {
		if (typeof last !== 'string')
			return { ok: false, reason: 'config-path-not-found' }
		const exists = Object.hasOwn(parent, last)
		if (edit.op === 'add' && exists)
			return { ok: false, reason: 'config-path-exists' }
		if (edit.op !== 'add' && !exists)
			return { ok: false, reason: 'config-path-not-found' }
	}
	else {
		return { ok: false, reason: 'config-path-not-found' }
	}

	return { ok: true, patch: [edit.op === 'remove' ? { op: 'remove', path } : { op: edit.op, path, value: edit.value }] }
}

/** Lowers one supported author command without touching Core compilation or the Implementation registry. */
export function createAuthorPatch<Plugins extends AnyWidgetPluginTuple>(
	blueprint: WidgetSystemBlueprint<Plugins>,
	command: AuthorCommand,
	documentRevision: number,
): AuthorPatchResult {
	switch (command.type) {
		case 'replace-config-scalar': return lowerScalar(blueprint, command, documentRevision)
		case 'edit-config': return lowerEdit(blueprint, command, documentRevision)
		default: return { ok: false, reason: 'widget-not-found' }
	}
}

export function replaceConfigScalar(documentRevision: number, nodeId: InspectionNodeId, configKey: string, value: JsonPrimitive): ReplaceConfigScalarCommand {
	return { type: 'replace-config-scalar', documentRevision, nodeId, configKey, value }
}

export function editConfig(documentRevision: number, nodeId: InspectionNodeId, configPath: readonly (string | number)[], edit: ConfigEdit): EditConfigCommand {
	return { type: 'edit-config', documentRevision, nodeId, configPath, edit }
}
