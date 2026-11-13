/**
 * `registerDeps` invocation and dependency target/member resolution — compile pipeline steps 7-9
 * (consolidated handoff §10).
 *
 * Normative contract: DevilTea/widget Discussion #12, Core composition architecture topic. Historical source (migrated): diagnostic #10 checkpoint D, amendments "dependency resolution and compiled-edge
 * invariants" (COMMENT 11) and "graph-analysis diagnostics" (COMMENT 12), consolidated handoff §8.
 */

import type { AnyDepExpression, DepExpressionInternals } from '../dep'
import type { BlueprintDependencyMember, BlueprintDependencyReference, BlueprintDiagnostic } from '../diagnostic'
import type {
	CompiledDependency,
	CompiledDependencyTree,
	InternalNodeId,
	ResolvedBlueprintWidgetNode,
} from '../internal/contract'
import type { AnyWidgetPluginTuple, WidgetPluginDefinition } from '../plugin'
import type { WidgetId } from '../types'
import type { WorkingNode } from './recovery'
import type { CompileFacade } from './view'
import { createDependencyBuilder, isDepExpression, readDepExpression } from '../dep'
import { compiledDependencyBrand } from '../internal/contract'
import { readWidgetPluginDefinition } from '../plugin'
import { assertSyncValue } from '../runtime/sync'
import { dependencyDiagnostic, sharedWidgetLocation, widgetLocation } from './diagnostics'

export interface GraphEdge {
	readonly fromKind: 'property' | 'method'
	readonly fromNodeId: InternalNodeId
	readonly fromName: string
	/** Dense member id of the owner (see {@link MemberIds}). */
	readonly fromId: number
	readonly toKind: 'property' | 'method'
	readonly toNodeId: InternalNodeId
	readonly toName: string
	/** Dense member id of the target (see {@link MemberIds}). */
	readonly toId: number
	readonly reference: BlueprintDependencyReference
}

export interface DependencyResolutionResult {
	/** Distinct edges in first-reference order. */
	readonly edges: readonly GraphEdge[]
	/** Number of Property and Method members of resolved nodes, i.e. the exclusive upper bound of a member id. */
	readonly memberCount: number
	readonly directWriteSeeds: ReadonlySet<string>
}

/**
 * Dense integer ids for the members of resolved nodes, in the evaluation-graph member order: semantic
 * traversal order, a node's Properties before its Methods, each in declaration order. `baseByNodeId`
 * holds a node's first id; `offsetsByNodeId` maps a member name to its id relative to that base (a
 * Method's offset already includes the node's Property count). Nodes with the same plugin share one
 * offsets table.
 */
interface MemberIds {
	readonly baseByNodeId: number[]
	readonly offsetsByNodeId: (MemberOffsets | undefined)[]
	readonly count: number
}

interface MemberOffsets {
	readonly properties: ReadonlyMap<string, number>
	readonly methods: ReadonlyMap<string, number>
	readonly size: number
}

function createMemberIds(nodes: readonly WorkingNode[], semanticOrder: readonly InternalNodeId[]): MemberIds {
	const offsetsByDefinition = new Map<WidgetPluginDefinition, MemberOffsets>()
	const baseByNodeId: number[] = []
	const offsetsByNodeId: (MemberOffsets | undefined)[] = []
	let count = 0
	for (const nodeId of semanticOrder) {
		const node = nodes[nodeId]!
		if (!node.resolved || node.plugin === null)
			continue
		const definition = readWidgetPluginDefinition(node.plugin)
		let offsets = offsetsByDefinition.get(definition)
		if (offsets === undefined) {
			const properties = new Map<string, number>()
			const methods = new Map<string, number>()
			let size = 0
			for (const name of definition.properties?.keys() ?? [])
				properties.set(name, size++)
			for (const name of definition.methods?.keys() ?? [])
				methods.set(name, size++)
			offsets = { properties, methods, size }
			offsetsByDefinition.set(definition, offsets)
		}
		baseByNodeId[nodeId] = count
		offsetsByNodeId[nodeId] = offsets
		count += offsets.size
	}
	return { baseByNodeId, offsetsByNodeId, count }
}

function configFragment(node: WorkingNode): Record<string, unknown> {
	return node.plugin !== null && readWidgetPluginDefinition(node.plugin).config !== null
		? { config: node.config }
		: {}
}

