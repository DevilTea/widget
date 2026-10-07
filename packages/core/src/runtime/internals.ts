/**
 * Framework-internal carrier attaching Runtime internals (the primitive registry + the disposal
 * context) to the public `WidgetSystemRuntime` object it is built from, mirroring
 * `internal/contract.ts`'s `blueprintInternals` carrier. Not part of the published Runtime contract.
 *
 * Exists solely so the dedicated `@deviltea/widget-core/inspection` subpath can read the primitives a
 * Runtime already built (to expose their retained inspection channels) and gate its own `subscribe()`
 * on Runtime disposal, without the ordinary Runtime contract itself ever exposing them.
 */

import type { CompiledBlueprint, InternalNodeId, WidgetSystemRuntime } from '../internal/contract'
import type { AnyWidgetPluginTuple } from '../plugin'
import type { RuntimeContext } from './context'
import type { PrimitiveRegistryEntry } from './deps'

export const runtimeInternals: unique symbol = Symbol('@deviltea/widget-core:runtime-internals')

export interface RuntimeInternals {
	readonly context: RuntimeContext
	/**
	 * Indexed by `InternalNodeId`, same universe as the owning Blueprint's compiled node array.
	 */
	readonly registry: ReadonlyMap<InternalNodeId, PrimitiveRegistryEntry>
	/**
	 * The compiled Blueprint this Runtime was built from (Core-owned pairing state).
	 */
	readonly compiled: CompiledBlueprint
	/**
	 * Core-owned exact Runtime-widget pairing: every RuntimeWidget this Runtime produced, keyed by identity.
	 */
	readonly nodeIdByRuntimeWidget: ReadonlyMap<object, InternalNodeId>
}

/**
 * Not generic over `Plugins`: the carried shape (registry + context) does not vary by plugin universe,
 * unlike `blueprintInternals`'s `CompiledBlueprint<Plugins>`.
 */
export interface RuntimeInternalsCarrier {
	readonly [runtimeInternals]: RuntimeInternals
}

/**
 * Provenance probe: true only for Runtimes produced by this loaded module instance.
 */
export function isCoreRuntime(value: unknown): boolean {
	if (typeof value !== 'object' || value === null)
		return false
	return (value as Partial<RuntimeInternalsCarrier>)[runtimeInternals] !== undefined
}

/**
 * Reads the internals carried by a Runtime produced by `createWidgetSystemRuntime`.
 */
export function readRuntimeInternals<Plugins extends AnyWidgetPluginTuple>(
	runtime: WidgetSystemRuntime<Plugins>,
): RuntimeInternals {
	const carrier = runtime as unknown as Partial<RuntimeInternalsCarrier>
	const internals = carrier[runtimeInternals]

	if (internals === undefined)
		throw new Error('The runtime was not produced by this widget core build.')

	return internals
}
