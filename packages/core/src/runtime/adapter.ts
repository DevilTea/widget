/**
 * Thin `alien-signals@3.2.1` adapter.
 *
 * `alien-signals` owns dependency tracking, lazy computed, cache/stale state, invalidation and
 * batching/propagation. This module only adds the thin wrapper behavior diagnostic #10 consolidated
 * handoff §17 (mirroring the amendment "Implementation verification — alien-signals@3.2.1
 * conformance") requires on top of it:
 *
 * 1. suppress the effect's bootstrap run so `subscribe`/`subscribeDiagnostics` have no immediate emission;
 * 2. invoke external listeners with no active alien subscriber, so listener code reading other Runtime
 *    primitives cannot silently extend the dependency graph;
 * 3. isolate listener exceptions — and exceptions a subscription's own tracked read throws, i.e. a
 *    Property `compute` throwing while its subscription re-evaluates it — outside the current
 *    alien-signals flush (an event listener's runaway-emit-loop error is the one exception rethrown, see
 *    {@link isEmitLoopError});
 * 4. hold an diagnostic-snapshot commit performed *during* an evaluation inside an alien batch until the call
 *    that drove that evaluation has returned, so its propagation can never re-enter alien-signals' flush
 *    while a computed is still mid-evaluation (see {@link writeDeferringFlush}).
 *
 * None of this is a parallel reactive engine: it is a pure call-order wrapper around `effect()`,
 * `startBatch()`/`endBatch()` and the exported active-subscriber seam. alien-signals still owns every
 * queue, every dirty flag and every notification decision.
 */

import type { RuntimeContext } from './context'
import { effect, endBatch, getBatchDepth, setActiveSub, startBatch } from 'alien-signals'
import { WidgetSystemRuntimeReentrancyError } from '../diagnostic'
import { callbackScope } from './context'

/**
 * `queueMicrotask` is a host global (browser + Node), not part of the ECMAScript lib this
 * platform-neutral package compiles against. Ambient-declare it locally; the JS emitted for a
 * `declare` has no runtime footprint, so this resolves to the real host global at call time.
 */
declare function queueMicrotask(callback: () => void): void

/**
 * Reports an exception isolated from the current operation through the host's error-reporting
 * boundary, outside the current alien-signals flush. Baseline reporting is a queued microtask rethrow.
 */
function reportIsolatedException(error: unknown): void {
	queueMicrotask(() => {
		throw error
	})
}

/**
 * Invokes `listener(value)` with no active alien subscriber and no open callback (see `callbackScope`), so
 * neither its reads nor a dependency or `emit` callable it retained from a running Method reach into the
 * operation that notified it, restoring both afterward. A synchronous throw is isolated so it cannot escape
 * into the current alien-signals flush (see {@link reportIsolatedException}).
 */
export function invokeListenerIsolated<Value>(listener: (value: Value) => void, value: Value): void {
	const previousOwner = callbackScope.owner
	callbackScope.owner = null
	const previous = setActiveSub(undefined)
	try {
		listener(value)
	}
	catch (error) {
		reportIsolatedException(error)
	}
	finally {
		// The plain assignment first: it still runs when the stack is exhausted.
		callbackScope.owner = previousOwner
		setActiveSub(previous)
	}
}

/** Runs `read` with no active alien subscriber, so whatever it reads is not tracked by the caller. */
export function readUntracked<Value>(read: () => Value): Value {
	const previous = setActiveSub(undefined)
	try {
		return read()
	}
	finally {
		setActiveSub(previous)
	}
}

/**
 * Whether `error` is an engine's call-stack exhaustion. Engines give it no dedicated type: V8,
 * JavaScriptCore, Hermes and QuickJS-ng throw a `RangeError` ("Maximum call stack size exceeded"),
 * SpiderMonkey an `InternalError` ("too much recursion"), QuickJS and XS a "stack overflow". The message is
 * the only signal, so an ordinary `RangeError` (an invalid date, array length, ...) never matches.
 */
function isEngineStackOverflow(error: unknown): boolean {
	try {
		return (error instanceof RangeError || (error instanceof Error && error.name === 'InternalError'))
			&& /call stack|stack overflow|too much recursion/i.test(error.message)
	}
	catch {
		return false
	}
}

/**
 * Whether `error` is unwinding a runaway emit loop: the emit re-entrancy guard's
 * {@link WidgetSystemRuntimeReentrancyError}, or an engine stack overflow. These are the exceptions event
 * listener isolation does not swallow. Isolating one would make the emit retry its remaining listeners,
 * each of which runs into the same failure again — at every nesting level, which is exponential work.
 */
export function isEmitLoopError(error: unknown): boolean {
	return error instanceof WidgetSystemRuntimeReentrancyError || isEngineStackOverflow(error)
}

/**
 * {@link invokeListenerIsolated} for a synchronous semantic event listener and its argument tuple: no
 * reads leak into an enclosing Property/effect, and a throw is reported outside the emit instead of
 * aborting the emitting Method and the remaining listeners — unless it is unwinding a runaway emit loop
 * ({@link isEmitLoopError}), which is rethrown. Event delivery never runs inside an alien-signals flush, so
 * the rethrow cannot strand another subscriber's queued notification.
 */
