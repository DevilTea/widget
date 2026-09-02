/**
 * Blueprint compilation entry.
 *
 * Runs the full compile pipeline of diagnostic #10's consolidated handoff §10 (recovery -> identity ->
 * config -> semantic slots -> definition diagnostics -> structure validation -> dependency
 * registration/resolution -> write-effect/purity/cycle analysis -> finalize) and returns a public
 * `ValidWidgetSystemBlueprint` or `InvalidWidgetSystemBlueprint`, carrying the compiled internal model
 * under the `blueprintInternals` symbol for the Runtime unit (U3) to read.
 */

import type { BlueprintDiagnostic, BlueprintNodeDiagnostic } from '../diagnostic'
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
import type { JsonValue } from '../json'
import type { AnyWidgetPluginTuple } from '../plugin'
import type { WidgetSystem } from '../system'
import type { WidgetId, WidgetMemberKey } from '../types'
import type { WorkingNode } from './recovery'
import { EMPTY_DIAGNOSTICS } from '../diagnostic'
import { blueprintInternals } from '../internal/contract'
import { inspectJsonValue } from '../json'
import { freezeDiagnosticSnapshot } from '../runtime/diagnostics'
import { createWidgetSystemRuntime } from '../runtime/index'
import { resolveDependencies } from './deps'
import { runGraphAnalysis } from './graph'
import { computeSemanticOrder, recoverBlueprint } from './recovery'
import { runStructureValidation } from './structure'
import { createCompileFacade, createNavigator } from './view'

function finalizeDiagnosticsByNode(
	nodeIdByPublicNode: ReadonlyMap<BlueprintWidgetNode, InternalNodeId>,
	finalDiagnostics: readonly BlueprintDiagnostic[],
	diagnosticsByNode: Map<InternalNodeId, BlueprintNodeDiagnostic[]>,
): void {
	for (const diagnostic of finalDiagnostics) {
		if (diagnostic.code === 'json-incompatible-value' || diagnostic.code === 'source-access-failed')
			continue
		const node = diagnostic.location.node
		const nodeId = nodeIdByPublicNode.get(node)
		if (nodeId === undefined)
			continue

		const list = diagnosticsByNode.get(nodeId)
		if (list === undefined)
			diagnosticsByNode.set(nodeId, [diagnostic])
		else
			list.push(diagnostic)
	}
}

