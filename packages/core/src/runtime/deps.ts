/**
 * Materializes a `CompiledDependencyTree` into the callable shape `ToExecutedDep(s)` promises.
 *
 * Materialization happens once per Property/Method member at Runtime construction and produces
 * stable, reusable callables: each callable closes over the shared primitive registry (populated
 * progressively while the Runtime is built) and looks the target primitive up lazily at invocation
 * time — inside the callable body, never while building the callable — so materialization may run
 * before every primitive exists. Runtime correctness must not depend on member/widget declaration
 * order: a forward `Property -> later Property`, any `Property -> read-only Method`, a dependency on a
 * later widget, and a valid Method-only cycle (`A <-> B`) must all materialize and invoke correctly.
 *
 * Normative source: diagnostic #10 consolidated handoff §12 (target-failure 1:1 wrapping,
 * `property-dependency`/`method-dependency`), U1 handoff §5 (resolved/absent x
 * state-get/property-get/method-invoke/state-set materialization table).
 */

import type { DependencyConsumer, DependencyRefinement } from '../dep'
import type { BlueprintDependencyReference, RuntimeDiagnostic, RuntimeDiagnosticLocation, RuntimeMethodDependencyDiagnostic, RuntimePropertyDependencyDiagnostic } from '../diagnostic'
import type { ExecutionResult } from '../execution-result'
import type { CompiledDependency, CompiledDependencyTree, CompiledWidgetNode } from '../internal/contract'
import type { WidgetId, WidgetMemberKey } from '../types'
import type { DedupeDescriptor } from './collector'
import type { RuntimeContext } from './context'
import type { ReceivedBox } from './diagnostics'
import type { MethodPrimitive } from './method'
import type { PropertyPrimitive } from './property'
import type { StatePrimitive } from './state'
import { isCompiledDependency } from '../internal/contract'
import { buildMethodDependencyDiagnostic, buildPropertyDependencyDiagnostic, deepFreezeDiagnostic, freezeDiagnosticSnapshot } from './diagnostics'
import { assertSyncValue } from './sync'

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

function consumerDependencyDiagnostic(
	params: DepsMaterializeParams,
	dependency: BlueprintDependencyReference,
	message: string,
	received: ReceivedBox | undefined,
	related: RuntimeDiagnosticLocation,
	cause?: RuntimeDiagnostic,
): RuntimePropertyDependencyDiagnostic | RuntimeMethodDependencyDiagnostic {
	const base = {
		widgetId: params.ownerWidgetId,
		name: params.ownerName,
		dependency,
		...(received === undefined ? {} : { received }),
		...(cause === undefined ? {} : { cause }),
		related,
		message,
	}
	return params.consumer === 'property' ? buildPropertyDependencyDiagnostic(base) : buildMethodDependencyDiagnostic(base)
}

function reportDependencyDiagnostic(
	params: DepsMaterializeParams,
	diagnostic: RuntimePropertyDependencyDiagnostic | RuntimeMethodDependencyDiagnostic,
	dedupe: DedupeDescriptor,
): void {
	params.context.getActiveCollector()
		?.addFinalizedDiagnostic(diagnostic, dedupe)
}

/**
 * Per-dependency-leaf unique id, assigned once when a leaf's callable is materialized and closed over
 * for the callable's lifetime. Combined with a raw failure-identity anchor to dedupe repeated insertion
 * of the same dependency failure into one execution scope's collector (diagnostic #10 §12: "repeated reads
 * of the same failing dependency ... avoid duplicating the same dependency diagnostic insertion").
 */
let nextLeafId = 0

/**
 * Builds the dedupe descriptor for one dependency-leaf failure.
 *
 * `scope` identifies the dependency *leaf* only (`leafId`) — never the failure's `message`. Message is
 * human-readable-only per diagnostic #10 ("`message` is human-readable only, never a machine protocol") and
 * must not participate in identity/machine logic; stuffing it into `scope` would make two occurrences
 * of literally the same failure fail to dedupe if the message text ever varied, and — more subtly —
 * would never actually help distinguish genuinely different failures either, since that job already
 * belongs entirely to `anchor`.
 *
 * `anchor` is passed through to the collector as the *raw* value (never stringified): the collector
 * compares it via `Set` SameValueZero membership, which is collision-free for every JS value —
 * including two distinct `Symbol`s that share a description, which a `typeof`+`String()` encoding would
 * incorrectly conflate.
 */
export function dependencyDedupeDescriptor(leafId: number, failureAnchor: unknown): DedupeDescriptor {
	return { scope: `${leafId}`, anchor: failureAnchor }
}

/**
 * Applies `.validate()` refinements, in order, to a successfully-produced value. Returns the refined
 * ok value or a rejection carrying the offending `received` value.
 *
 * `.validate()` is a semantic callback like every other framework-owned predicate, so its return value
 * is captured as `unknown` and passed through the sync-boundary guard *before* being interpreted as a
 * boolean — a `Promise.resolve(false)` escape hatch is truthy and would otherwise make a rejection look
 * like an accepted refinement.
 */
