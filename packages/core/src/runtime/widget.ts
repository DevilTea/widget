/**
 * RuntimeWidget assembly.
 *
 * Distributed by plugin type; only conditionally exposes `state`/`properties`/`methods` when the
 * corresponding compiled member map is non-empty. Identity/static fields (`id`, `type`, `blueprint`)
 * stay readable after Runtime disposal because they are plain immutable references, not live
 * operations. `getIssues`/`subscribeIssues` are unconditional — every widget aggregates to its own
 * issue surface regardless of declared capabilities, per issue #10 amendment "RuntimeWidget aggregate
 * issue surface" — and are live operations, so they throw `WidgetSystemRuntimeDisposedError` after
 * Runtime disposal like every other live query/subscription.
 *
 * Member names are not restricted (`constructor`/`__proto__` stay legitimate keys), so every surface
 * keyed by an arbitrary member name is built on a null-prototype record rather than plain `{}` —
 * bracket-assigning a `"__proto__"` key into an ordinary object mutates its prototype instead of
 * creating an own member.
 *
 * Normative source: issue #10 consolidated handoff §20, amendment "builder/member-key" (special
 * JavaScript names stay safe via `Map`/null-prototype storage rather than ordinary object semantics),
 * amendment "RuntimeWidget aggregate issue surface".
 */

import type { CompiledResolvedWidgetNode } from '../internal/contract'
import type { RuntimeContext } from './context'
import type { PrimitiveRegistryEntry } from './deps'
import { readWidgetPluginDefinition } from '../plugin'
import { createRuntimeWidgetIssuesAggregate } from './aggregate'

export function buildRuntimeWidget(context: RuntimeContext, node: CompiledResolvedWidgetNode, entry: PrimitiveRegistryEntry): unknown {
	const issuesAggregate = createRuntimeWidgetIssuesAggregate(context, entry)

	const widget: Record<string, unknown> = {
		id: node.id,
		type: node.type,
		blueprint: node.publicNode,
		getIssues: issuesAggregate.getIssues,
		subscribeIssues: issuesAggregate.subscribeIssues,
	}

	const definition = readWidgetPluginDefinition(node.plugin)

	if (definition.state !== null) {
		const stateSurface: Record<string, unknown> = Object.create(null)
		for (const [key, primitive] of entry.state)
			stateSurface[key] = primitive.public
		widget.state = Object.freeze(stateSurface)
	}

	if (definition.properties !== null) {
		const propertiesSurface: Record<string, unknown> = Object.create(null)
		for (const [name, primitive] of entry.properties)
			propertiesSurface[name] = primitive.public
		widget.properties = Object.freeze(propertiesSurface)
	}

	if (definition.methods !== null) {
		const methodsSurface: Record<string, unknown> = Object.create(null)
		for (const [name, primitive] of entry.methods)
			methodsSurface[name] = primitive.public
		widget.methods = Object.freeze(methodsSurface)
	}

	return Object.freeze(widget)
}
