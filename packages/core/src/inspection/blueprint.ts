/**
 * `inspectBlueprint()` — Blueprint-side readonly inspection projection.
 *
 * Every fact projected here is read directly off the compiler-authoritative `CompiledBlueprint` (see
 * `../internal/contract.ts`, `../blueprint/deps.ts`, `../blueprint/graph.ts`); this module performs zero
 * semantic execution, zero own SCC/DFS analysis and never reconstructs a dependency's status from
 * Issues — adversarial review gate (1)/(3) of issue #10's inspection amendments.
 *
 * Normative source: issue #10 amendments "inspection exact API v1 (part 1: Blueprint inspection)" and
 * the earlier locked inspection amendments it composes with.
 */

import type {
	BlueprintWidgetNode,
	CompiledBlueprint,
	CompiledDependency,
	CompiledDependencyTree,
	CompiledResolvedWidgetNode,
	CompiledWidgetNode,
	InternalNodeId,
	WidgetSystemBlueprint,
} from '../internal/contract'
import type { BlueprintDependencyReference } from '../issue'
import type { AnyWidgetPluginTuple } from '../plugin'
import type {
	BlueprintInspection,
	BlueprintInspectionCapabilities,
	BlueprintInspectionDependency,
	BlueprintInspectionInvalidCycle,
	BlueprintInspectionMemberRef,
	BlueprintInspectionMethodMember,
	BlueprintInspectionNode,
	BlueprintInspectionPropertyMember,
	BlueprintInspectionSemanticSlot,
	BlueprintInspectionSourceSlot,
	BlueprintInspectionStateMember,
	InspectionNodeId,
} from './types'
import { isCompiledDependency, readCompiledBlueprint } from '../internal/contract'
import { readWidgetPluginDefinition } from '../plugin'

// -------------------------------------------------------------------------------------------------
// Dependency flattening
// -------------------------------------------------------------------------------------------------

/**
 * Projects a compiler-owned `BlueprintDependencyReference` into an independent, deep-frozen structural
 * clone (`target`/`operation` included).
 *
 * The compiler's own `reference` object (and its nested `target`/`operation` wrappers) is not guaranteed
 * frozen for resolved/absent leaves — only issue finalization freezes it, and resolved/absent leaves
 * never produce an Issue of their own. Runtime dependency-callable closures (`../runtime/deps.ts`)
 * capture that *same* object; aliasing it directly into the public inspection snapshot would let a
 * consumer mutate `dependency.reference.operation`/`.target` through `as any` and corrupt later Runtime
 * lookups/diagnostics — a live inspection-to-semantics channel the readonly contract must not allow.
 */
function freezeClonedReference(reference: BlueprintDependencyReference): BlueprintDependencyReference {
	const target = Object.freeze({ ...reference.target }) as BlueprintDependencyReference['target']
	const operation = Object.freeze({ ...reference.operation }) as BlueprintDependencyReference['operation']
	return Object.freeze({ target, operation })
}

function buildMemberRef(nodeId: InternalNodeId, operation: BlueprintDependencyReference['operation']): BlueprintInspectionMemberRef {
	const member = operation.type === 'state-get' || operation.type === 'state-set'
		? { type: 'state' as const, name: operation.key }
		: operation.type === 'property-get'
			? { type: 'property' as const, name: operation.name }
			: { type: 'method' as const, name: operation.name }

	return Object.freeze({
		nodeId: nodeId as InspectionNodeId,
		member: Object.freeze(member),
	})
}

function projectDependency(leaf: CompiledDependency, path: readonly (string | number)[]): BlueprintInspectionDependency {
	const frozenPath = Object.freeze(path)
	const reference = freezeClonedReference(leaf.reference)

	if (leaf.status === 'resolved') {
		return Object.freeze({
			status: 'resolved',
			path: frozenPath,
			reference,
			target: buildMemberRef(leaf.targetNodeId, leaf.reference.operation),
		})
	}

	if (leaf.status === 'absent') {
		return Object.freeze({
			status: 'absent',
			path: frozenPath,
			reference,
		})
	}

	return Object.freeze({
		status: 'invalid',
		path: frozenPath,
		reference,
		...(leaf.targetNodeId === undefined ? {} : { targetNodeId: leaf.targetNodeId as InspectionNodeId }),
	})
}

