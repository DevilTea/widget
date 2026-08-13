/**
 * `registerDeps` invocation and dependency target/member resolution — compile pipeline steps 7-9
 * (consolidated handoff §10).
 *
 * Normative source: issue #10 checkpoint D, amendments "dependency resolution and compiled-edge
 * invariants" (COMMENT 11) and "graph-analysis diagnostics" (COMMENT 12), consolidated handoff §8.
 */

import type { AnyDepExpression } from '../dep'
import type {
	CompiledDependency,
	CompiledDependencyTree,
	InternalNodeId,
	ResolvedBlueprintWidgetNode,
} from '../internal/contract'
import type { BlueprintDependencyMember, BlueprintDependencyReference, BlueprintIssue } from '../issue'
import type { WidgetId } from '../types'
import type { WorkingNode } from './recovery'
import type { Navigator } from './view'
import { createDependencyBuilder, isDepExpression, readDepExpression } from '../dep'
import { compiledDependencyBrand } from '../internal/contract'
import { readWidgetPluginDefinition } from '../plugin'
import { assertSyncValue } from '../runtime/sync'
import { dependencyIssue, widgetLocation } from './issues'

export interface GraphEdge {
	readonly fromKind: 'property' | 'method'
	readonly fromNodeId: InternalNodeId
	readonly fromName: string
	readonly toKind: 'property' | 'method'
	readonly toNodeId: InternalNodeId
	readonly toName: string
	readonly reference: BlueprintDependencyReference
}

export interface DependencyResolutionResult {
	readonly edges: ReadonlyMap<string, GraphEdge>
	readonly directWriteSeeds: ReadonlySet<string>
}

function configFragment(node: WorkingNode): Record<string, unknown> {
	return node.plugin !== null && readWidgetPluginDefinition(node.plugin).config !== null
		? { config: node.config }
		: {}
}

/**
 * `WidgetMemberKey = string` is an arbitrary finite string domain (member names may themselves
 * contain `:` / `->`), so naive template-literal concatenation of the six identity components is not
 * injective: e.g. a from-name of `"a->method:0:b"` paired with a to-name of `"c"` serializes to the
 * same string as a from-name of `"a"` paired with a to-name of `"b->property:0:c"`. `JSON.stringify`
 * of the component tuple is injective over strings/numbers (it round-trips exactly through
 * `JSON.parse`), so two distinct tuples can never collide regardless of what characters member names
 * contain.
 */
function edgeKey(fromKind: string, fromNodeId: InternalNodeId, fromName: string, toKind: string, toNodeId: InternalNodeId, toName: string): string {
	return JSON.stringify([fromKind, fromNodeId, fromName, toKind, toNodeId, toName])
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

function resolveLeaf(
	nodes: readonly WorkingNode[],
	nodeIdsByWidgetId: ReadonlyMap<WidgetId, readonly InternalNodeId[]>,
	rootNodeId: InternalNodeId,
	ownerNodeId: InternalNodeId,
	member: BlueprintDependencyMember,
	leaf: AnyDepExpression,
	finalIssues: BlueprintIssue[],
	edges: Map<string, GraphEdge>,
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

	const absent = (): CompiledDependency => ({
		[compiledDependencyBrand]: true,
		status: 'absent',
		reference,
		refinements,
	})

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
			return absent()

		finalIssues.push(dependencyIssue(ownerPublicNode, member, describeMissingTarget(target), reference))
		return absent()
	}

	if (candidateIds.length > 1) {
		const related = candidateIds.map(id => widgetLocation(nodes[id]!.publicNode))
		finalIssues.push(dependencyIssue(ownerPublicNode, member, 'Dependency target is ambiguous: multiple widgets share that id.', reference, related))
		return absent()
	}

	const targetNodeId = candidateIds[0]!
	const targetWorking = nodes[targetNodeId]!

	if (!targetWorking.resolved) {
		finalIssues.push(dependencyIssue(ownerPublicNode, member, 'Dependency target could not be resolved to a widget.', reference, [widgetLocation(targetWorking.publicNode)]))
		return absent()
	}

	const targetDefinition = readWidgetPluginDefinition(targetWorking.plugin!)
	const targetPublicNode = targetWorking.publicNode as ResolvedBlueprintWidgetNode

	if (operation.type === 'state-get' || operation.type === 'state-set') {
		if (targetDefinition.state === null) {
			finalIssues.push(dependencyIssue(ownerPublicNode, member, 'Dependency target has no state capability.', reference, [widgetLocation(targetPublicNode)]))
			return absent()
		}
		if (!targetDefinition.state.has(operation.key)) {
			finalIssues.push(dependencyIssue(ownerPublicNode, member, `Dependency target has no state member "${operation.key}".`, reference, [widgetLocation(targetPublicNode)]))
			return absent()
		}
		if (operation.type === 'state-set' && member.type === 'method')
			directWriteSeeds.add(`${ownerNodeId}:${member.name}`)
	}
	else if (operation.type === 'property-get') {
		if (targetDefinition.properties === null) {
			finalIssues.push(dependencyIssue(ownerPublicNode, member, 'Dependency target has no properties capability.', reference, [widgetLocation(targetPublicNode)]))
			return absent()
		}
		if (!targetDefinition.properties.has(operation.name)) {
			finalIssues.push(dependencyIssue(ownerPublicNode, member, `Dependency target has no property "${operation.name}".`, reference, [widgetLocation(targetPublicNode)]))
			return absent()
		}
		const key = edgeKey(member.type, ownerNodeId, member.name, 'property', targetNodeId, operation.name)
		if (!edges.has(key))
			edges.set(key, { fromKind: member.type, fromNodeId: ownerNodeId, fromName: member.name, toKind: 'property', toNodeId: targetNodeId, toName: operation.name, reference })
	}
	else {
		if (targetDefinition.methods === null) {
			finalIssues.push(dependencyIssue(ownerPublicNode, member, 'Dependency target has no methods capability.', reference, [widgetLocation(targetPublicNode)]))
			return absent()
		}
		if (!targetDefinition.methods.has(operation.name)) {
			finalIssues.push(dependencyIssue(ownerPublicNode, member, `Dependency target has no method "${operation.name}".`, reference, [widgetLocation(targetPublicNode)]))
			return absent()
		}
		const key = edgeKey(member.type, ownerNodeId, member.name, 'method', targetNodeId, operation.name)
		if (!edges.has(key))
			edges.set(key, { fromKind: member.type, fromNodeId: ownerNodeId, fromName: member.name, toKind: 'method', toNodeId: targetNodeId, toName: operation.name, reference })
	}

	return {
		[compiledDependencyBrand]: true,
		status: 'resolved',
		targetNodeId,
		reference,
		refinements,
	}
}

