/**
 * Narrow renderer-integration authority bridge.
 *
 * This subpath is intentionally not re-exported from the package root. Core owns semantic event
 * delivery/emission; renderer adapters use this bridge to obtain only the current widget's emitter.
 */

import type { RuntimeWidget, WidgetSystemRuntime } from '../internal/contract'
import type { AnyWidgetPluginTuple } from '../plugin'
import type { WidgetMemberKey } from '../types'
import { readWidgetPluginDefinition } from '../plugin'
import { buildEventEmitter } from '../runtime/event'
import { isCoreRuntime, readRuntimeInternals } from '../runtime/internals'

export type WidgetIntegrationErrorCode = 'runtime-widget-mismatch' | 'foreign-runtime'

export class WidgetIntegrationError extends Error {
	override readonly name = 'WidgetIntegrationError'

	constructor(
		readonly code: WidgetIntegrationErrorCode,
		message = code === 'foreign-runtime'
			? 'The supplied WidgetSystemRuntime was not produced by this widget core instance.'
			: 'The RuntimeWidget does not belong to the supplied WidgetSystemRuntime instance.',
	) {
		super(message)
	}
}

export type WidgetIntegrationEventEmitter = Readonly<Record<WidgetMemberKey, (...args: readonly unknown[]) => void>>

export function getWidgetEventEmitter<Plugins extends AnyWidgetPluginTuple>(
	runtime: WidgetSystemRuntime<Plugins>,
	widget: RuntimeWidget<Plugins>,
): WidgetIntegrationEventEmitter | null {
	// Provenance first, then exact Runtime/Widget pairing through Core-owned state (never the
	// caller-supplied objects' public shape).
	if (!isCoreRuntime(runtime))
		throw new WidgetIntegrationError('foreign-runtime')

	const internals = readRuntimeInternals(runtime)
	internals.context.assertActive()

	const nodeId = typeof widget === 'object' && widget !== null
		? internals.nodeIdByRuntimeWidget.get(widget)
		: undefined
	if (nodeId === undefined)
		throw new WidgetIntegrationError('runtime-widget-mismatch')

	// Post-validation invariants: pairing guarantees the node exists and is resolved.
	const node = internals.compiled.nodes[nodeId]
	if (node === undefined || !node.resolved)
		throw new Error('The RuntimeWidget is not backed by a resolved Runtime node.')

	const definition = readWidgetPluginDefinition(node.plugin)
	if (definition.events === null)
		return null

	const entry = internals.registry.get(nodeId)
	if (entry === undefined)
		throw new Error('The RuntimeWidget event implementation was not found in the supplied Runtime.')

	return buildEventEmitter(entry.events)
}
