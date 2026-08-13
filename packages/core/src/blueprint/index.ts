/**
 * Blueprint compilation entry.
 *
 * Runs the full compile pipeline of issue #10's consolidated handoff §10 (recovery -> identity ->
 * config -> semantic slots -> definition diagnostics -> structure validation -> dependency
 * registration/resolution -> write-effect/purity/cycle analysis -> finalize) and returns a public
 * `ValidWidgetSystemBlueprint` or `InvalidWidgetSystemBlueprint`, carrying the compiled internal model
 * under the `blueprintInternals` symbol for the Runtime unit (U3) to read.
 */

import type {
	BlueprintWidgetNode,
	CompiledBlueprint,
	CompiledWidgetNode,
	InternalNodeId,
	InvalidWidgetSystemBlueprint,
	ResolvedBlueprintWidgetNode,
	ValidWidgetSystemBlueprint,
	WidgetLocation,
	WidgetSystemBlueprint,
	WidgetSystemBlueprintStatus,
} from '../internal/contract'
import type { BlueprintIssue } from '../issue'
import type { AnyWidgetPluginTuple } from '../plugin'
import type { WidgetSystem } from '../system'
import type { WidgetId, WidgetMemberKey } from '../types'
import type { WorkingNode } from './recovery'
import { blueprintInternals } from '../internal/contract'
import { EMPTY_ISSUES } from '../issue'
import { createWidgetSystemRuntime } from '../runtime/index'
import { resolveDependencies } from './deps'
import { runGraphAnalysis } from './graph'
import { computeSemanticOrder, recoverBlueprint } from './recovery'
import { runStructureValidation } from './structure'
import { createNavigator } from './view'

function finalizeIssuesByNode(
	nodeIdByPublicNode: ReadonlyMap<BlueprintWidgetNode, InternalNodeId>,
	finalIssues: readonly BlueprintIssue[],
	issuesByNode: Map<InternalNodeId, BlueprintIssue[]>,
): void {
	for (const issue of finalIssues) {
		const node = (issue.source as { node: BlueprintWidgetNode }).node
		const nodeId = nodeIdByPublicNode.get(node)
		if (nodeId === undefined)
			continue

		const list = issuesByNode.get(nodeId)
		if (list === undefined)
			issuesByNode.set(nodeId, [issue])
		else
			list.push(issue)
	}
}

function buildCompiledNodes(nodes: readonly WorkingNode[], issuesByNode: ReadonlyMap<InternalNodeId, BlueprintIssue[]>): CompiledWidgetNode[] {
	return nodes.map((node): CompiledWidgetNode => {
		const issues = issuesByNode.get(node.nodeId) ?? (EMPTY_ISSUES as readonly BlueprintIssue[])
		const base = {
			nodeId: node.nodeId,
			publicNode: node.publicNode,
			rawDefinition: node.rawDefinition,
			parentNodeId: node.parentNodeId,
			location: node.location,
			rawSlots: Object.freeze(node.rawSlots),
			issues,
		}

		if (!node.resolved)
			return { ...base, resolved: false, id: node.id }

		return {
			...base,
			resolved: true,
			id: node.id!,
			type: node.type!,
			plugin: node.plugin!,
			rawConfig: node.rawConfig,
			config: node.config,
			semanticSlots: node.semanticSlots,
			state: node.state,
			properties: node.properties,
			methods: node.methods,
		}
	})
}

