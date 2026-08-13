/**
 * Materializes a `CompiledDependencyTree` into the callable shape `ToExecutedDep(s)` promises.
 *
 * Materialization happens once per Property/Method member at Runtime construction and produces
 * stable, reusable callables: each callable closes over the shared primitive registry (populated
 * progressively while the Runtime is built) and looks the target primitive up lazily at invocation
 * time, so materialization may run before every primitive exists.
 *
 * Normative source: issue #10 consolidated handoff §12 (target-failure 1:1 wrapping,
 * `property-dependency`/`method-dependency`), U1 handoff §5 (resolved/absent x
 * state-get/property-get/method-invoke/state-set materialization table).
 */

import type { DependencyConsumer, DependencyRefinement } from '../dep'
import type { ExecutionResult } from '../execution-result'
import type { CompiledDependency, CompiledDependencyTree, CompiledWidgetNode } from '../internal/contract'
import type { BlueprintDependencyReference, RuntimeIssueLocation, RuntimeMethodDependencyIssue, RuntimeMethodIssue, RuntimePropertyDependencyIssue, RuntimePropertyIssue } from '../issue'
import type { WidgetId, WidgetMemberKey } from '../types'
import type { RuntimeContext } from './context'
import type { MethodPrimitive } from './method'
import type { PropertyPrimitive } from './property'
import type { StatePrimitive } from './state'
import { isCompiledDependency } from '../internal/contract'
import { buildMethodDependencyIssue, buildPropertyDependencyIssue } from './issues'

export interface PrimitiveRegistryEntry {
	readonly state: ReadonlyMap<WidgetMemberKey, StatePrimitive>
	readonly properties: ReadonlyMap<WidgetMemberKey, PropertyPrimitive>
	readonly methods: ReadonlyMap<WidgetMemberKey, MethodPrimitive>
}

export interface DepsMaterializeParams {
	readonly consumer: DependencyConsumer
	readonly ownerWidgetId: WidgetId
	readonly ownerName: WidgetMemberKey
	readonly registry: ReadonlyMap<number, PrimitiveRegistryEntry>
	readonly nodes: readonly CompiledWidgetNode[]
	readonly context: RuntimeContext
}

function consumerDependencyIssue(
	params: DepsMaterializeParams,
	dependency: BlueprintDependencyReference,
	message: string,
	received: unknown,
	related: RuntimeIssueLocation,
): RuntimePropertyDependencyIssue | RuntimeMethodDependencyIssue {
	const base = {
		widgetId: params.ownerWidgetId,
		name: params.ownerName,
		dependency,
		...(received === undefined ? {} : { received }),
		related,
		message,
	}
	return params.consumer === 'property' ? buildPropertyDependencyIssue(base) : buildMethodDependencyIssue(base)
}

function reportDependencyIssue(params: DepsMaterializeParams, issue: RuntimePropertyDependencyIssue | RuntimeMethodDependencyIssue): void {
	params.context.getActiveCollector()
		?.addFinalizedIssue(issue)
}

/**
 * Applies `.validate()` refinements, in order, to a successfully-produced value. Returns the refined
 * success value or a rejection carrying the offending `received` value.
 */
function applyRefinements(
	value: unknown,
	refinements: readonly DependencyRefinement[],
): { readonly ok: true, readonly value: unknown } | { readonly ok: false, readonly received: unknown } {
	for (const refine of refinements) {
		if (!refine(value))
			return { ok: false, received: value }
	}
	return { ok: true, value }
}

function locationOf(operation: BlueprintDependencyReference['operation'], widgetId: WidgetId): RuntimeIssueLocation {
	switch (operation.type) {
		case 'state-get':
		case 'state-set':
			return { type: 'state', widgetId, key: operation.key }
		case 'property-get':
			return { type: 'property', widgetId, name: operation.name }
		case 'method-invoke':
			return { type: 'method', widgetId, name: operation.name }
	}
}

function resolveTargetWidgetId(nodes: readonly CompiledWidgetNode[], nodeId: number): WidgetId {
	const node = nodes[nodeId]
	if (node === undefined || !node.resolved)
		throw new Error(`widget-core: internal error — dependency target node ${nodeId} is not a resolved node.`)
	return node.id
}

function materializeAbsentLeaf(operation: BlueprintDependencyReference['operation']): unknown {
	switch (operation.type) {
		case 'state-set':
			return (candidate: unknown) => ({ success: true, value: candidate }) satisfies ExecutionResult<unknown, never>
		case 'method-invoke':
			return (..._args: readonly unknown[]) => ({ success: true, value: null }) satisfies ExecutionResult<unknown, never>
		case 'state-get':
		case 'property-get':
			return () => ({ success: true, value: null }) satisfies ExecutionResult<unknown, never>
	}
}

