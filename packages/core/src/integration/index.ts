/**
 * Narrow renderer-integration authority bridge.
 *
 * This subpath is intentionally not re-exported from the package root. Core owns semantic event
 * delivery/emission; renderer adapters use this bridge to obtain only the current widget's emitter.
 */

import type { BlueprintWidgetNode, RuntimeWidget, WidgetSystemRuntime } from '../internal/contract'
import type { AnyWidgetPluginTuple } from '../plugin'
import type { WidgetId, WidgetMemberKey } from '../types'
import { readCompiledBlueprint } from '../internal/contract'
import { readWidgetPluginDefinition } from '../plugin'
import { buildEventEmitter } from '../runtime/event'
import { readRuntimeInternals } from '../runtime/internals'

export type WidgetIntegrationEventEmitter = Readonly<Record<WidgetMemberKey, (...args: readonly unknown[]) => void>>

export function getWidgetEventEmitter<Plugins extends AnyWidgetPluginTuple>(
	runtime: WidgetSystemRuntime<Plugins>,
	widget: RuntimeWidget<Plugins>,
): WidgetIntegrationEventEmitter | null {
	const erasedWidget = widget as unknown as { readonly id: WidgetId, readonly blueprint: BlueprintWidgetNode<Plugins> }
	const current = runtime.getWidget(erasedWidget.id)
	if (current !== widget)
		throw new Error('The RuntimeWidget does not belong to the supplied WidgetSystemRuntime instance.')

	const compiled = readCompiledBlueprint(runtime.blueprint)
	const nodeId = compiled.nodeIdByPublicNode.get(erasedWidget.blueprint)
	if (nodeId === undefined)
		throw new Error('The RuntimeWidget is not backed by the supplied Runtime Blueprint.')

	const node = compiled.nodes[nodeId]
	if (node === undefined || !node.resolved)
		throw new Error('The RuntimeWidget is not backed by a resolved Runtime node.')

	const definition = readWidgetPluginDefinition(node.plugin)
	if (definition.events === null)
		return null

	const entry = readRuntimeInternals(runtime).registry.get(nodeId)
	if (entry === undefined)
		throw new Error('The RuntimeWidget event implementation was not found in the supplied Runtime.')

	return buildEventEmitter(entry.events)
}