/**
 * Recursive dependency-container leaf traversal, in the same order `../blueprint/deps.ts`'s `walkDeps`
 * built the tree (array index order; object key order — `Object.keys()` of a `registerDeps()`-authored
 * container preserves the plugin's own insertion order, including special names like `__proto__`).
 */
function flattenDependencies(tree: CompiledDependencyTree): readonly BlueprintInspectionDependency[] {
	const result: BlueprintInspectionDependency[] = []

	function walk(node: CompiledDependencyTree, path: readonly (string | number)[]): void {
		if (isCompiledDependency(node)) {
			result.push(projectDependency(node, path))
			return
		}

		if (Array.isArray(node)) {
			node.forEach((item, index) => walk(item as CompiledDependencyTree, [...path, index]))
			return
		}

		for (const key of Object.keys(node))
			walk((node as Record<string, CompiledDependencyTree>)[key]!, [...path, key])
	}

	walk(tree, [])
	return Object.freeze(result)
}

// -------------------------------------------------------------------------------------------------
// Node projection
// -------------------------------------------------------------------------------------------------

function buildSourceSlots(compiledNode: CompiledWidgetNode): readonly BlueprintInspectionSourceSlot[] {
	const semanticSlots = compiledNode.resolved ? compiledNode.semanticSlots : null

	return Object.freeze(compiledNode.rawSlots.map(rawSlot => Object.freeze({
		name: rawSlot.slot,
		placement: semanticSlots !== null && semanticSlots.has(rawSlot.slot) ? 'slot' as const : 'raw-slot' as const,
		children: Object.freeze(rawSlot.childNodeIds.map(id => id as InspectionNodeId)),
	})))
}

function buildSemanticSlots(compiledNode: CompiledResolvedWidgetNode): readonly BlueprintInspectionSemanticSlot[] {
	const result: BlueprintInspectionSemanticSlot[] = []
	for (const [name, childIds] of compiledNode.semanticSlots) {
		result.push(Object.freeze({
			name,
			children: Object.freeze(childIds.map(id => id as InspectionNodeId)),
		}))
	}
	return Object.freeze(result)
}

function buildStateMembers(compiledNode: CompiledResolvedWidgetNode): readonly BlueprintInspectionStateMember[] {
	const result: BlueprintInspectionStateMember[] = []
	for (const name of compiledNode.state.keys())
		result.push(Object.freeze({ type: 'state' as const, name }))
	return Object.freeze(result)
}

function buildPropertyMembers(compiledNode: CompiledResolvedWidgetNode): readonly BlueprintInspectionPropertyMember[] {
	const result: BlueprintInspectionPropertyMember[] = []
	for (const [name, member] of compiledNode.properties) {
		result.push(Object.freeze({
			type: 'property' as const,
			name,
			dependencies: flattenDependencies(member.deps),
		}))
	}
	return Object.freeze(result)
}

function buildMethodMembers(compiledNode: CompiledResolvedWidgetNode): readonly BlueprintInspectionMethodMember[] {
	const result: BlueprintInspectionMethodMember[] = []
	for (const [name, member] of compiledNode.methods) {
		result.push(Object.freeze({
			type: 'method' as const,
			name,
			transitivelyWrites: member.transitivelyWrites,
			dependencies: flattenDependencies(member.deps),
		}))
	}
	return Object.freeze(result)
}

function buildCapabilities(compiledNode: CompiledResolvedWidgetNode): BlueprintInspectionCapabilities {
	const definition = readWidgetPluginDefinition(compiledNode.plugin)
	return Object.freeze({
		config: definition.config !== null,
		slots: definition.slots !== null,
		state: definition.state !== null,
		properties: definition.properties !== null,
		methods: definition.methods !== null,
	})
}

function buildNode<Plugins extends AnyWidgetPluginTuple>(compiledNode: CompiledWidgetNode<Plugins>, nodeId: InternalNodeId): BlueprintInspectionNode<Plugins> {
	const sourceSlots = buildSourceSlots(compiledNode)

	if (!compiledNode.resolved) {
		return Object.freeze({
			nodeId: nodeId as InspectionNodeId,
			node: compiledNode.publicNode,
			sourceSlots,
			resolved: false,
		}) as BlueprintInspectionNode<Plugins>
	}

	return Object.freeze({
		nodeId: nodeId as InspectionNodeId,
		node: compiledNode.publicNode,
		sourceSlots,
		resolved: true,
		capabilities: buildCapabilities(compiledNode),
		semanticSlots: buildSemanticSlots(compiledNode),
		state: buildStateMembers(compiledNode),
		properties: buildPropertyMembers(compiledNode),
		methods: buildMethodMembers(compiledNode),
	}) as BlueprintInspectionNode<Plugins>
}