function walkDeps(value: unknown, resolveLeaf: (leaf: AnyDepExpression) => CompiledDependency): CompiledDependencyTree {
	if (isDepExpression(value))
		return resolveLeaf(value)

	if (Array.isArray(value))
		return Object.freeze(value.map(item => walkDeps(item, resolveLeaf))) as CompiledDependencyTree

	if (typeof value === 'object' && value !== null) {
		// A `registerDeps` container's keys are arbitrary plugin-authored strings, including special
		// JavaScript names (`__proto__`, `constructor`, ...). A plain `{}` plus bracket assignment would
		// let a `"__proto__"` key mutate this object's own `[[Prototype]]` instead of creating an own
		// member, after which prototype delegation would make the smuggled leaf visible through every
		// other key via `isCompiledDependency`. `Object.create(null)` keeps every key an own,
		// prototype-safe data property (COMMENT amendment: builder/member-key special-name safety).
		const result: Record<string, CompiledDependencyTree> = Object.create(null)
		for (const key of Object.keys(value))
			result[key] = walkDeps((value as Record<string, unknown>)[key], resolveLeaf)
		return Object.freeze(result)
	}

	// A non-expression, non-container leaf can only be reached through a plugin `any`/contract escape
	// (COMMENT 31 §10): treat it the same as a `registerDeps` implementation throw, not as user data.
	throw new TypeError('registerDeps() returned a value that is neither a dependency expression nor a container of one; this is a plugin implementation bug.')
}

function describeMissingTarget(target: BlueprintDependencyReference['target']): string {
	switch (target.type) {
		case 'parent':
			return 'Dependency target (parent) does not exist.'
		case 'widget':
			return `Dependency target widget "${target.widgetId}" does not exist.`
		default:
			return 'Dependency target does not exist.'
	}
}

// The computed brand key goes last in these literals: V8's interpreter builds a literal whose first key is
// computed one property at a time, which is several times slower than a literal with constant leading keys.
// `Reflect.ownKeys` order is unaffected (string keys always precede symbol keys).
function absentDependency(reference: BlueprintDependencyReference, refinements: DepExpressionInternals['refinements']): CompiledDependency {
	return { status: 'absent', reference, refinements, [compiledDependencyBrand]: true }
}

// Every other ordinary resolution failure is `invalid`, never `absent` (diagnostic #10 inspection
// amendment "inspection exact API v1 part 1"): `targetNodeId` is included only when cardinality
// resolved to exactly one recovered node before the later step failed.
function invalidDependency(reference: BlueprintDependencyReference, refinements: DepExpressionInternals['refinements'], targetNodeId?: InternalNodeId): CompiledDependency {
	return targetNodeId === undefined
		? { status: 'invalid', reference, refinements, [compiledDependencyBrand]: true }
		: { status: 'invalid', reference, refinements, targetNodeId, [compiledDependencyBrand]: true }
}