export function compileBlueprint<Plugins extends AnyWidgetPluginTuple>(
	system: WidgetSystem<Plugins>,
	definition: unknown,
): WidgetSystemBlueprint<Plugins> {
	const recovery = recoverBlueprint(system, definition)
	const { nodes, rootNodeId, nodeIdByPublicNode, nodeIdsByWidgetId, finalIssues, issuesByNode } = recovery

	const semanticOrder = computeSemanticOrder(nodes, rootNodeId)
	const navigator = createNavigator<Plugins>(nodes, nodeIdByPublicNode, nodeIdsByWidgetId, rootNodeId)

	runStructureValidation(system as unknown as WidgetSystem<AnyWidgetPluginTuple>, nodes, semanticOrder, nodeIdByPublicNode, navigator, finalIssues)

	const { edges, directWriteSeeds } = resolveDependencies(nodes, semanticOrder, rootNodeId, nodeIdsByWidgetId, navigator, finalIssues)

	const analysis = runGraphAnalysis(nodes, semanticOrder, edges, directWriteSeeds, finalIssues)

	finalizeIssuesByNode(nodeIdByPublicNode, finalIssues, issuesByNode)
	Object.freeze(finalIssues)

	const status: WidgetSystemBlueprintStatus = finalIssues.length === 0 ? 'valid' : 'invalid'
	const compiledNodes = buildCompiledNodes(nodes, issuesByNode)

	const compiled: CompiledBlueprint<Plugins> = {
		system,
		rawDefinition: definition,
		status,
		rootNodeId,
		nodes: compiledNodes as readonly CompiledWidgetNode<Plugins>[],
		nodeIdByPublicNode,
		nodeIdsByWidgetId,
		semanticOrder,
		issues: finalIssues,
		analysis,
	}

	if (status === 'valid') {
		const validNavigator = navigator as unknown as {
			root: ResolvedBlueprintWidgetNode<Plugins>
			getWidget: (id: WidgetId) => ResolvedBlueprintWidgetNode<Plugins> | null
			getParent: (node: BlueprintWidgetNode<Plugins>) => ResolvedBlueprintWidgetNode<Plugins> | null
			getLocation: (node: BlueprintWidgetNode<Plugins>) => WidgetLocation<Plugins> | null
			getChildren: (node: BlueprintWidgetNode<Plugins>) => readonly ResolvedBlueprintWidgetNode<Plugins>[]
			getChildrenAt: (node: BlueprintWidgetNode<Plugins>, slot: WidgetMemberKey) => readonly ResolvedBlueprintWidgetNode<Plugins>[]
		}

		const blueprint: ValidWidgetSystemBlueprint<Plugins> = {
			system,
			rawDefinition: definition,
			status: 'valid',
			root: validNavigator.root,
			getWidget: validNavigator.getWidget,
			getParent: validNavigator.getParent,
			getLocation: validNavigator.getLocation,
			getChildren: validNavigator.getChildren,
			getChildrenAt: validNavigator.getChildrenAt,
			getCollectedIssues: () => EMPTY_ISSUES,
			recompile: next => system.createBlueprint(next),
			createRuntime: options => createWidgetSystemRuntime(blueprint, options),
		}

		return attachInternalsAndFreeze(blueprint, compiled)
	}

	// The finalized (non-compile-time) Blueprint surface exposes full nodes (with `getIssues()`); the
	// Navigator/BlueprintCompileView type is intentionally narrower (COMMENT: compile-view contract), so
	// this reinterprets the same underlying navigation functions/objects under the finalized shape.
	const invalidNavigator = navigator as unknown as {
		root: BlueprintWidgetNode<Plugins>
		getWidget: (id: WidgetId) => BlueprintWidgetNode<Plugins> | null
		getParent: (node: BlueprintWidgetNode<Plugins>) => BlueprintWidgetNode<Plugins> | null
		getLocation: (node: BlueprintWidgetNode<Plugins>) => WidgetLocation<Plugins> | null
		getChildren: (node: BlueprintWidgetNode<Plugins>) => readonly BlueprintWidgetNode<Plugins>[]
		getChildrenAt: (node: BlueprintWidgetNode<Plugins>, slot: WidgetMemberKey) => readonly BlueprintWidgetNode<Plugins>[]
	}

	const blueprint: InvalidWidgetSystemBlueprint<Plugins> = {
		system,
		rawDefinition: definition,
		status: 'invalid',
		root: invalidNavigator.root,
		getWidget: invalidNavigator.getWidget,
		getParent: invalidNavigator.getParent,
		getLocation: invalidNavigator.getLocation,
		getChildren: invalidNavigator.getChildren,
		getChildrenAt: invalidNavigator.getChildrenAt,
		getCollectedIssues: () => finalIssues,
		recompile: next => system.createBlueprint(next),
	}

	return attachInternalsAndFreeze(blueprint, compiled)
}

/**
 * Attaches the compiled internal model under the private `blueprintInternals` symbol (not part of the
 * published Blueprint contract) and freezes the public Blueprint object.
 */
function attachInternalsAndFreeze<Plugins extends AnyWidgetPluginTuple, Blueprint extends WidgetSystemBlueprint<Plugins>>(
	blueprint: Blueprint,
	compiled: CompiledBlueprint<Plugins>,
): Blueprint {
	;(blueprint as unknown as Record<PropertyKey, unknown>)[blueprintInternals] = compiled
	return Object.freeze(blueprint)
}
