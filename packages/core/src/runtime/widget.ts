/**
 * RuntimeWidget assembly.
 *
 * Distributed by plugin type; only conditionally exposes `state`/`properties`/`methods` when the
 * corresponding compiled member map is non-empty. Identity/static fields (`id`, `type`, `blueprint`)
 * stay readable after Runtime disposal because they are plain immutable references, not live
 * operations.
 *
 * Normative source: issue #10 consolidated handoff §20.
 */

import type { CompiledResolvedWidgetNode } from '../internal/contract'
import type { PrimitiveRegistryEntry } from './deps'
import { readWidgetPluginDefinition } from '../plugin'

export function buildRuntimeWidget(node: CompiledResolvedWidgetNode, entry: PrimitiveRegistryEntry): unknown {
	const widget: Record<string, unknown> = {
		id: node.id,
		type: node.type,
		blueprint: node.publicNode,
	}

	const definition = readWidgetPluginDefinition(node.plugin)

	if (definition.state !== null) {
		const stateSurface: Record<string, unknown> = {}
		for (const [key, primitive] of entry.state)
			stateSurface[key] = primitive.public
		widget.state = Object.freeze(stateSurface)
	}

	if (definition.properties !== null) {
		const propertiesSurface: Record<string, unknown> = {}
		for (const [name, primitive] of entry.properties)
			propertiesSurface[name] = primitive.public
		widget.properties = Object.freeze(propertiesSurface)
	}

	if (definition.methods !== null) {
		const methodsSurface: Record<string, unknown> = {}
		for (const [name, primitive] of entry.methods)
			methodsSurface[name] = primitive.public
		widget.methods = Object.freeze(methodsSurface)
	}

	return Object.freeze(widget)
}
