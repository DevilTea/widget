/**
 * Method write-effect analysis, Property purity diagnostics and evaluation-cycle analysis — compile
 * pipeline steps 10-13 (consolidated handoff §10).
 *
 * Normative source: issue #10 amendment "simplify method graph semantics; only Property safety is
 * normative" (COMMENT 18, superseding COMMENT 12's Property-reachable method-only SCC rule) and
 * consolidated handoff §9.
 *
 * A cyclic SCC (size > 1, or a singleton with a self-loop) is Blueprint-invalid iff it contains at
 * least one Property. Method-only cyclic SCCs are valid and receive no diagnostics.
 */

import type { CompiledGraphAnalysis, CompiledMemberRef, InternalNodeId, ResolvedBlueprintWidgetNode } from '../internal/contract'
import type { BlueprintDependencyIssueLocation, BlueprintIssue } from '../issue'
import type { GraphEdge } from './deps'
import type { WorkingNode } from './recovery'
import { dependencyIssue, methodLocation, propertyLocation } from './issues'

interface MemberRef {
	readonly nodeId: InternalNodeId
	readonly kind: 'property' | 'method'
	readonly name: string
}

function memberKey(kind: string, nodeId: InternalNodeId, name: string): string {
	return `${kind}:${nodeId}:${name}`
}

function memberLocation(nodes: readonly WorkingNode[], ref: MemberRef): BlueprintDependencyIssueLocation {
	const node = nodes[ref.nodeId]!.publicNode as ResolvedBlueprintWidgetNode
	return ref.kind === 'property' ? propertyLocation(node, ref.name) : methodLocation(node, ref.name)
}

/**
 * Runs the write-effect fixed point over Method->Method edges, marking transitively-writeful methods
 * on each node's already-built `CompiledMethodMember` map.
 */
function computeWritefulMethods(nodes: readonly WorkingNode[], edges: ReadonlyMap<string, GraphEdge>, directWriteSeeds: ReadonlySet<string>): ReadonlySet<string> {
	const writeful = new Set(directWriteSeeds)
	const methodEdges = [...edges.values()].filter(edge => edge.fromKind === 'method' && edge.toKind === 'method')

	let changed = true
	while (changed) {
		changed = false
		for (const edge of methodEdges) {
			const fromKey = `${edge.fromNodeId}:${edge.fromName}`
			const toKey = `${edge.toNodeId}:${edge.toName}`
			if (writeful.has(toKey) && !writeful.has(fromKey)) {
				writeful.add(fromKey)
				changed = true
			}
		}
	}

	for (const node of nodes) {
		if (!node.resolved)
			continue
		for (const [name, member] of node.methods) {
			if (writeful.has(`${node.nodeId}:${name}`) && !member.transitivelyWrites)
				node.methods.set(name, { ...member, transitivelyWrites: true })
		}
	}

	return writeful
}

function emitPurityIssues(nodes: readonly WorkingNode[], edges: ReadonlyMap<string, GraphEdge>, writefulMethods: ReadonlySet<string>, finalIssues: BlueprintIssue[]): void {
	for (const edge of edges.values()) {
		if (edge.fromKind !== 'property' || edge.toKind !== 'method')
			continue
		if (!writefulMethods.has(`${edge.toNodeId}:${edge.toName}`))
			continue

		const ownerNode = nodes[edge.fromNodeId]!.publicNode as ResolvedBlueprintWidgetNode
		const targetNode = nodes[edge.toNodeId]!.publicNode as ResolvedBlueprintWidgetNode
		finalIssues.push(dependencyIssue(
			ownerNode,
			{ type: 'property', name: edge.fromName },
			`Property "${edge.fromName}" invokes writeful method "${edge.toName}".`,
			edge.reference,
			[methodLocation(targetNode, edge.toName)],
		))
	}
}

/**
 * Tarjan's strongly-connected-components algorithm over the evaluation graph, visiting adjacency in
 * `memberOrder` for determinism.
 */