function buildCompiledNodes(nodes: readonly WorkingNode[], diagnosticsByNode: ReadonlyMap<InternalNodeId, BlueprintNodeDiagnostic[]>): CompiledWidgetNode[] {
	return nodes.map((node): CompiledWidgetNode => {
		const diagnostics = diagnosticsByNode.get(node.nodeId) ?? (EMPTY_DIAGNOSTICS as readonly BlueprintNodeDiagnostic[])
		const base = {
			nodeId: node.nodeId,
			publicNode: node.publicNode,
			source: node.source,
			parentNodeId: node.parentNodeId,
			location: node.location,
			rawSlots: Object.freeze(node.rawSlots),
			diagnostics,
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
	const { nodes, rootNodeId, nodeIdByPublicNode, nodeIdsByWidgetId, finalDiagnostics, diagnosticsByNode } = recovery
	const jsonInspection = inspectJsonValue(definition)
	const sourceJsonCompatible = jsonInspection.compatible
	finalDiagnostics.push(...jsonInspection.diagnostics)

	const semanticOrder = computeSemanticOrder(nodes, rootNodeId)
	// `navigator` (full public nodes) backs only the *finalized* Blueprint's own navigation methods
	// below. Compile-time callbacks (`validateStructure`, `registerDeps`) never see it directly — they
	// receive `compileFacade.view`, a genuinely restricted and frozen runtime facade, so a JS/`any`
	// callback cannot reach `getDiagnostics()` or corrupt the view for later callbacks in this compile pass.
	const navigator = createNavigator<Plugins>(nodes, nodeIdByPublicNode, nodeIdsByWidgetId, rootNodeId)
	const compileFacade = createCompileFacade<Plugins>(nodes, nodeIdByPublicNode, nodeIdsByWidgetId, rootNodeId)

	runStructureValidation(system as unknown as WidgetSystem<AnyWidgetPluginTuple>, nodes, semanticOrder, compileFacade, finalDiagnostics)

	const { edges, directWriteSeeds } = resolveDependencies(nodes, semanticOrder, rootNodeId, nodeIdsByWidgetId, compileFacade, finalDiagnostics)

	const analysis = runGraphAnalysis(nodes, semanticOrder, edges, directWriteSeeds, finalDiagnostics)

	finalizeDiagnosticsByNode(nodeIdByPublicNode, finalDiagnostics, diagnosticsByNode)

	// Blueprint diagnostics are an immutable compiled snapshot: freeze every per-node diagnostic array (the
	// same array `node.diagnostics` refers to) plus the aggregate array, deep-freezing each diagnostic and
	// its framework-owned structural fields exactly once (idempotent — the same diagnostic object commonly
	// appears in both places). Caller/plugin-owned Runtime payload values are left alone.
	for (const list of diagnosticsByNode.values())
		freezeDiagnosticSnapshot(list)
	freezeDiagnosticSnapshot(finalDiagnostics)
	for (const node of nodes) {
		const shell = node.publicNode as unknown as Record<string, unknown>
		shell.diagnostics = diagnosticsByNode.get(node.nodeId) ?? EMPTY_DIAGNOSTICS
		Object.freeze(shell)
	}

	const status: WidgetSystemBlueprintStatus = finalDiagnostics.length === 0 ? 'valid' : 'invalid'
	const canCreateRuntime = status === 'valid' && sourceJsonCompatible
	const compiledNodes = buildCompiledNodes(nodes, diagnosticsByNode)

	const compiled: CompiledBlueprint<Plugins> = {
		system,
		source: definition,
		sourceJsonCompatible,
		status: canCreateRuntime ? 'valid' : 'invalid',
		rootNodeId,
		nodes: compiledNodes as readonly CompiledWidgetNode<Plugins>[],
		nodeIdByPublicNode,
		nodeIdsByWidgetId,
		semanticOrder,
		diagnostics: finalDiagnostics,
		analysis,
	}

	if (canCreateRuntime) {
		const validNavigator = navigator as unknown as {
			root: ResolvedBlueprintWidgetNode<Plugins, JsonValue>
			getWidget: (id: WidgetId) => ResolvedBlueprintWidgetNode<Plugins, JsonValue> | null
			getParent: (node: BlueprintWidgetNode<Plugins>) => ResolvedBlueprintWidgetNode<Plugins, JsonValue> | null
			getLocation: (node: BlueprintWidgetNode<Plugins>) => WidgetLocation<Plugins, JsonValue> | null
			getChildren: (node: BlueprintWidgetNode<Plugins>) => readonly ResolvedBlueprintWidgetNode<Plugins, JsonValue>[]
			getChildrenAt: (node: BlueprintWidgetNode<Plugins>, slot: WidgetMemberKey) => readonly ResolvedBlueprintWidgetNode<Plugins, JsonValue>[]
		}

		const blueprint: ValidWidgetSystemBlueprint<Plugins> = {
			system,
			source: definition as JsonValue,
			sourceJsonCompatible: true,
			status: 'valid',
			root: validNavigator.root,
			getWidget: validNavigator.getWidget,
			getParent: validNavigator.getParent,
			getLocation: validNavigator.getLocation,
			getChildren: validNavigator.getChildren,
			getChildrenAt: validNavigator.getChildrenAt,
			diagnostics: EMPTY_DIAGNOSTICS,
			recompile: next => system.createBlueprint(next),
			createRuntime: options => createWidgetSystemRuntime(blueprint, options),
		}

		return attachInternalsAndFreeze(blueprint, compiled)
	}

	// The finalized (non-compile-time) Blueprint surface exposes full nodes (with `.diagnostics`); the
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

	if (sourceJsonCompatible) {
		const jsonInvalidNavigator = invalidNavigator as unknown as {
			root: BlueprintWidgetNode<Plugins, JsonValue>
			getWidget: (id: WidgetId) => BlueprintWidgetNode<Plugins, JsonValue> | null
			getParent: (node: BlueprintWidgetNode<Plugins>) => BlueprintWidgetNode<Plugins, JsonValue> | null
			getLocation: (node: BlueprintWidgetNode<Plugins>) => WidgetLocation<Plugins, JsonValue> | null
			getChildren: (node: BlueprintWidgetNode<Plugins>) => readonly BlueprintWidgetNode<Plugins, JsonValue>[]
			getChildrenAt: (node: BlueprintWidgetNode<Plugins>, slot: WidgetMemberKey) => readonly BlueprintWidgetNode<Plugins, JsonValue>[]
		}
		const blueprint: InvalidWidgetSystemBlueprint<Plugins, JsonValue, true> = {
			system,
			source: definition as JsonValue,
			sourceJsonCompatible: true,
			status: 'invalid',
			root: jsonInvalidNavigator.root,
			getWidget: jsonInvalidNavigator.getWidget,
			getParent: jsonInvalidNavigator.getParent,
			getLocation: jsonInvalidNavigator.getLocation,
			getChildren: jsonInvalidNavigator.getChildren,
			getChildrenAt: jsonInvalidNavigator.getChildrenAt,
			diagnostics: finalDiagnostics,
			recompile: next => system.createBlueprint(next),
		}

		return attachInternalsAndFreeze(blueprint, compiled)
	}

	const blueprint: InvalidWidgetSystemBlueprint<Plugins, unknown, false> = {
		system,
		source: definition,
		sourceJsonCompatible: false,
		status: 'invalid',
		root: invalidNavigator.root,
		getWidget: invalidNavigator.getWidget,
		getParent: invalidNavigator.getParent,
		getLocation: invalidNavigator.getLocation,
		getChildren: invalidNavigator.getChildren,
		getChildrenAt: invalidNavigator.getChildrenAt,
		diagnostics: finalDiagnostics,
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
