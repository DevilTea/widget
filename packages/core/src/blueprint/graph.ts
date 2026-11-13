/**
 * Method write-effect analysis, Property purity diagnostics and evaluation-cycle analysis — compile
 * pipeline steps 10-13 (consolidated handoff §10).
 *
 * Normative contract: DevilTea/widget Discussion #12, Core composition architecture topic. Historical source (migrated): diagnostic #10 amendment "simplify method graph semantics; only Property safety is
 * normative" (COMMENT 18, superseding COMMENT 12's Property-reachable method-only SCC rule) and
 * consolidated handoff §9.
 *
 * A cyclic SCC (size > 1, or a singleton with a self-loop) is Blueprint-invalid iff it contains at
 * least one Property. Method-only cyclic SCCs are valid and receive no diagnostics.
 */

import type { BlueprintDependencyDiagnosticLocation, BlueprintDiagnostic } from '../diagnostic'
import type { CompiledGraphAnalysis, CompiledMemberRef, InternalNodeId, ResolvedBlueprintWidgetNode } from '../internal/contract'
import type { GraphEdge } from './deps'
import type { WorkingNode } from './recovery'
import { dependencyDiagnostic, methodLocation, propertyLocation } from './diagnostics'

interface MemberRef {
	readonly nodeId: InternalNodeId
	readonly kind: 'property' | 'method'
	readonly name: string
}

function memberLocation(nodes: readonly WorkingNode[], ref: MemberRef): BlueprintDependencyDiagnosticLocation {
	const node = nodes[ref.nodeId]!.publicNode as ResolvedBlueprintWidgetNode
	return ref.kind === 'property' ? propertyLocation(node, ref.name) : methodLocation(node, ref.name)
}

/**
 * Propagates write effects over Method->Method edges: a Method is writeful when it directly writes
 * State or invokes a writeful Method. The set is the closure of the direct-write seeds under the
 * reverse of those edges, found by a work list over a callee->callers adjacency built once, then
 * marks the transitively-writeful methods on each node's already-built `CompiledMethodMember` map.
 */