function applyRefinements(
	value: unknown,
	refinements: readonly DependencyRefinement[],
): { readonly ok: true, readonly value: unknown } | { readonly ok: false, readonly received: unknown } {
	for (const refine of refinements) {
		const accepted: unknown = refine(value)
		assertSyncValue(accepted, 'A dependency .validate() refinement')
		if (!accepted)
			return { ok: false, received: value }
	}
	return { ok: true, value }
}

function locationOf(operation: BlueprintDependencyReference['operation'], widgetId: WidgetId): RuntimeDiagnosticLocation {
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
			return (candidate: unknown) => ({ ok: true, value: candidate }) satisfies ExecutionResult<unknown, never>
		case 'method-invoke':
			return (..._args: readonly unknown[]) => ({ ok: true, value: null }) satisfies ExecutionResult<unknown, never>
		case 'state-get':
		case 'property-get':
			return () => ({ ok: true, value: null }) satisfies ExecutionResult<unknown, never>
	}
}

function missingRegistryEntry(targetNodeId: number): never {
	throw new Error(`widget-core: internal error — dependency target node ${targetNodeId} has no primitive registry entry.`)
}

/**
 * Looks up the target node's registry entry. Called lazily, inside each returned callable, never while
 * building the callable: the registry is populated progressively while the Runtime is constructed, so
 * a target node's own entry (and the primitive inside it) may not exist yet at materialization time —
 * only by the time the callable is actually invoked, after `createRuntime()` has finished.
 */
function resolveEntry(params: DepsMaterializeParams, targetNodeId: number): PrimitiveRegistryEntry {
	return params.registry.get(targetNodeId) ?? missingRegistryEntry(targetNodeId)
}

function materializeResolvedLeaf(leaf: CompiledDependency & { status: 'resolved' }, params: DepsMaterializeParams): unknown {
	const { reference } = leaf
	const { operation } = reference
	const targetWidgetId = resolveTargetWidgetId(params.nodes, leaf.targetNodeId)
	const related = locationOf(operation, targetWidgetId)
	const leafId = nextLeafId++

	switch (operation.type) {
		case 'state-get': {
			return () => {
				const target = resolveEntry(params, leaf.targetNodeId).state.get(operation.key)
				if (target === undefined)
					throw new Error(`widget-core: internal error — resolved state-get target "${operation.key}" is missing.`)

				const raw = target.internal.get()
				const refined = applyRefinements(raw, leaf.refinements)
				if (!refined.ok) {
					const diagnostic = consumerDependencyDiagnostic(params, reference, 'The dependency value failed validation.', { value: refined.received }, related)
					// Deep-freeze both the diagnostic and the single-element array *before* inserting it into
					// the active collector and returning it to plugin code — otherwise plugin code could
					// mutate `depResult.diagnostics[0]` between "reported" and "returned", and the mutated
					// object would then get committed as the consumer's own latest snapshot.
					const diagnostics = freezeDiagnosticSnapshot([deepFreezeDiagnostic(diagnostic)])
					reportDependencyDiagnostic(params, diagnostic, dependencyDedupeDescriptor(leafId, refined.received))
					return { ok: false, failure: { diagnostics: diagnostics as readonly [unknown, ...unknown[]] } } satisfies ExecutionResult<never, unknown>
				}
				return { ok: true, value: refined.value }
			}
		}

		case 'state-set': {
			return (candidate: unknown) => {
				const target = resolveEntry(params, leaf.targetNodeId).state.get(operation.key)
				if (target === undefined)
					throw new Error(`widget-core: internal error — resolved state-set target "${operation.key}" is missing.`)

				const result = target.internal.attemptSet(candidate)
				if (result.ok)
					return { ok: true, value: candidate }

				const wrapped = wrapTargetFailure(params, reference, result.failure.diagnostics, related, leafId)
				return { ok: false, failure: { diagnostics: wrapped } }
			}
		}

		case 'property-get': {
			return () => {
				const target = resolveEntry(params, leaf.targetNodeId).properties.get(operation.name)
				if (target === undefined)
					throw new Error(`widget-core: internal error — resolved property-get target "${operation.name}" is missing.`)

				const targetResult = target.internal.getResult()
				if (!targetResult.ok) {
					const wrapped = wrapTargetFailure(params, reference, targetResult.failure.diagnostics, related, leafId)
					return { ok: false, failure: { diagnostics: wrapped } }
				}

				const refined = applyRefinements(targetResult.value, leaf.refinements)
				if (!refined.ok) {
					const diagnostic = consumerDependencyDiagnostic(params, reference, 'The dependency value failed validation.', { value: refined.received }, related)
					// Deep-freeze both the diagnostic and the single-element array *before* inserting it into
					// the active collector and returning it to plugin code — otherwise plugin code could
					// mutate `depResult.diagnostics[0]` between "reported" and "returned", and the mutated
					// object would then get committed as the consumer's own latest snapshot.
					const diagnostics = freezeDiagnosticSnapshot([deepFreezeDiagnostic(diagnostic)])
					reportDependencyDiagnostic(params, diagnostic, dependencyDedupeDescriptor(leafId, refined.received))
					return { ok: false, failure: { diagnostics: diagnostics as readonly [unknown, ...unknown[]] } } satisfies ExecutionResult<never, unknown>
				}
				return { ok: true, value: refined.value }
			}
		}

		case 'method-invoke': {
			return (...args: readonly unknown[]) => {
				const target = resolveEntry(params, leaf.targetNodeId).methods.get(operation.name)
				if (target === undefined)
					throw new Error(`widget-core: internal error — resolved method-invoke target "${operation.name}" is missing.`)

				const targetResult = target.public(...args)
				if (!targetResult.ok) {
					const wrapped = wrapTargetFailure(params, reference, targetResult.failure.diagnostics, related, leafId)
					return { ok: false, failure: { diagnostics: wrapped } }
				}

				const refined = applyRefinements(targetResult.value, leaf.refinements)
				if (!refined.ok) {
					const diagnostic = consumerDependencyDiagnostic(params, reference, 'The dependency value failed validation.', { value: refined.received }, related)
					// Deep-freeze both the diagnostic and the single-element array *before* inserting it into
					// the active collector and returning it to plugin code — otherwise plugin code could
					// mutate `depResult.diagnostics[0]` between "reported" and "returned", and the mutated
					// object would then get committed as the consumer's own latest snapshot.
					const diagnostics = freezeDiagnosticSnapshot([deepFreezeDiagnostic(diagnostic)])
					reportDependencyDiagnostic(params, diagnostic, dependencyDedupeDescriptor(leafId, refined.received))
					return { ok: false, failure: { diagnostics: diagnostics as readonly [unknown, ...unknown[]] } } satisfies ExecutionResult<never, unknown>
				}
				return { ok: true, value: refined.value }
			}
		}
	}
}