export function resolveDependencies(
	nodes: readonly WorkingNode[],
	semanticOrder: readonly InternalNodeId[],
	rootNodeId: InternalNodeId,
	nodeIdsByWidgetId: ReadonlyMap<WidgetId, readonly InternalNodeId[]>,
	navigator: Navigator,
	finalIssues: BlueprintIssue[],
): DependencyResolutionResult {
	const edges = new Map<string, GraphEdge>()
	const directWriteSeeds = new Set<string>()

	const resolve = (ownerNodeId: InternalNodeId, member: BlueprintDependencyMember, leaf: AnyDepExpression): CompiledDependency =>
		resolveLeaf(nodes, nodeIdsByWidgetId, rootNodeId, ownerNodeId, member, leaf, finalIssues, edges, directWriteSeeds)

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
			const dep = createDependencyBuilder<never, 'property'>()

			// A present callback returning `undefined`/`null` (only reachable via a JS/`any` contract
			// escape) is malformed callback output, not the same as the callback being omitted; only an
			// *omitted* callback synthesizes empty deps. `walkDeps` already throws on any non-expression,
			// non-container value (including `null`/`undefined`), so a present callback's result is
			// always routed through it unmodified.
			let rawDeps: unknown = {}
			if (propertyDefinition.registerDeps !== undefined) {
				rawDeps = propertyDefinition.registerDeps({
					widget: node.publicNode,
					blueprint: navigator,
					dep,
					...configFrag,
				})
				assertSyncValue(rawDeps, `Property "${name}"'s registerDeps`)
			}

			const member: BlueprintDependencyMember = { type: 'property', name }
			const deps = walkDeps(rawDeps, leaf => resolve(nodeId, member, leaf))
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
			const dep = createDependencyBuilder<never, 'method'>()

			// Same "omitted vs malformed" distinction as the properties loop above.
			let rawDeps: unknown = {}
			if (methodDefinition.registerDeps !== undefined) {
				rawDeps = methodDefinition.registerDeps({
					widget: node.publicNode,
					blueprint: navigator,
					dep,
					...configFrag,
				})
				assertSyncValue(rawDeps, `Method "${name}"'s registerDeps`)
			}

			const member: BlueprintDependencyMember = { type: 'method', name }
			const deps = walkDeps(rawDeps, leaf => resolve(nodeId, member, leaf))
			node.methods.set(name, { name, definition: methodDefinition, deps, transitivelyWrites: false })
		}
	}

	return { edges, directWriteSeeds }
}
