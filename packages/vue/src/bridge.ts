/**
 * Lazy Runtime -> Vue value/callable bridge primitives.
 *
 * Normative source: issue #13 checkpoint C/F/G. The Runtime is the sole source of truth: every ref
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
 * Collision-safe lazy keyed surface: `materialize` runs at most once per accessed key (including
 * `__proto__` / `constructor`), and the returned Proxy caches the result by identity so repeated
 * access returns the exact same member wrapper. Keys with no backing Runtime member materialize to
 * `undefined` without being cached, matching plain-object "unknown property" behavior.
 */
export function createLazyKeyedSurface<T>(materialize: (key: string) => T | undefined): Readonly<Record<string, T>> {
	const cache = new Map<string, T>()

	return new Proxy(Object.create(null), {
		get(_target, key) {
			if (typeof key !== 'string')
				return undefined

			const cached = cache.get(key)
			if (cached !== undefined)
				return cached

			const value = materialize(key)
			if (value !== undefined)
				cache.set(key, value)

			return value
		},
		has(_target, key) {
			return typeof key === 'string'
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
			if (!result.success)
				trigger()
		},
	}))
}

/**
 * Readonly `Ref<T | null>` projection of a `RuntimeProperty`. `ExecutionResult.success(value)`
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
			return result.success ? result.value : null
		},
		set() {
			throw new WidgetVueIntegrationError('This Vue projection is read-only: properties cannot be written through `useProperties()`.')
		},
	}))
}

/**
 * Readonly `Ref<readonly Issue[]>` projection shared by every `getIssues()` / `subscribeIssues()`
 * channel (state member, property member, method member, and the widget-level aggregate). Snapshot
 * objects/order are forwarded exactly as `@deviltea/widget-core` produced them.
 */
export function createIssuesRef<Issue>(
	getIssues: () => readonly Issue[],
	subscribeIssues: (listener: (issues: readonly Issue[]) => void) => () => void,
	registerCleanup: RegisterCleanup,
): Ref<readonly Issue[]> {
	let activated = false

	return customRef<readonly Issue[]>((track, trigger) => ({
		get() {
			if (!activated) {
				activated = true
				registerCleanup(subscribeIssues(() => trigger()))
			}
			track()
			return getIssues()
		},
		set() {
			throw new WidgetVueIntegrationError('This Vue projection is read-only: issue snapshots cannot be written.')
		},
	}))
}

/**
 * Stable callable wrapper over a `RuntimeMethod`. Semantic success projects to its value; semantic
 * failure projects to `null`. Implementation-contract exceptions and disposed-runtime errors propagate
 * unchanged — this wrapper never catches them. No subscription, no ref: methods are not reactive
 * values.
 */
export function createMethodWrapper(method: RuntimeMethodLike): (...args: readonly unknown[]) => unknown {
	return (...args: readonly unknown[]) => {
		const result = method(...args)
		return result.success ? result.value : null
	}
}
