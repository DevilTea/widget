/**
 * Runtime factory.
 *
 * Builds an executable `WidgetSystemRuntime` from a valid Blueprint's compiled internals: initializes
 * state (override > default > null precedence, both validated through the same authoritative
 * `attemptSet`), materializes dependency callables, creates Property/Method primitives, assembles
 * RuntimeWidget objects and wires the deterministic aggregate.
 *
 * Normative contract: DevilTea/widget Discussion #12, Core composition architecture topic. Historical source (migrated): diagnostic #10 consolidated handoff §11 (Runtime creation/initialization pipeline).
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
import type { WidgetId, WidgetMemberKey } from '../types'
import type { PrimitiveRegistryEntry } from './deps'
import { readCompiledBlueprint } from '../internal/contract'
import { readWidgetPluginDefinition } from '../plugin'
import { createRuntimeAggregate } from './aggregate'
import { buildBlueprintView } from './blueprint-view'
import { createCallbackOwner, createRuntimeContext } from './context'
import { materializeDependencyTree } from './deps'
import { buildCallbackEventEmitter, createEventPrimitive } from './event'
import { runtimeInternals } from './internals'
import { createMethodPrimitive } from './method'
import { resolveStateOverrides } from './override'
import { createPropertyPrimitive } from './property'
import { createStatePrimitive, restoreInitialState } from './state'
import { assertSyncValue } from './sync'
import { buildRuntimeWidget } from './widget'

function defineOwnValue(record: Record<string, unknown>, key: string, value: unknown): void {
	Object.defineProperty(record, key, { value, enumerable: true, writable: true, configurable: true })
}

export function createWidgetSystemRuntime<Plugins extends AnyWidgetPluginTuple>(
	blueprint: ValidWidgetSystemBlueprint<Plugins>,
	options?: CreateWidgetSystemRuntimeOptions,
): WidgetSystemRuntime<Plugins> {
	const compiled: CompiledBlueprint<Plugins> = readCompiledBlueprint(blueprint)
	const context = createRuntimeContext()
	// A real restricted facade, not the full Blueprint object: `compute`/`execute` must not be able to
	// reach `createRuntime`/`recompile`/`diagnostics`/`system`/`source` through JS/`any`.
	const blueprintView = buildBlueprintView(blueprint)

	const registry = new Map<InternalNodeId, PrimitiveRegistryEntry & {
		state: Map<string, ReturnType<typeof createStatePrimitive>>
		properties: Map<string, ReturnType<typeof createPropertyPrimitive>>
		methods: Map<string, ReturnType<typeof createMethodPrimitive>>
		events: Map<string, ReturnType<typeof createEventPrimitive>>
	}>()

	function buildConfigFragmentFor(node: CompiledResolvedWidgetNode<Plugins>): () => Record<string, unknown> {
		const definition = readWidgetPluginDefinition(node.plugin)
		// One frozen fragment per node: callers spread it into their own context objects.
		const fragment: Record<string, unknown> = definition.config === null ? Object.freeze({}) : Object.freeze({ config: node.config })
		return () => fragment
	}

	// The override topology diagnostics (step 4) depend on no primitive, so they are resolved up front:
	// the live diagnostic aggregate (step 8) has to exist before the primitives that report into it.
	const overrideResolution = resolveStateOverrides(compiled, options?.overrideStateDefaults)
	const aggregate = createRuntimeAggregate(context, compiled, registry, overrideResolution.runtimeLevelDiagnostics)
	// One commit hook per widget, shared by all of its primitives.
	const commitHooks: Array<() => void> = []

	// 1. Runtime/widget indexes + 2. create all states (null + empty diagnostic snapshot).
	for (let nodeId = 0; nodeId < compiled.nodes.length; nodeId++) {
		const node = compiled.nodes[nodeId]
		if (node === undefined || !node.resolved)
			continue

		const entry = {
			state: new Map<string, ReturnType<typeof createStatePrimitive>>(),
			properties: new Map<string, ReturnType<typeof createPropertyPrimitive>>(),
			methods: new Map<string, ReturnType<typeof createMethodPrimitive>>(),
			events: new Map<string, ReturnType<typeof createEventPrimitive>>(),
		}
		registry.set(nodeId, entry)

		const definition = readWidgetPluginDefinition(node.plugin)
		if (definition.events !== null) {
			for (const name of definition.events.keys())
				entry.events.set(name, createEventPrimitive(context))
		}

		const buildConfigFragment = buildConfigFragmentFor(node)
		const onDiagnosticsCommitted = aggregate.commitHookFor(nodeId)
		commitHooks[nodeId] = onDiagnosticsCommitted

		for (const [key, member] of node.state) {
			const primitive = createStatePrimitive(context, {
				widgetId: node.id,
				key,
				definition: member.definition,
				buildConfigFragment,
				onDiagnosticsCommitted,
			})
			entry.state.set(key, primitive)
		}
	}

	// 3. Apply override/default precedence through authoritative validation (4. the override topology
	// runtime-level diagnostics were collected above).
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
				candidate = member.definition.default({ ...buildConfigFragment() })
				assertSyncValue(candidate, `State "${key}"'s default`)
				hasCandidate = true
			}

			if (hasCandidate)
				primitive.internal.attemptSet(candidate)
			primitive.internal.captureInitial()
		}
	}

	// 5. Materialize compiled dependency callables + 6. create property computed/diagnostics +
	// 7. create method wrappers.
	for (let nodeId = 0; nodeId < compiled.nodes.length; nodeId++) {
		const node = compiled.nodes[nodeId]
		if (node === undefined || !node.resolved)
			continue

		const entry = registry.get(nodeId)
		if (entry === undefined)
			continue

		const buildConfigFragment = buildConfigFragmentFor(node)
		const onDiagnosticsCommitted = commitHooks[nodeId]!
		const definition = readWidgetPluginDefinition(node.plugin)
		const emitter = definition.events === null ? null : buildCallbackEventEmitter(context, entry.events)
		const emitFragment: Readonly<Record<string, unknown>> = emitter === null
			? Object.freeze({})
			: Object.freeze({ emit: emitter })

		for (const [name, member] of node.properties) {
			const owner = createCallbackOwner(null)
			const deps = materializeDependencyTree(member.deps, {
				consumer: 'property',
				ownerWidgetId: node.id,
				ownerName: name,
				registry,
				nodes: compiled.nodes,
				context,
				owner,
			})

			const primitive = createPropertyPrimitive(context, {
				widgetId: node.id,
				name,
				definition: member.definition,
				buildConfigFragment,
				selfNode: node.publicNode,
				blueprintView,
				deps,
				owner,
				onDiagnosticsCommitted,
			})
			entry.properties.set(name, primitive)
		}

		for (const [name, member] of node.methods) {
			const owner = createCallbackOwner(emitter)
			const deps = materializeDependencyTree(member.deps, {
				consumer: 'method',
				ownerWidgetId: node.id,
				ownerName: name,
				registry,
				nodes: compiled.nodes,
				context,
				owner,
			})

			const primitive = createMethodPrimitive(context, {
				widgetId: node.id,
				name,
				definition: member.definition,
				buildConfigFragment,
				selfNode: node.publicNode,
				blueprintView,
				deps,
				emitFragment,
				owner,
				onDiagnosticsCommitted,
			})
			entry.methods.set(name, primitive)
		}
	}

	// 8. Build the RuntimeWidgets (the live Runtime-level diagnostic aggregate was created up front).
	const runtimeWidgetsByNodeId = new Map<InternalNodeId, unknown>()
	const nodeIdByRuntimeWidget = new Map<object, InternalNodeId>()
	for (const [nodeId, entry] of registry) {
		const node = compiled.nodes[nodeId]
		if (node === undefined || !node.resolved)
			continue
		const runtimeWidget = buildRuntimeWidget(context, node, entry)
		runtimeWidgetsByNodeId.set(nodeId, runtimeWidget)
		nodeIdByRuntimeWidget.set(runtimeWidget as object, nodeId)
	}

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

	function resetState(): void {
		restoreInitialState(context, registry.values())
	}

	function snapshotState(): Record<WidgetId, Record<WidgetMemberKey, unknown>> {
		context.assertActive()
		// Plain objects owned by the caller. Keys are arbitrary strings (`__proto__` included), so they are
		// defined as own data properties instead of assigned.
		const snapshot: Record<WidgetId, Record<WidgetMemberKey, unknown>> = {}
		for (const nodeId of compiled.semanticOrder) {
			const node = compiled.nodes[nodeId]
			const entry = registry.get(nodeId)
			if (node === undefined || !node.resolved || entry === undefined)
				continue

			let values: Record<WidgetMemberKey, unknown> | null = null
			for (const [key, primitive] of entry.state) {
				const value = primitive.internal.get()
				if (value !== null)
					defineOwnValue(values ??= {}, key, value)
			}
			if (values !== null)
				defineOwnValue(snapshot, node.id, values)
		}
		return snapshot
	}

	// 9. Finalize Runtime.
	const runtime = {
		blueprint,
		get isDisposed() {
			return context.isDisposed()
		},
		getWidget,
		resetState,
		snapshotState,
		getDiagnostics: aggregate.getDiagnostics,
		subscribeDiagnostics: aggregate.subscribeDiagnostics,
		dispose: () => context.dispose(),
	}

	// Attaches the framework-internal carrier the dedicated `@deviltea/widget-core/inspection` subpath
	// reads (registry + disposal context); not part of the published Runtime contract.
	;(runtime as unknown as Record<PropertyKey, unknown>)[runtimeInternals] = { context, registry, compiled, nodeIdByRuntimeWidget }

	return runtime as unknown as WidgetSystemRuntime<Plugins>
}