function findStronglyConnectedComponents(memberOrder: readonly string[], adjacency: ReadonlyMap<string, readonly string[]>): string[][] {
	const indexOf = new Map<string, number>()
	let indexCounter = 0
	const lowlink = new Map<string, number>()
	const onStack = new Set<string>()
	const stack: string[] = []
	const components: string[][] = []

	function strongConnect(key: string): void {
		indexOf.set(key, indexCounter)
		lowlink.set(key, indexCounter)
		indexCounter++
		stack.push(key)
		onStack.add(key)

		for (const next of adjacency.get(key) ?? []) {
			if (!indexOf.has(next)) {
				strongConnect(next)
				lowlink.set(key, Math.min(lowlink.get(key)!, lowlink.get(next)!))
			}
			else if (onStack.has(next)) {
				lowlink.set(key, Math.min(lowlink.get(key)!, indexOf.get(next)!))
			}
		}

		if (lowlink.get(key) === indexOf.get(key)) {
			const component: string[] = []
			let member: string
			do {
				member = stack.pop()!
				onStack.delete(member)
				component.push(member)
			} while (member !== key)
			components.push(component)
		}
	}

	for (const key of memberOrder) {
		if (!indexOf.has(key))
			strongConnect(key)
	}

	return components
}

function emitCycleIssues(
	nodes: readonly WorkingNode[],
	memberOrder: readonly MemberRef[],
	memberOrderKeys: readonly string[],
	adjacency: ReadonlyMap<string, readonly string[]>,
	finalIssues: BlueprintIssue[],
): readonly (readonly CompiledMemberRef[])[] {
	const refByKey = new Map<string, MemberRef>()
	for (const ref of memberOrder)
		refByKey.set(memberKey(ref.kind, ref.nodeId, ref.name), ref)

	const orderIndex = new Map<string, number>()
	memberOrderKeys.forEach((key, index) => orderIndex.set(key, index))

	const components = findStronglyConnectedComponents(memberOrderKeys, adjacency)
	const invalidCycles: (readonly CompiledMemberRef[])[] = []

	for (const component of components) {
		const hasSelfLoop = component.length === 1 && (adjacency.get(component[0]!) ?? []).includes(component[0]!)
		const isCyclic = component.length > 1 || hasSelfLoop
		if (!isCyclic)
			continue

		const refs = component
			.map(key => refByKey.get(key)!)
			.sort((a, b) => orderIndex.get(memberKey(a.kind, a.nodeId, a.name))! - orderIndex.get(memberKey(b.kind, b.nodeId, b.name))!)

		const properties = refs.filter(ref => ref.kind === 'property')
		if (properties.length === 0)
			continue

		invalidCycles.push(refs.map(ref => ({ nodeId: ref.nodeId, member: { type: ref.kind, name: ref.name } })))

		for (const property of properties) {
			const ownerNode = nodes[property.nodeId]!.publicNode as ResolvedBlueprintWidgetNode
			const related = refs
				.filter(ref => ref !== property)
				.map(ref => memberLocation(nodes, ref))

			finalIssues.push(dependencyIssue(
				ownerNode,
				{ type: 'property', name: property.name },
				`Property "${property.name}" participates in an evaluation cycle.`,
				undefined,
				related,
			))
		}
	}

	return invalidCycles
}

export function runGraphAnalysis(
	nodes: readonly WorkingNode[],
	semanticOrder: readonly InternalNodeId[],
	edges: ReadonlyMap<string, GraphEdge>,
	directWriteSeeds: ReadonlySet<string>,
	finalIssues: BlueprintIssue[],
): CompiledGraphAnalysis {
	const writefulMethods = computeWritefulMethods(nodes, edges, directWriteSeeds)
	emitPurityIssues(nodes, edges, writefulMethods, finalIssues)

	const memberOrder: MemberRef[] = []
	for (const nodeId of semanticOrder) {
		const node = nodes[nodeId]!
		if (!node.resolved)
			continue
		for (const name of node.properties.keys())
			memberOrder.push({ nodeId, kind: 'property', name })
		for (const name of node.methods.keys())
			memberOrder.push({ nodeId, kind: 'method', name })
	}
	const memberOrderKeys = memberOrder.map(ref => memberKey(ref.kind, ref.nodeId, ref.name))

	const adjacency = new Map<string, string[]>()
	for (const edge of edges.values()) {
		const fromKey = memberKey(edge.fromKind, edge.fromNodeId, edge.fromName)
		const toKey = memberKey(edge.toKind, edge.toNodeId, edge.toName)
		const list = adjacency.get(fromKey)
		if (list === undefined)
			adjacency.set(fromKey, [toKey])
		else
			list.push(toKey)
	}

	const invalidCycles = emitCycleIssues(nodes, memberOrder, memberOrderKeys, adjacency, finalIssues)

	return {
		writefulMethods,
		invalidCycles,
	}
}
