/**
 * `inspectRuntime()` — Runtime-side readonly inspection projection.
 *
 * Every retained fact this module exposes is published by the normal semantic pipeline at its
 * fact-commit point (`../runtime/state.ts`'s `attemptSet`, `../runtime/property.ts`'s computed body) —
 * never reconstructed here, never activated here. `getWidget`/`getState`/`getProperty`/`getSnapshot` are
 * passive reads that must stay usable after Runtime disposal (post-mortem inspection); only `subscribe()`
 * is gated on disposal, by design (issue #10 amendment "readonly inspection subscription and disposal
 * semantics") — this module deliberately does not call the generic live-operation disposed guard from
 * any other path.
 *
 * Normative source: issue #10 amendment "inspection exact API v1 (part 2: Runtime inspection,
 * materialization, disposal, conformance)".
 */

import type { InternalNodeId, WidgetSystemRuntime } from '../internal/contract'
import type { AnyWidgetPluginTuple } from '../plugin'
import type { RuntimeContext } from '../runtime/context'
import type { PrimitiveRegistryEntry } from '../runtime/deps'
import type { PropertyPrimitive } from '../runtime/property'
import type { StatePrimitive } from '../runtime/state'
import type { WidgetMemberKey } from '../types'
import type {
	InspectionNodeId,
	ResolvedBlueprintInspectionNode,
	RuntimeInspection,
	RuntimePropertyInspection,
	RuntimePropertyInspectionSnapshot,
	RuntimeStateInspection,
	RuntimeStateInspectionSnapshot,
	RuntimeWidgetInspection,
} from './types'
import { readRuntimeInternals } from '../runtime/internals'
import { inspectBlueprint } from './blueprint'

function buildStateInspection(context: RuntimeContext, primitive: StatePrimitive): RuntimeStateInspection<unknown> {
	return Object.freeze({
		getSnapshot: (): RuntimeStateInspectionSnapshot<unknown> => primitive.internal.inspection.getSnapshot(),
		subscribe: (listener: (snapshot: RuntimeStateInspectionSnapshot<unknown>) => void) => {
			// The one inspection operation that *is* gated on disposal (issue #10 amendment): a brand new
			// subscription after `dispose()` throws `WidgetSystemRuntimeDisposedError`, while every passive
			// read stays available post-mortem.
			context.assertActive()
			const rawUnsubscribe = primitive.internal.inspection.subscribe(listener)
			return context.registerSubscription(rawUnsubscribe)
		},
	})
}

function buildPropertyInspection(context: RuntimeContext, primitive: PropertyPrimitive): RuntimePropertyInspection<unknown> {
	return Object.freeze({
		getSnapshot: (): RuntimePropertyInspectionSnapshot<unknown> => primitive.internal.inspection.getSnapshot(),
		subscribe: (listener: (snapshot: RuntimePropertyInspectionSnapshot<unknown>) => void) => {
			context.assertActive()
			const rawUnsubscribe = primitive.internal.inspection.subscribe(listener)
			return context.registerSubscription(rawUnsubscribe)
		},
	})
}

function buildRuntimeWidgetInspection<Plugins extends AnyWidgetPluginTuple>(
	context: RuntimeContext,
	nodeId: InspectionNodeId,
	blueprintNode: ResolvedBlueprintInspectionNode<Plugins>,
	entry: PrimitiveRegistryEntry,
): RuntimeWidgetInspection<Plugins> {
	// Lazily-materialized, per-widget facade caches (issue #10: "Inspection facades ... may be
	// materialized lazily"). Owned entirely by this widget inspection closure — not a global registry —
	// so they are reclaimed together with the owning Runtime/RuntimeInspection.
	const stateFacades = new Map<WidgetMemberKey, RuntimeStateInspection<unknown>>()
	const propertyFacades = new Map<WidgetMemberKey, RuntimePropertyInspection<unknown>>()

	function getState(key: WidgetMemberKey): RuntimeStateInspection<unknown> | null {
		const primitive = entry.state.get(key)
		if (primitive === undefined)
			return null

		let facade = stateFacades.get(key)
		if (facade === undefined) {
			facade = buildStateInspection(context, primitive)
			stateFacades.set(key, facade)
		}
		return facade
	}

	function getProperty(name: WidgetMemberKey): RuntimePropertyInspection<unknown> | null {
		const primitive = entry.properties.get(name)
		if (primitive === undefined)
			return null

		let facade = propertyFacades.get(name)
		if (facade === undefined) {
			facade = buildPropertyInspection(context, primitive)
			propertyFacades.set(name, facade)
		}
		return facade
	}

	return Object.freeze({
		nodeId,
		blueprintNode,
		getState,
		getProperty,
	})
}

function buildRuntimeInspection<Plugins extends AnyWidgetPluginTuple>(
	runtime: WidgetSystemRuntime<Plugins>,
): RuntimeInspection<Plugins> {
	const { context, registry } = readRuntimeInternals(runtime)
	// Identity composition (issue #10, already locked): `inspectRuntime(runtime).blueprint ===
	// inspectBlueprint(runtime.blueprint)` falls out for free because both share `inspectBlueprint`'s own
	// per-Blueprint cache.
	const blueprintInspection = inspectBlueprint(runtime.blueprint)

	const widgetInspections = new Map<InspectionNodeId, RuntimeWidgetInspection<Plugins>>()

	function getWidget(nodeId: InspectionNodeId): RuntimeWidgetInspection<Plugins> | null {
		const cached = widgetInspections.get(nodeId)
		if (cached !== undefined)
			return cached

		const blueprintNode = blueprintInspection.getNode(nodeId)
		// A Runtime's Blueprint is always valid, hence every one of its nodes is resolved; the `!resolved`
		// branch only guards a forged/foreign id defensively and is not otherwise reachable.
		if (blueprintNode === null || !blueprintNode.resolved)
			return null

		const entry = registry.get(nodeId as unknown as InternalNodeId)
		if (entry === undefined)
			return null

		const built = buildRuntimeWidgetInspection(context, nodeId, blueprintNode, entry)
		widgetInspections.set(nodeId, built)
		return built
	}

	return Object.freeze({
		blueprint: blueprintInspection,
		getWidget,
	})
}

const runtimeInspectionCache = new WeakMap<WidgetSystemRuntime<any>, RuntimeInspection<any>>()

/**
 * Returns the readonly Runtime inspection facade for `runtime`, cached (weak, no global strong
 * retention) so `inspectRuntime(runtime) === inspectRuntime(runtime)`. Explicitly allowed — and returns
 * the facade over already-retained facts — even when called for the first time after `runtime.dispose()`
 * (post-mortem inspection).
 */
export function inspectRuntime<Plugins extends AnyWidgetPluginTuple = AnyWidgetPluginTuple>(
	runtime: WidgetSystemRuntime<Plugins>,
): RuntimeInspection<Plugins> {
	const cached = runtimeInspectionCache.get(runtime)
	if (cached !== undefined)
		return cached as RuntimeInspection<Plugins>

	const built = buildRuntimeInspection(runtime)
	runtimeInspectionCache.set(runtime, built)
	return built
}
