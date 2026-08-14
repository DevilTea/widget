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
 * 3. isolate listener exceptions outside the current alien-signals flush;
 * 4. hold an issue-snapshot commit performed *during* an evaluation inside an alien batch until the call
 *    that drove that evaluation has returned, so its propagation can never re-enter alien-signals' flush
 *    while a computed is still mid-evaluation (see {@link writeDeferringFlush}).
 *
 * None of this is a parallel reactive engine: it is a pure call-order wrapper around `effect()`,
 * `startBatch()`/`endBatch()` and the exported active-subscriber seam. alien-signals still owns every
 * queue, every dirty flag and every notification decision.
 */

import type { RuntimeContext } from './context'
import { effect, endBatch, setActiveSub, startBatch } from 'alien-signals'

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
 * Nesting depth of the calls that can drive an `alien-signals` evaluation/flush and therefore have to be
 * back out of the reactive graph before a deferred propagation is safe to release: `RuntimeState`'s
 * `attemptSet`, `RuntimeMethod`'s `invoke` and the tracked read of a Property's result computed. Purely
 * local bookkeeping for {@link writeDeferringFlush}, not a semantic boundary of its own.
 */
let operationDepth = 0

/** Number of `startBatch()` calls {@link writeDeferringFlush} has opened and not yet closed. */
let deferredFlushDepth = 0

/**
 * Closes every batch level {@link writeDeferringFlush} left open, letting alien-signals flush the
 * notifications it already queued.
 *
 * The loop condition is re-tested after every `endBatch()`: that flush can run an effect whose Property
 * recompute commits its own issue snapshot, which opens a fresh level this same drain must then close.
 * A recompute that throws inside one of those flushes must not leave alien-signals permanently batched
 * (every later flush in the Runtime's life would be silently suspended), so the remaining levels are
 * closed before the throw is rethrown.
 */
function releaseDeferredFlushes(): void {
	while (deferredFlushDepth > 0) {
		--deferredFlushDepth
		try {
			endBatch()
		}
		catch (error) {
			releaseDeferredFlushes()
			throw error
		}
	}
}

/**
 * Tracks one nesting level of the calls that can drive an evaluation, and releases every flush
 * {@link writeDeferringFlush} deferred inside it once the outermost level is leaving.
 *
 * The release runs while the depth is still `1`, so a listener that the release's own flush invokes and
 * that re-enters the Runtime cannot re-enter the drain loop. The decrement is unconditional: a Property
 * recompute that throws inside the release's flush (`createTrackedSubscription` isolates the external
 * listener, never the tracked read) must not leave the depth pinned above `0`, or every later call would
 * look nested and no release would ever run again.
 */
export function runRuntimeOperation<Result>(fn: () => Result): Result {
	++operationDepth
	try {
		return fn()
	}
	finally {
		try {
			if (operationDepth === 1)
				releaseDeferredFlushes()
		}
		finally {
			--operationDepth
		}
	}
}

/**
 * Performs a signal write whose propagation must not be flushed while a computed may still be
 * mid-evaluation, by holding an alien batch open until the outermost {@link runRuntimeOperation} frame on
 * the stack is leaving — i.e. until nothing that could still be evaluating remains.
 *
 * Why this is required in pinned alien-signals@3.2.1 (`esm/index.mjs` / `esm/system.mjs`):
 *
 * - `signalOper` ends a changed write with `propagate(subs, ...)` followed by `if (!batchDepth) flush()`.
 *   A write performed from inside a computed's own evaluator therefore starts a *nested* flush that runs
 *   the effects the outer propagation had already queued — while the computed that queued them is still
 *   mid-`updateComputed`.
 * - `updateComputed` sets `c.flags = 1 | 4` (`Mutable | RecursedCheck`) and only assigns
 *   `c.value = c.getter(...)` after the getter returns, so during that window the computed carries
 *   neither `Dirty` (16) nor `Pending` (32) and still holds its previous value.
 * - `checkDirty` has no `RecursedCheck` branch: a queued effect whose dependency chain passes through
 *   that computed hits none of its `(1 | 16)` / `(1 | 32)` cases, concludes `dirty === false`, and then
 *   clears its own intermediate's `Pending` flag (`sub.flags &= ~32`). The intermediate is now marked
 *   clean while still holding a stale cached value, so the later `shallowPropagate` — which only
 *   upgrades subscribers that are still `Pending` — skips it for good: the effect never runs again and
 *   even an untracked `.get()` returns the stale cache.
 *
 * Keeping `batchDepth > 0` for the write removes the nested flush entirely: `propagate` still marks and
 * queues every watcher through alien-signals' own bookkeeping, and the queue is drained later — by the
 * flush that is already running (it re-reads the shared queue length) or by
 * {@link runRuntimeOperation}'s release. Nothing here re-implements propagation, ordering or dedupe.
 *
 * The write itself is unconditional and immediate, so a snapshot is committed exactly where it was
 * before: `pendingValue` is written synchronously and every later read commits it (`signalOper`'s read
 * path runs `updateSignal` when the signal is `Dirty`), which keeps "the snapshot is committed by the
 * time the operation's `ExecutionResult` is observable" true. Only the *notification* moves — never past
 * the end of the operation that produced it.
 *
 * One consequence of using an alien batch as the deferral mechanism, rather than a normative rule about
 * Runtime operations: while a level is open, alien-signals coalesces as it does inside any batch, so two
 * writes to the *same* signal before the release notify its subscribers once, with the final value. This
 * is not a new Runtime semantic — it is the ordinary behavior of the batching alien-signals already owns,
 * already observable inside `RuntimeMethod.invoke`'s batch. Every actual completed recompute still
 * notifies each of its own subscribers exactly once; alien-signals, not this module, decides which
 * recomputes happen.
 */
export function writeDeferringFlush(write: () => void): void {
	if (operationDepth === 0) {
		// No Runtime operation is in flight, so no computed can be mid-evaluation and there is nothing to
		// protect: let the write flush immediately, exactly like any other top-level write.
		write()
		return
	}

	startBatch()
	++deferredFlushDepth
	write()
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