function computeWritefulMethods(nodes: readonly WorkingNode[], edges: readonly GraphEdge[], directWriteSeeds: ReadonlySet<string>): ReadonlySet<string> {
	const writeful = new Set(directWriteSeeds)
	const callersOf = new Map<string, string[]>()
	for (const edge of edges) {
		if (edge.fromKind !== 'method' || edge.toKind !== 'method')
			continue
		const toKey = `${edge.toNodeId}:${edge.toName}`
		const fromKey = `${edge.fromNodeId}:${edge.fromName}`
		const callers = callersOf.get(toKey)
		if (callers === undefined)
			callersOf.set(toKey, [fromKey])
		else
			callers.push(fromKey)
	}

	const workList = [...writeful]
	for (let index = 0; index < workList.length; index++) {
		for (const caller of callersOf.get(workList[index]!) ?? []) {
			if (!writeful.has(caller)) {
				writeful.add(caller)
				workList.push(caller)
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

function emitPurityDiagnostics(nodes: readonly WorkingNode[], edges: readonly GraphEdge[], writefulMethods: ReadonlySet<string>, finalDiagnostics: BlueprintDiagnostic[]): void {
	for (const edge of edges) {
		if (edge.fromKind !== 'property' || edge.toKind !== 'method')
			continue
		if (!writefulMethods.has(`${edge.toNodeId}:${edge.toName}`))
			continue

		const ownerNode = nodes[edge.fromNodeId]!.publicNode as ResolvedBlueprintWidgetNode
		const targetNode = nodes[edge.toNodeId]!.publicNode as ResolvedBlueprintWidgetNode
		finalDiagnostics.push(dependencyDiagnostic(
			ownerNode,
			{ type: 'property', name: edge.fromName },
			'property-dependency-has-write-effects',
			`Property "${edge.fromName}" invokes writeful method "${edge.toName}".`,
			edge.reference,
			[methodLocation(targetNode, edge.toName)],
		))
	}
}

/**
 * Evaluation-graph adjacency in compressed form: the targets of member `id` are
 * `targets[offsets[id]]` to `targets[offsets[id + 1] - 1]`, in edge-insertion order.
 */
function buildAdjacency(edges: readonly GraphEdge[], memberCount: number): { offsets: Int32Array, targets: Int32Array } {
	const offsets = new Int32Array(memberCount + 1)
	for (const edge of edges)
		offsets[edge.fromId + 1]!++
	for (let id = 0; id < memberCount; id++)
		offsets[id + 1]! += offsets[id]!

	const targets = new Int32Array(edges.length)
	const next = offsets.slice(0, memberCount)
	for (const edge of edges)
		targets[next[edge.fromId]!++] = edge.toId
	return { offsets, targets }
}

/**
 * Tarjan's strongly-connected-components algorithm over the evaluation graph, started from each member
 * in member order and visiting adjacency in edge-insertion order for determinism. Returns only the
 * cyclic components (more than one member, or one member with a self-loop), in the order Tarjan
 * completes them. A member without outgoing edges is a trivial component of its own and can never
 * take part in a cycle, so it is neither started from nor entered.
 */
function findCyclicComponents(memberCount: number, offsets: Int32Array, targets: Int32Array): number[][] {
	// `visitOrder` is one-based so that 0 means "not visited yet".
	const visitOrder = new Int32Array(memberCount)
	const lowlink = new Int32Array(memberCount)
	const onStack = new Uint8Array(memberCount)
	const stack = new Int32Array(memberCount)
	let stackSize = 0
	let visited = 0
	const components: number[][] = []

	function strongConnect(id: number): void {
		const order = ++visited
		visitOrder[id] = order
		let low = order
		stack[stackSize++] = id
		onStack[id] = 1

		const end = offsets[id + 1]!
		let hasSelfLoop = false
		for (let edge = offsets[id]!; edge < end; edge++) {
			const next = targets[edge]!
			if (next === id)
				hasSelfLoop = true
			if (visitOrder[next] === 0) {
				if (offsets[next + 1] === offsets[next])
					continue
				strongConnect(next)
				low = Math.min(low, lowlink[next]!)
			}
			else if (onStack[next] === 1) {
				low = Math.min(low, visitOrder[next]!)
			}
		}
		lowlink[id] = low

		if (low === order) {
			const component: number[] = []
			let member: number
			do {
				member = stack[--stackSize]!
				onStack[member] = 0
				component.push(member)
			} while (member !== id)
			if (component.length > 1 || hasSelfLoop)
				components.push(component)
		}
	}

	for (let id = 0; id < memberCount; id++) {
		if (visitOrder[id] === 0 && offsets[id + 1] !== offsets[id])
			strongConnect(id)
	}

	return components
}

function emitCycleDiagnostics(
	nodes: readonly WorkingNode[],
	semanticOrder: readonly InternalNodeId[],
	memberCount: number,
	edges: readonly GraphEdge[],
	finalDiagnostics: BlueprintDiagnostic[],
): readonly (readonly CompiledMemberRef[])[] {
	const { offsets, targets } = buildAdjacency(edges, memberCount)
	const components = findCyclicComponents(memberCount, offsets, targets)
	if (components.length === 0)
		return []

	// Member id -> member, in the member order `resolveDependencies` numbered the members in.
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

	const invalidCycles: (readonly CompiledMemberRef[])[] = []

	for (const component of components) {
		const refs = component
			.sort((a, b) => a - b)
			.map(id => memberOrder[id]!)

		const properties = refs.filter(ref => ref.kind === 'property')
		if (properties.length === 0)
			continue

		invalidCycles.push(refs.map(ref => ({ nodeId: ref.nodeId, member: { type: ref.kind, name: ref.name } })))

		for (const property of properties) {
			const ownerNode = nodes[property.nodeId]!.publicNode as ResolvedBlueprintWidgetNode
			const related = refs
				.filter(ref => ref !== property)
				.map(ref => memberLocation(nodes, ref))

			finalDiagnostics.push(dependencyDiagnostic(
				ownerNode,
				{ type: 'property', name: property.name },
				'property-evaluation-cycle',
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
	edges: readonly GraphEdge[],
	memberCount: number,
	directWriteSeeds: ReadonlySet<string>,
	finalDiagnostics: BlueprintDiagnostic[],
): CompiledGraphAnalysis {
	const writefulMethods = computeWritefulMethods(nodes, edges, directWriteSeeds)
	emitPurityDiagnostics(nodes, edges, writefulMethods, finalDiagnostics)

	const invalidCycles = emitCycleDiagnostics(nodes, semanticOrder, memberCount, edges, finalDiagnostics)

	return {
		writefulMethods,
		invalidCycles,
	}
}