function resolveLeaf(
	nodes: readonly WorkingNode[],
	nodeIdsByWidgetId: ReadonlyMap<WidgetId, readonly InternalNodeId[]>,
	rootNodeId: InternalNodeId,
	ownerNodeId: InternalNodeId,
	ownerMemberId: number,
	member: BlueprintDependencyMember,
	leaf: AnyDepExpression,
	finalDiagnostics: BlueprintDiagnostic[],
	memberIds: MemberIds,
	edges: GraphEdge[],
	edgeKeys: Set<number>,
	directWriteSeeds: Set<string>,
): CompiledDependency {
	const { reference, refinements } = readDepExpression(leaf)
	const { target, operation } = reference
	const owner = nodes[ownerNodeId]!
	const ownerPublicNode = owner.publicNode as ResolvedBlueprintWidgetNode

	// A Property-owned `state-set` expression is impossible through the legitimate dep grammar (the
	// fluent builder never exposes `.set` to a property consumer); reaching this is only possible via a
	// JS / `any` contract escape (COMMENT 31 §10 amendment). Property members must stay transitively
	// side-effect free, so this is a plugin implementation bug, never a silently-accepted resolved edge
	// or a normal Blueprint diagnostic.
	if (operation.type === 'state-set' && member.type === 'property') {
		throw new TypeError(
			'registerDeps() produced a state-set dependency owned by a Property; Property members must remain side-effect free. This is a plugin implementation bug.',
		)
	}

	let candidateIds: readonly InternalNodeId[]
	switch (target.type) {
		case 'self':
			candidateIds = [ownerNodeId]
			break
		case 'root':
			candidateIds = [rootNodeId]
			break
		case 'parent':
			candidateIds = owner.parentNodeId === null ? [] : [owner.parentNodeId]
			break
		case 'widget':
			candidateIds = nodeIdsByWidgetId.get(target.widgetId) ?? []
			break
	}

	if (candidateIds.length === 0) {
		if ((target.type === 'parent' || target.type === 'widget') && target.optional)
			return absentDependency(reference, refinements)

		finalDiagnostics.push(dependencyDiagnostic(ownerPublicNode, member, 'missing-dependency-target', describeMissingTarget(target), reference))
		return invalidDependency(reference, refinements)
	}

	if (candidateIds.length > 1) {
		const related = candidateIds.map(id => sharedWidgetLocation(nodes[id]!.publicNode))
		finalDiagnostics.push(dependencyDiagnostic(ownerPublicNode, member, 'ambiguous-dependency-target', 'Dependency target is ambiguous: multiple widgets share that id.', reference, related))
		return invalidDependency(reference, refinements)
	}

	const targetNodeId = candidateIds[0]!
	const targetWorking = nodes[targetNodeId]!

	if (!targetWorking.resolved) {
		finalDiagnostics.push(dependencyDiagnostic(ownerPublicNode, member, 'unresolved-dependency-target', 'Dependency target could not be resolved to a widget.', reference, [widgetLocation(targetWorking.publicNode)]))
		return invalidDependency(reference, refinements, targetNodeId)
	}

	const targetDefinition = readWidgetPluginDefinition(targetWorking.plugin!)
	const targetPublicNode = targetWorking.publicNode as ResolvedBlueprintWidgetNode

	if (operation.type === 'state-get' || operation.type === 'state-set') {
		if (targetDefinition.state === null) {
			finalDiagnostics.push(dependencyDiagnostic(ownerPublicNode, member, 'missing-dependency-capability', 'Dependency target has no state capability.', reference, [widgetLocation(targetPublicNode)]))
			return invalidDependency(reference, refinements, targetNodeId)
		}
		if (!targetDefinition.state.has(operation.key)) {
			finalDiagnostics.push(dependencyDiagnostic(ownerPublicNode, member, 'missing-dependency-member', `Dependency target has no state member "${operation.key}".`, reference, [widgetLocation(targetPublicNode)]))
			return invalidDependency(reference, refinements, targetNodeId)
		}
		if (operation.type === 'state-set' && member.type === 'method')
			directWriteSeeds.add(`${ownerNodeId}:${member.name}`)
	}
	else if (operation.type === 'property-get') {
		if (targetDefinition.properties === null) {
			finalDiagnostics.push(dependencyDiagnostic(ownerPublicNode, member, 'missing-dependency-capability', 'Dependency target has no properties capability.', reference, [widgetLocation(targetPublicNode)]))
			return invalidDependency(reference, refinements, targetNodeId)
		}
		if (!targetDefinition.properties.has(operation.name)) {
			finalDiagnostics.push(dependencyDiagnostic(ownerPublicNode, member, 'missing-dependency-member', `Dependency target has no property "${operation.name}".`, reference, [widgetLocation(targetPublicNode)]))
			return invalidDependency(reference, refinements, targetNodeId)
		}
		const toId = memberIds.baseByNodeId[targetNodeId]! + memberIds.offsetsByNodeId[targetNodeId]!.properties.get(operation.name)!
		// `ownerMemberId * count + toId` is injective because `toId < count`.
		const key = ownerMemberId * memberIds.count + toId
		if (!edgeKeys.has(key)) {
			edgeKeys.add(key)
			edges.push({ fromKind: member.type, fromNodeId: ownerNodeId, fromName: member.name, fromId: ownerMemberId, toKind: 'property', toNodeId: targetNodeId, toName: operation.name, toId, reference })
		}
	}
	else {
		if (targetDefinition.methods === null) {
			finalDiagnostics.push(dependencyDiagnostic(ownerPublicNode, member, 'missing-dependency-capability', 'Dependency target has no methods capability.', reference, [widgetLocation(targetPublicNode)]))
			return invalidDependency(reference, refinements, targetNodeId)
		}
		if (!targetDefinition.methods.has(operation.name)) {
			finalDiagnostics.push(dependencyDiagnostic(ownerPublicNode, member, 'missing-dependency-member', `Dependency target has no method "${operation.name}".`, reference, [widgetLocation(targetPublicNode)]))
			return invalidDependency(reference, refinements, targetNodeId)
		}
		const toId = memberIds.baseByNodeId[targetNodeId]! + memberIds.offsetsByNodeId[targetNodeId]!.methods.get(operation.name)!
		const key = ownerMemberId * memberIds.count + toId
		if (!edgeKeys.has(key)) {
			edgeKeys.add(key)
			edges.push({ fromKind: member.type, fromNodeId: ownerNodeId, fromName: member.name, fromId: ownerMemberId, toKind: 'method', toNodeId: targetNodeId, toName: operation.name, toId, reference })
		}
	}

	return {
		status: 'resolved',
		targetNodeId,
		reference,
		refinements,
		[compiledDependencyBrand]: true,
	}
}

