/**
 * Lazy Runtime -> Vue value/callable bridge primitives.
 *
 * Normative source: diagnostic #13 checkpoint C/F/G. The Runtime is the sole source of truth: every ref
 * created here is a `customRef` with no authoritative mirrored cache, activates its underlying Runtime
 * subscription only on first `.value` read, and every listener only calls `trigger()` — it never
 * writes a locally cached value. `.value` getters always re-read the Runtime directly.
 */

import type { Ref } from 'vue'
import type { RuntimeMethodLike, RuntimePropertyLike, RuntimeStateLike } from './context'
import { customRef } from 'vue'
import { WidgetVueIntegrationError } from './errors'

export type RegisterCleanup = (cleanup: () => void) => void

/**
 * Collision-safe lazy keyed surface over the Runtime's declared `members` (the Runtime's own keyed
 * surface object, the authoritative member inventory). `materialize` runs at most once per declared
 * key (including `__proto__` / `constructor`), and the returned Proxy caches the result by identity so
 * repeated access returns the exact same member wrapper. `get`, `in`, `Object.keys`, spread and
 * `toRefs` all reflect exactly the declared members: an undeclared key is `undefined` and absent from
 * `in`. Listing keys materializes nothing and never reads or subscribes the Runtime (spread reads
 * each member, which materializes its wrapper passively).
 */
export function createLazyKeyedSurface<T>(members: object, materialize: (key: string) => T | undefined): Readonly<Record<string, T>> {
	const cache = new Map<string, T>()
	const isDeclared = (key: string | symbol): key is string => typeof key === 'string' && Object.hasOwn(members, key)

	const getMember = (key: string): T | undefined => {
		const cached = cache.get(key)
		if (cached !== undefined)
			return cached

		const value = materialize(key)
		if (value !== undefined)
			cache.set(key, value)

		return value
	}

	return new Proxy(Object.create(null), {
		get(_target, key) {
			return isDeclared(key) ? getMember(key) : undefined
		},
		has(_target, key) {
			return isDeclared(key)
		},
		ownKeys() {
			return Object.keys(members)
		},
		getOwnPropertyDescriptor(_target, key) {
			if (!isDeclared(key))
				return undefined

			// A getter keeps `Object.keys` and friends from materializing anything: only reading the value
			// does. Reported configurable because the (empty) target has no such property.
			return { get: () => getMember(key), set: undefined, enumerable: true, configurable: true }
		},
	}) as Readonly<Record<string, T>>
}

/**
 * Writable `Ref<T | null>` projection of a `RuntimeState`. Rejection explicitly `trigger()`s so
 * consumers (in particular `v-model`) re-read the authoritative Runtime value instead of keeping an
 * optimistically-assigned candidate.
 */
export function createStateRef(state: RuntimeStateLike, registerCleanup: RegisterCleanup): Ref<unknown> {
	let activated = false

	return customRef<unknown>((track, trigger) => ({
		get() {
			if (!activated) {
				activated = true
				registerCleanup(state.subscribe(() => trigger()))
			}
			track()
			return state.get()
		},
		set(candidate) {
			const result = state.set(candidate)
			if (!result.ok)
				trigger()
		},
	}))
}

/**
 * Readonly `Ref<T | null>` projection of a `RuntimeProperty`. `ExecutionResult.ok(value)`
 * projects to `value`; `failure` projects to `null` with no last-successful fallback.
 */
export function createPropertyRef(property: RuntimePropertyLike, registerCleanup: RegisterCleanup): Ref<unknown> {
	let activated = false

	return customRef<unknown>((track, trigger) => ({
		get() {
			if (!activated) {
				activated = true
				registerCleanup(property.subscribe(() => trigger()))
			}
			track()
			const result = property.get()
			return result.ok ? result.value : null
		},
		set() {
			throw new WidgetVueIntegrationError('readonly-projection-write', 'This Vue projection is read-only: properties cannot be written through `useProperties()`.')
		},
	}))
}

/**
 * Readonly `Ref<readonly Diagnostic[]>` projection shared by every `getDiagnostics()` / `subscribeDiagnostics()`
 * channel (state member, property member, method member, and the widget-level aggregate). Snapshot
 * objects/order are forwarded exactly as `@deviltea/widget-core` produced them.
 */
export function createDiagnosticsRef<Diagnostic>(
	getDiagnostics: () => readonly Diagnostic[],
	subscribeDiagnostics: (listener: (diagnostics: readonly Diagnostic[]) => void) => () => void,
	registerCleanup: RegisterCleanup,
): Ref<readonly Diagnostic[]> {
	let activated = false

	return customRef<readonly Diagnostic[]>((track, trigger) => ({
		get() {
			if (!activated) {
				activated = true
				registerCleanup(subscribeDiagnostics(() => trigger()))
			}
			track()
			return getDiagnostics()
		},
		set() {
			throw new WidgetVueIntegrationError('readonly-projection-write', 'This Vue projection is read-only: diagnostic snapshots cannot be written.')
		},
	}))
}

/**
 * Stable callable wrapper over a `RuntimeMethod`. Semantic ok projects to its value; semantic
 * failure projects to `null`. Implementation-contract exceptions and disposed-runtime errors propagate
 * unchanged — this wrapper never catches them. No subscription, no ref: methods are not reactive
 * values.
 */
export function createMethodWrapper(method: RuntimeMethodLike): (...args: readonly unknown[]) => unknown {
	return (...args: readonly unknown[]) => {
		const result = method(...args)
		return result.ok ? result.value : null
	}
}
