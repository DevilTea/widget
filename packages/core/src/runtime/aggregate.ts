/**
 * Runtime-owned aggregate Issue query/subscription.
 *
 * Deterministic order: runtime-level issues first, then `CompiledBlueprint.semanticOrder`, then
 * state/properties/methods per widget, then member `Map` insertion (declaration) order, then each
 * primitive's own local issue order. Reading the aggregate never activates Property evaluation because
 * it only ever reads issue signals.
 *
 * Normative source: issue #10 consolidated handoff §5/§16/§20.
 */

import type { CompiledBlueprint, InternalNodeId } from '../internal/contract'
import type { RuntimeLevelIssue, WidgetSystemRuntimeIssue } from '../issue'
import type { RuntimeContext } from './context'
import type { PrimitiveRegistryEntry } from './deps'
import { createTrackedSubscription } from './adapter'

export function buildAggregateSnapshot(
	compiled: CompiledBlueprint,
	registry: ReadonlyMap<InternalNodeId, PrimitiveRegistryEntry>,
	runtimeLevelIssues: readonly RuntimeLevelIssue[],
): readonly WidgetSystemRuntimeIssue[] {
	const result: WidgetSystemRuntimeIssue[] = [...runtimeLevelIssues]

	for (const nodeId of compiled.semanticOrder) {
		const entry = registry.get(nodeId)
		if (entry === undefined)
			continue

		for (const primitive of entry.state.values())
			result.push(...primitive.internal.getIssues())

		for (const primitive of entry.properties.values())
			result.push(...primitive.internal.getIssues())

		for (const primitive of entry.methods.values())
			result.push(...primitive.getIssues())
	}

	return result
}

export interface RuntimeAggregate {
	getIssues: () => readonly RuntimeLevelIssue[]
	getCollectedIssues: () => readonly WidgetSystemRuntimeIssue[]
	subscribeCollectedIssues: (listener: (issues: readonly WidgetSystemRuntimeIssue[]) => void) => () => void
}

export function createRuntimeAggregate(
	context: RuntimeContext,
	compiled: CompiledBlueprint,
	registry: ReadonlyMap<InternalNodeId, PrimitiveRegistryEntry>,
	runtimeLevelIssues: readonly RuntimeLevelIssue[],
): RuntimeAggregate {
	const snapshot = () => buildAggregateSnapshot(compiled, registry, runtimeLevelIssues)

	return {
		getIssues() {
			context.assertActive()
			return runtimeLevelIssues
		},
		getCollectedIssues() {
			context.assertActive()
			return snapshot()
		},
		subscribeCollectedIssues(listener) {
			context.assertActive()
			return createTrackedSubscription(context, snapshot, listener)
		},
	}
}
