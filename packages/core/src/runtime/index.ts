/**
 * Runtime factory.
 *
 * Builds an executable `WidgetSystemRuntime` from a valid Blueprint's compiled internals: initializes
 * state (override > default > null precedence, both validated through the same authoritative
 * `attemptSet`), materializes dependency callables, creates Property/Method primitives, assembles
 * RuntimeWidget objects and wires the deterministic aggregate.
 *
 * Normative source: issue #10 consolidated handoff §11 (Runtime creation/initialization pipeline).
 */

import type {
	CompiledBlueprint,
	CompiledResolvedWidgetNode,
	CreateWidgetSystemRuntimeOptions,
	InternalNodeId,
	ValidWidgetSystemBlueprint,
	WidgetSystemRuntime,
} from '../internal/contract'
import type { AnyWidgetPluginTuple } from '../plugin'
import type { WidgetId } from '../types'
import type { PrimitiveRegistryEntry } from './deps'
import { readCompiledBlueprint } from '../internal/contract'
import { readWidgetPluginDefinition } from '../plugin'
import { createRuntimeAggregate } from './aggregate'
import { createRuntimeContext } from './context'
import { materializeDependencyTree } from './deps'
import { createMethodPrimitive } from './method'
import { resolveStateOverrides } from './override'
import { createPropertyPrimitive } from './property'
import { createStatePrimitive } from './state'
import { buildRuntimeWidget } from './widget'

export function createWidgetSystemRuntime<Plugins extends AnyWidgetPluginTuple>(
	blueprint: ValidWidgetSystemBlueprint<Plugins>,
	options?: CreateWidgetSystemRuntimeOptions,
): WidgetSystemRuntime<Plugins> {
	const compiled: CompiledBlueprint<Plugins> = readCompiledBlueprint(blueprint)
	const context = createRuntimeContext()

	const registry = new Map<InternalNodeId, PrimitiveRegistryEntry & {
		state: Map<string, ReturnType<typeof createStatePrimitive>>
		properties: Map<string, ReturnType<typeof createPropertyPrimitive>>
		methods: Map<string, ReturnType<typeof createMethodPrimitive>>
	}>()

	function buildConfigFragmentFor(node: CompiledResolvedWidgetNode<Plugins>): () => Record<string, unknown> {
		const definition = readWidgetPluginDefinition(node.plugin)
		if (definition.config === null)
			return () => ({})
		return () => ({ config: node.config })
	}

	// 1. Runtime/widget indexes + 2. create all states (null + empty issue snapshot).
	for (let nodeId = 0; nodeId < compiled.nodes.length; nodeId++) {
		const node = compiled.nodes[nodeId]
		if (node === undefined || !node.resolved)
			continue

		const entry = {
			state: new Map<string, ReturnType<typeof createStatePrimitive>>(),
			properties: new Map<string, ReturnType<typeof createPropertyPrimitive>>(),
			methods: new Map<string, ReturnType<typeof createMethodPrimitive>>(),
		}
		registry.set(nodeId, entry)

		const buildConfigFragment = buildConfigFragmentFor(node)

		for (const [key, member] of node.state) {
			const primitive = createStatePrimitive(context, {
				widgetId: node.id,
				key,
				definition: member.definition,
				buildConfigFragment,
			})
			entry.state.set(key, primitive)
		}
	}

	// 3. Apply override/default precedence through authoritative validation +
	// 4. collect override topology runtime-level issues.
	const overrideResolution = resolveStateOverrides(compiled, options?.overrideStateDefaults)

	for (let nodeId = 0; nodeId < compiled.nodes.length; nodeId++) {
		const node = compiled.nodes[nodeId]
		if (node === undefined || !node.resolved)
			continue

		const entry = registry.get(nodeId)
		if (entry === undefined)
			continue

		const buildConfigFragment = buildConfigFragmentFor(node)
		const overrides = overrideResolution.candidatesByNodeId.get(nodeId)

		for (const [key, member] of node.state) {
			const primitive = entry.state.get(key)
			if (primitive === undefined)
				continue

			let hasCandidate = false
			let candidate: unknown

			if (overrides?.has(key)) {
				candidate = overrides.get(key)
				hasCandidate = true
			}
			else if (member.definition.default) {
				candidate = member.definition.default(buildConfigFragment())
				hasCandidate = true
			}

			if (hasCandidate)
				primitive.internal.attemptSet(candidate)
		}
	}

	// 5. Materialize compiled dependency callables + 6. create property computed/issues +
	// 7. create method wrappers.
	for (let nodeId = 0; nodeId < compiled.nodes.length; nodeId++) {
		const node = compiled.nodes[nodeId]
		if (node === undefined || !node.resolved)
			continue

		const entry = registry.get(nodeId)
		if (entry === undefined)
			continue

		const buildConfigFragment = buildConfigFragmentFor(node)

		for (const [name, member] of node.properties) {
			const deps = materializeDependencyTree(member.deps, {
				consumer: 'property',
				ownerWidgetId: node.id,
				ownerName: name,
				registry,
				nodes: compiled.nodes,
				context,
			})

			const primitive = createPropertyPrimitive(context, {
				widgetId: node.id,
				name,
				definition: member.definition,
				buildConfigFragment,
				selfNode: node.publicNode,
				blueprintView: blueprint,
				deps,
			})
			entry.properties.set(name, primitive)
		}

		for (const [name, member] of node.methods) {
			const deps = materializeDependencyTree(member.deps, {
				consumer: 'method',
				ownerWidgetId: node.id,
				ownerName: name,
				registry,
				nodes: compiled.nodes,
				context,
			})

			const primitive = createMethodPrimitive(context, {
				widgetId: node.id,
				name,
				definition: member.definition,
				buildConfigFragment,
				selfNode: node.publicNode,
				blueprintView: blueprint,
				deps,
			})
			entry.methods.set(name, primitive)
		}
	}

	// 8. Build collected-issue aggregate.
	const runtimeWidgetsByNodeId = new Map<InternalNodeId, unknown>()
	for (const [nodeId, entry] of registry) {
		const node = compiled.nodes[nodeId]
		if (node === undefined || !node.resolved)
			continue
		runtimeWidgetsByNodeId.set(nodeId, buildRuntimeWidget(node, entry))
	}

	const aggregate = createRuntimeAggregate(context, compiled, registry, overrideResolution.runtimeLevelIssues)

	function getWidget(id: WidgetId): unknown {
		context.assertActive()
		const publicNode = blueprint.getWidget(id)
		if (publicNode === null)
			return null

		const nodeId = compiled.nodeIdByPublicNode.get(publicNode)
		if (nodeId === undefined)
			return null

		return runtimeWidgetsByNodeId.get(nodeId) ?? null
	}

	// 9. Finalize Runtime.
	const runtime = {
		blueprint,
		get isDisposed() {
			return context.isDisposed()
		},
		getWidget,
		getIssues: aggregate.getIssues,
		getCollectedIssues: aggregate.getCollectedIssues,
		subscribeCollectedIssues: aggregate.subscribeCollectedIssues,
		dispose: () => context.dispose(),
	}

	return runtime as unknown as WidgetSystemRuntime<Plugins>
}