export function resolveDependencies(
	nodes: readonly WorkingNode[],
	semanticOrder: readonly InternalNodeId[],
	rootNodeId: InternalNodeId,
	nodeIdsByWidgetId: ReadonlyMap<WidgetId, readonly InternalNodeId[]>,
	compileFacade: CompileFacade<AnyWidgetPluginTuple>,
	finalDiagnostics: BlueprintDiagnostic[],
): DependencyResolutionResult {
	const memberIds = createMemberIds(nodes, semanticOrder)
	const edges: GraphEdge[] = []
	const edgeKeys = new Set<number>()
	const directWriteSeeds = new Set<string>()

	const resolve = (ownerNodeId: InternalNodeId, ownerMemberId: number, member: BlueprintDependencyMember, leaf: AnyDepExpression): CompiledDependency =>
		resolveLeaf(nodes, nodeIdsByWidgetId, rootNodeId, ownerNodeId, ownerMemberId, member, leaf, finalDiagnostics, memberIds, edges, edgeKeys, directWriteSeeds)

	// Properties (step 7), then methods (step 8), each in semantic traversal + declaration order.
	for (const nodeId of semanticOrder) {
		const node = nodes[nodeId]!
		if (!node.resolved || node.plugin === null)
			continue
		const definition = readWidgetPluginDefinition(node.plugin)
		if (definition.properties === null)
			continue

		const configFrag = configFragment(node)
		for (const [name, propertyDefinition] of definition.properties) {
			// A present callback returning `undefined`/`null` (only reachable via a JS/`any` contract
			// escape) is malformed callback output, not the same as the callback being omitted; only an
			// *omitted* callback synthesizes empty deps. `walkDeps` already throws on any non-expression,
			// non-container value (including `null`/`undefined`), so a present callback's result is
			// always routed through it unmodified.
			let rawDeps: unknown = {}
			if (propertyDefinition.registerDeps !== undefined) {
				rawDeps = propertyDefinition.registerDeps({
					widget: compileFacade.facadeForNodeId(nodeId),
					blueprint: compileFacade.view,
					dep: createDependencyBuilder<never, 'property'>(),
					...configFrag,
				})
				assertSyncValue(rawDeps, `Property "${name}"'s registerDeps`)
			}

			const member: BlueprintDependencyMember = { type: 'property', name }
			const ownerMemberId = memberIds.baseByNodeId[nodeId]! + memberIds.offsetsByNodeId[nodeId]!.properties.get(name)!
			const deps = walkDeps(rawDeps, leaf => resolve(nodeId, ownerMemberId, member, leaf))
			node.properties.set(name, { name, definition: propertyDefinition, deps })
		}
	}

	for (const nodeId of semanticOrder) {
		const node = nodes[nodeId]!
		if (!node.resolved || node.plugin === null)
			continue
		const definition = readWidgetPluginDefinition(node.plugin)
		if (definition.methods === null)
			continue

		const configFrag = configFragment(node)
		for (const [name, methodDefinition] of definition.methods) {
			// Same "omitted vs malformed" distinction as the properties loop above.
			let rawDeps: unknown = {}
			if (methodDefinition.registerDeps !== undefined) {
				rawDeps = methodDefinition.registerDeps({
					widget: compileFacade.facadeForNodeId(nodeId),
					blueprint: compileFacade.view,
					dep: createDependencyBuilder<never, 'method'>(),
					...configFrag,
				})
				assertSyncValue(rawDeps, `Method "${name}"'s registerDeps`)
			}

			const member: BlueprintDependencyMember = { type: 'method', name }
			const ownerMemberId = memberIds.baseByNodeId[nodeId]! + memberIds.offsetsByNodeId[nodeId]!.methods.get(name)!
			const deps = walkDeps(rawDeps, leaf => resolve(nodeId, ownerMemberId, member, leaf))
			node.methods.set(name, { name, definition: methodDefinition, deps, transitivelyWrites: false })
		}
	}

	return { edges, memberCount: memberIds.count, directWriteSeeds }
}
