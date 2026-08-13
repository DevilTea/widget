/**
 * Thin `alien-signals@3.2.1` adapter.
 *
 * `alien-signals` owns dependency tracking, lazy computed, cache/stale state, invalidation and
 * batching/propagation. This module only adds the thin wrapper behavior issue #10 consolidated
 * handoff §17 (mirroring the amendment "Implementation verification — alien-signals@3.2.1
 * conformance") requires on top of it:
 *
 * 1. suppress the effect's bootstrap run so `subscribe`/`subscribeIssues` have no immediate emission;
 * 2. invoke external listeners with no active alien subscriber, so listener code reading other Runtime
 *    primitives cannot silently extend the dependency graph;
 * 3. isolate listener exceptions outside the current alien-signals flush.
 *
 * None of this is a parallel reactive engine: it is a pure call-order wrapper around `effect()` and
 * the exported active-subscriber seam.
 */

import type { RuntimeContext } from './context'
import { effect, setActiveSub } from 'alien-signals'

/**
 * `queueMicrotask` is a host global (browser + Node), not part of the ECMAScript lib this
 * platform-neutral package compiles against. Ambient-declare it locally; the JS emitted for a
 * `declare` has no runtime footprint, so this resolves to the real host global at call time.
 */
declare function queueMicrotask(callback: () => void): void

/**
 * Invokes `listener(value)` with no active alien subscriber (restoring the previous one afterward) and
 * isolates a synchronous throw so it cannot escape into the current alien-signals flush. Baseline
 * reporting for an isolated exception is a queued microtask rethrow.
 */
export function invokeListenerIsolated<Value>(listener: (value: Value) => void, value: Value): void {
	const previous = setActiveSub(undefined)
	try {
		listener(value)
	}
	catch (error) {
		queueMicrotask(() => {
			throw error
		})
	}
	finally {
		setActiveSub(previous)
	}
}

/**
 * Creates a Runtime-owned public subscription: an alien `effect()` that tracks `read()`, skips the
 * bootstrap run, and invokes `listener` through {@link invokeListenerIsolated} on every actual
 * subsequent run. Returns an idempotent unsubscribe function registered with the Runtime's disposal
 * bookkeeping.
 */
export function createTrackedSubscription<Value>(
	context: RuntimeContext,
	read: () => Value,
	listener: (value: Value) => void,
): () => void {
	let isBootstrap = true

	const rawDispose = effect(() => {
		const value = read()

		if (isBootstrap) {
			isBootstrap = false
			return
		}

		invokeListenerIsolated(listener, value)
	})

	return context.registerSubscription(rawDispose)
}