export function invokeEventListenerIsolated(listener: (...args: readonly unknown[]) => void, args: readonly unknown[]): void {
	const previousOwner = callbackScope.owner
	callbackScope.owner = null
	const previous = setActiveSub(undefined)
	try {
		listener(...args)
	}
	catch (error) {
		if (isEmitLoopError(error))
			throw error
		reportIsolatedException(error)
	}
	finally {
		// The plain assignment first: it still runs when the stack is exhausted.
		callbackScope.owner = previousOwner
		setActiveSub(previous)
	}
}

/**
 * Nesting depth of the calls that can drive an `alien-signals` evaluation/flush and therefore have to be
 * back out of the reactive graph before a deferred propagation is safe to release: `RuntimeState`'s
 * `attemptSet`, `RuntimeMethod`'s `invoke`, `resetState` and the tracked read of a Property's result
 * computed. Purely local bookkeeping for {@link writeDeferringFlush}, not a semantic boundary of its own.
 */
let operationDepth = 0

/**
 * alien-signals' batch depth when the outermost {@link runRuntimeOperation} frame was entered. Every batch
 * level opened inside that operation — a `RuntimeMethod` invocation's own batch, `resetState`'s batch and
 * every level {@link writeDeferringFlush} opened — is above it.
 */
let entryBatchDepth = 0

/**
 * Closes every batch level opened inside the outermost Runtime operation, letting alien-signals flush the
 * notifications it already queued.
 *
 * In normal operation the only levels still open here are the ones {@link writeDeferringFlush} opened:
 * every other level is closed by its own `endBatch()` in a `finally`. But that `finally` cannot be relied
 * on when runaway recursion (a valid Method <-> Method cycle) exhausts the engine's stack: the deepest
 * frames' `endBatch()` calls themselves overflow and never decrement. Draining to the depth recorded on
 * entry, rather than counting the levels this module opened, closes those leaked levels too, so a
 * `RangeError` can never leave the realm permanently batched.
 *
 * The loop condition is re-tested after every `endBatch()`: that flush can run an effect whose Property
 * recompute commits its own diagnostic snapshot, which opens a fresh level this same drain must then close.
 * Runtime subscriptions never throw out of a flush (listener and tracked-read exceptions are isolated),
 * but any other alien effect sharing the realm can; such a throw must not leave alien-signals permanently
 * batched (every later flush in the realm would be silently suspended), so the remaining levels are
 * closed before the throw is rethrown.
 */
function releaseBatches(): void {
	while (getBatchDepth() > entryBatchDepth) {
		try {
			endBatch()
		}
		catch (error) {
			releaseBatches()
			throw error
		}
	}
}

/**
 * Tracks one nesting level of the calls that can drive an evaluation, and closes every batch level opened
 * inside it (see {@link releaseBatches}) once the outermost level is leaving.
 *
 * The release runs while the depth is still `1`, so a listener that the release's own flush invokes and
 * that re-enters the Runtime cannot re-enter the drain loop. The decrement is unconditional: a throw
 * inside the release's flush must not leave the depth pinned above `0`, or every later call would look
 * nested and no release would ever run again. Both depth updates are plain expressions, never calls, so
 * they still run when the stack is exhausted.
 */
export function runRuntimeOperation<Result>(fn: () => Result): Result {
	if (operationDepth === 0)
		entryBatchDepth = getBatchDepth()
	++operationDepth
	try {
		return fn()
	}
	finally {
		try {
			if (operationDepth === 1)
				releaseBatches()
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
	write()
}

/**
 * Creates a Runtime-owned public subscription: an alien `effect()` that tracks `read()`, skips the
 * bootstrap run, and invokes `listener` through {@link invokeListenerIsolated} on every actual
 * subsequent run. Returns an idempotent unsubscribe function registered with the Runtime's disposal
 * bookkeeping.
 *
 * `read()` itself can throw: a Property's tracked result read rethrows its `compute`'s exception (the
 * Property primitive caches that outcome instead of letting it escape the computed). Such a run is
 * isolated like a listener exception — the write that triggered it and every other subscriber are
 * unaffected — and only skips this subscription's notification. The tracked read had already linked the
 * effect to the Property before rethrowing, so the subscription stays live and resumes on the next
 * completed recompute. A bootstrap run that throws is isolated the same way.
 */
export function createTrackedSubscription<Value>(
	context: RuntimeContext,
	read: () => Value,
	listener: (value: Value) => void,
): () => void {
	let isBootstrap = true

	const rawDispose = effect(() => {
		let value: Value
		try {
			value = read()
		}
		catch (error) {
			isBootstrap = false
			reportIsolatedException(error)
			return
		}

		if (isBootstrap) {
			isBootstrap = false
			return
		}

		invokeListenerIsolated(listener, value)
	})

	return context.registerSubscription(rawDispose)
}