function materializeResolvedLeaf(leaf: CompiledDependency & { status: 'resolved' }, params: DepsMaterializeParams): unknown {
	const { reference } = leaf
	const { operation } = reference
	const targetWidgetId = resolveTargetWidgetId(params.nodes, leaf.targetNodeId)
	const related = locationOf(operation, targetWidgetId)
	const entry = params.registry.get(leaf.targetNodeId)

	if (entry === undefined)
		throw new Error(`widget-core: internal error — dependency target node ${leaf.targetNodeId} has no primitive registry entry.`)

	switch (operation.type) {
		case 'state-get': {
			const target = entry.state.get(operation.key)
			if (target === undefined)
				throw new Error(`widget-core: internal error — resolved state-get target "${operation.key}" is missing.`)

			return () => {
				const raw = target.internal.get()
				const refined = applyRefinements(raw, leaf.refinements)
				if (!refined.ok) {
					const issue = consumerDependencyIssue(params, reference, 'The dependency value failed validation.', refined.received, related)
					reportDependencyIssue(params, issue)
					return { success: false, issues: [issue] } satisfies ExecutionResult<never, unknown>
				}
				return { success: true, value: refined.value }
			}
		}

		case 'state-set': {
			const target = entry.state.get(operation.key)
			if (target === undefined)
				throw new Error(`widget-core: internal error — resolved state-set target "${operation.key}" is missing.`)

			return (candidate: unknown) => {
				const result = target.internal.attemptSet(candidate)
				if (result.success)
					return { success: true, value: candidate }

				const wrapped = result.issues.map((targetIssue) => {
					const issue = consumerDependencyIssue(params, reference, targetIssue.message, undefined, related)
					reportDependencyIssue(params, issue)
					return issue
				})
				return { success: false, issues: wrapped as unknown as readonly [unknown, ...unknown[]] }
			}
		}

		case 'property-get': {
			const target = entry.properties.get(operation.name)
			if (target === undefined)
				throw new Error(`widget-core: internal error — resolved property-get target "${operation.name}" is missing.`)

			return () => {
				const targetResult = target.internal.getResult()
				if (!targetResult.success) {
					const wrapped = wrapTargetFailure(params, reference, targetResult.issues, related)
					return { success: false, issues: wrapped }
				}

				const refined = applyRefinements(targetResult.value, leaf.refinements)
				if (!refined.ok) {
					const issue = consumerDependencyIssue(params, reference, 'The dependency value failed validation.', refined.received, related)
					reportDependencyIssue(params, issue)
					return { success: false, issues: [issue] } satisfies ExecutionResult<never, unknown>
				}
				return { success: true, value: refined.value }
			}
		}

		case 'method-invoke': {
			const target = entry.methods.get(operation.name)
			if (target === undefined)
				throw new Error(`widget-core: internal error — resolved method-invoke target "${operation.name}" is missing.`)

			return (...args: readonly unknown[]) => {
				const targetResult = target.public(...args)
				if (!targetResult.success) {
					const wrapped = wrapTargetFailure(params, reference, targetResult.issues, related)
					return { success: false, issues: wrapped }
				}

				const refined = applyRefinements(targetResult.value, leaf.refinements)
				if (!refined.ok) {
					const issue = consumerDependencyIssue(params, reference, 'The dependency value failed validation.', refined.received, related)
					reportDependencyIssue(params, issue)
					return { success: false, issues: [issue] } satisfies ExecutionResult<never, unknown>
				}
				return { success: true, value: refined.value }
			}
		}
	}
}

function wrapTargetFailure(
	params: DepsMaterializeParams,
	reference: BlueprintDependencyReference,
	targetIssues: readonly (RuntimePropertyIssue | RuntimeMethodIssue)[],
	related: RuntimeIssueLocation,
): readonly [unknown, ...unknown[]] {
	const wrapped = targetIssues.map((targetIssue) => {
		const issue = consumerDependencyIssue(params, reference, targetIssue.message, undefined, related)
		reportDependencyIssue(params, issue)
		return issue
	})
	return wrapped as unknown as readonly [unknown, ...unknown[]]
}

function materializeLeaf(leaf: CompiledDependency, params: DepsMaterializeParams): unknown {
	if (leaf.status === 'absent')
		return materializeAbsentLeaf(leaf.reference.operation)

	return materializeResolvedLeaf(leaf, params)
}

export function materializeDependencyTree(tree: CompiledDependencyTree, params: DepsMaterializeParams): unknown {
	if (isCompiledDependency(tree))
		return materializeLeaf(tree, params)

	if (Array.isArray(tree))
		return tree.map(item => materializeDependencyTree(item as CompiledDependencyTree, params))

	const result: Record<string, unknown> = {}
	for (const key of Object.keys(tree))
		result[key] = materializeDependencyTree((tree as Record<string, CompiledDependencyTree>)[key]!, params)

	return result
}