function wrapTargetFailure(
	params: DepsMaterializeParams,
	reference: BlueprintDependencyReference,
	// State-set wraps `RuntimeStateDiagnostic`; property-get/method-invoke wrap `RuntimePropertyDiagnostic` /
	// `RuntimeMethodDiagnostic`. Only `.message` (preserved 1:1) and the diagnostic's own identity (as a dedupe
	// anchor) are needed here, so the parameter stays structurally minimal rather than importing every
	// concrete target-diagnostic type.
	targetDiagnostics: readonly RuntimeDiagnostic[],
	related: RuntimeDiagnosticLocation,
	leafId: number,
): readonly [unknown, ...unknown[]] {
	// Build + deep-freeze every wrapped diagnostic (and pair it with its dedupe anchor) before reporting any
	// of them to the active collector or returning the array to plugin code — same ordering rationale
	// as the refinement-rejection branches above: nothing outside this function ever observes a
	// not-yet-frozen wrapped diagnostic.
	const pairs = targetDiagnostics.map((targetDiagnostic) => {
		const diagnostic = consumerDependencyDiagnostic(params, reference, targetDiagnostic.message, undefined, related, targetDiagnostic)
		deepFreezeDiagnostic(diagnostic)
		return { diagnostic, targetDiagnostic }
	})
	const wrapped = pairs.map(pair => pair.diagnostic)
	freezeDiagnosticSnapshot(wrapped)

	for (const { diagnostic, targetDiagnostic } of pairs)
		reportDependencyDiagnostic(params, diagnostic, dependencyDedupeDescriptor(leafId, targetDiagnostic))

	return wrapped as unknown as readonly [unknown, ...unknown[]]
}

function materializeLeaf(leaf: CompiledDependency, params: DepsMaterializeParams): unknown {
	if (leaf.status === 'absent')
		return materializeAbsentLeaf(leaf.reference.operation)

	// `invalid` is always accompanied by a Blueprint dependency Diagnostic, so a Blueprint carrying one is
	// always `invalid` — Runtime is only ever created from a valid Blueprint (diagnostic #10 inspection
	// amendment "inspection exact API v1 part 1"), so this branch can never actually run.
	if (leaf.status === 'invalid')
		throw new Error('widget-core: internal error — an invalid dependency reached Runtime materialization; Runtime must only be created from a valid Blueprint.')

	return materializeResolvedLeaf(leaf, params)
}

export function materializeDependencyTree(tree: CompiledDependencyTree, params: DepsMaterializeParams): unknown {
	if (isCompiledDependency(tree))
		return materializeLeaf(tree, params)

	if (Array.isArray(tree))
		return tree.map(item => materializeDependencyTree(item as CompiledDependencyTree, params))

	// `Object.keys(tree)` may include special names such as "__proto__"; bracket-assigning those into
	// plain `{}` would mutate the object's prototype instead of creating an own member, so the
	// container is built on a null-prototype record instead.
	const result: Record<string, unknown> = Object.create(null)
	for (const key of Object.keys(tree))
		result[key] = materializeDependencyTree((tree as Record<string, CompiledDependencyTree>)[key]!, params)

	return result
}