// -------------------------------------------------------------------------------------------------
// Node topology / invalid cycles
// -------------------------------------------------------------------------------------------------

/**
 * Recovered-source topology pre-order: root first, then recursively each node's recovered children in
 * `rawSlots` enumeration order, each with its children in source index order. Deliberately distinct from
 * the compiler's own `semanticOrder` (which prioritizes declared slots over raw-only ones for issue
 * aggregation) — inspection's `nodes` ordering contract is topology-only, not semantic priority.
 */
function computePreOrder(nodes: readonly CompiledWidgetNode[], rootNodeId: InternalNodeId): InternalNodeId[] {
	const order: InternalNodeId[] = []

	function visit(nodeId: InternalNodeId): void {
		order.push(nodeId)
		const node = nodes[nodeId]!
		for (const rawSlot of node.rawSlots) {
			for (const childId of rawSlot.childNodeIds)
				visit(childId)
		}
	}

	visit(rootNodeId)
	return order
}

function buildInvalidCycles(compiled: CompiledBlueprint): readonly BlueprintInspectionInvalidCycle[] {
	return Object.freeze(compiled.analysis.invalidCycles.map(cycle => Object.freeze({
		members: Object.freeze(cycle.map(ref => Object.freeze({
			nodeId: ref.nodeId as InspectionNodeId,
			// `ref.member` is a plain, unfrozen compiler-owned object (`CompiledGraphAnalysis` is never
			// frozen) reused verbatim across every read of this cached snapshot; clone + freeze it so the
			// nested wrapper is externally immutable too, not just the outer cycle/member-ref objects.
			member: Object.freeze({ ...ref.member }),
		}))),
	})))
}

// -------------------------------------------------------------------------------------------------
// Entry
// -------------------------------------------------------------------------------------------------

function buildBlueprintInspection<Plugins extends AnyWidgetPluginTuple>(
	blueprint: WidgetSystemBlueprint<Plugins>,
): BlueprintInspection<Plugins> {
	const compiled = readCompiledBlueprint(blueprint)

	const nodesByInternalId: BlueprintInspectionNode<Plugins>[] = compiled.nodes.map((compiledNode, nodeId) => buildNode(compiledNode, nodeId))
	const preOrder = computePreOrder(compiled.nodes, compiled.rootNodeId)
	const nodes = Object.freeze(preOrder.map(nodeId => nodesByInternalId[nodeId]!))
	const invalidCycles = buildInvalidCycles(compiled)

	function getNode(nodeId: InspectionNodeId): BlueprintInspectionNode<Plugins> | null {
		return nodesByInternalId[nodeId as unknown as number] ?? null
	}

	function getNodeId(node: BlueprintWidgetNode<Plugins>): InspectionNodeId | null {
		const id = compiled.nodeIdByPublicNode.get(node)
		return id === undefined ? null : (id as InspectionNodeId)
	}

	return Object.freeze({
		rootNodeId: compiled.rootNodeId as InspectionNodeId,
		nodes,
		invalidCycles,
		getNode,
		getNodeId,
	})
}

const blueprintInspectionCache = new WeakMap<WidgetSystemBlueprint<any>, BlueprintInspection<any>>()

/**
 * Returns the frozen, first-use eagerly-materialized Blueprint inspection snapshot for `blueprint`,
 * cached (weak, no global strong retention) so `inspectBlueprint(blueprint) === inspectBlueprint(blueprint)`.
 */
export function inspectBlueprint<Plugins extends AnyWidgetPluginTuple = AnyWidgetPluginTuple>(
	blueprint: WidgetSystemBlueprint<Plugins>,
): BlueprintInspection<Plugins> {
	const cached = blueprintInspectionCache.get(blueprint)
	if (cached !== undefined)
		return cached as BlueprintInspection<Plugins>

	const built = buildBlueprintInspection(blueprint)
	blueprintInspectionCache.set(blueprint, built)
	return built
}
