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
 *    while a computed is still mid-evaluation (see {@link writeDeferringFlush});
 * 5. deliver Property inspection completions once the outermost Runtime operation has left, so an inspection
 *    listener never runs while alien-signals is evaluating, checking or flushing (see {@link deliverWhenIdle}).
 *
 * None of this is a parallel reactive engine: it is a pure call-order wrapper around `effect()`,
 * `startBatch()`/`endBatch()` and the exported active-subscriber seam. alien-signals still owns every
 * queue, every dirty flag and every notification decision.
 */

import type { RuntimeContext } from './context'
import { effect, endBatch, getActiveSub, getBatchDepth, setActiveSub, startBatch } from 'alien-signals'
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
 * Exception objects a subscription's tracked read threw that are queued for reporting and not reported yet.
 * One failing Property is re-read by each of its subscriptions and by every dependent's, and each read
 * rethrows the one cached exception object; it is reported once per synchronous turn, not once per read.
 */
const queuedReadExceptions = new Set<unknown>()

function reportTrackedReadException(error: unknown): void {
	// Only objects: two equal thrown primitives may be unrelated failures.
	if ((typeof error !== 'object' || error === null) && typeof error !== 'function') {
		reportIsolatedException(error)
		return
	}
	if (queuedReadExceptions.has(error))
		return
	queuedReadExceptions.add(error)
	queueMicrotask(() => {
		queuedReadExceptions.delete(error)
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
export function isEngineStackOverflow(error: unknown): boolean {
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
 * Whether the caller is outside everything of the Runtime and of the reactive graph: no Runtime operation in
 * progress, no open alien batch and no active subscriber. Only then does a read or a no-op write of a signal
 * have no side effect anyone could observe.
 */
export function isRuntimeIdle(): boolean {
	return operationDepth === 0 && getBatchDepth() === 0 && getActiveSub() === undefined
}

/**
 * alien-signals' batch depth when the outermost {@link runRuntimeOperation} frame was entered. Every batch
 * level opened inside that operation — a `RuntimeMethod` invocation's own batch, `resetState`'s batch and
 * every level {@link writeDeferringFlush} opened — is above it.
 */
let entryBatchDepth = 0

/**
 * Listener deliveries requested while a Runtime operation was in progress (Property inspection completions),
 * in request order, each with its generation (see {@link MAX_DELIVERY_GENERATIONS}).
 *
 * A listener that runs while a Property evaluation, an alien-signals dirty check or a flush is in progress and
 * reads or writes the Runtime re-enters alien-signals@3.2.1 there, which it does not support: `checkDirty` has
 * no branch for a computed whose getter is running (`RecursedCheck`), treats it as clean and clears the
 * `Pending` flag of every reader between it and the read, which then stay clean with a stale value; a write
 * flushes a second time inside the first and can re-enter the running getter, whose older result then
 * overwrites the newer one; and an effect that is running is not queued again by a write its own run caused
 * (issue #198). Queued deliveries run once the outermost operation has left, after its deferred propagations
 * were released: nothing is evaluating, checking or flushing then.
 */
let queuedDeliveries: (() => void)[] = []
let queuedGenerations: number[] = []
/** Whether {@link deliverQueued} is running: operations its listeners start queue their deliveries behind. */
let delivering = false
/** The generation of the delivery running now; `0` outside {@link deliverQueued}. */
let deliveryGeneration = 0

/**
 * How many generations of deliveries one outermost operation runs. A delivery queued by an operation that a
 * delivered listener started is one generation later than that listener's. A listener that keeps changing what
 * it observes (it writes, on every completion, a State its own Property depends on) would otherwise make the
 * outermost call loop until the values stop changing, or forever. Beyond the limit the remaining deliveries
 * are dropped and a `RangeError` is reported through the isolated-exception channel (not a coded error: it
 * reports a listener bug, like any exception an isolated listener throws). Internal, not configurable.
 */
const MAX_DELIVERY_GENERATIONS = 100

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
 *
 * `fn` receives `argument`, so a hot path passes a function that already exists together with its
 * argument instead of allocating a closure per call.
 */
export function runRuntimeOperation<Result, Argument = undefined>(fn: (argument: Argument) => Result, argument?: Argument): Result {
	if (operationDepth === 0)
		entryBatchDepth = getBatchDepth()
	++operationDepth
	try {
		return fn(argument as Argument)
	}
	finally {
		try {
			if (operationDepth === 1)
				releaseBatches()
		}
		finally {
			--operationDepth
			// Plain comparisons first, so a frame that is not the outermost one costs nothing here. In this
			// `finally`, so the queued deliveries also run when `fn` or the release threw (an effect that does not
			// belong to a Runtime can throw out of the release's flush); `deliverQueued` itself never throws, so
			// that exception still reaches the caller.
			if (operationDepth === 0 && queuedDeliveries.length > 0 && !delivering)
				deliverQueued()
		}
	}
}

/**
 * Runs `deliver` now when no Runtime operation is in progress, otherwise once the outermost one has left
 * (still synchronously, before it returns to its caller), after the deliveries requested before it. `deliver`
 * must not throw: it invokes listeners through {@link invokeListenerIsolated}.
 */
export function deliverWhenIdle(deliver: () => void): void {
	if (operationDepth === 0 && !delivering) {
		deliver()
		return
	}
	queuedDeliveries.push(deliver)
	queuedGenerations.push(deliveryGeneration + 1)
}

/**
 * Runs every queued delivery in order, including those queued by the operations the delivered listeners start
 * (each of those operations is outermost while it runs, so it releases its own deferred propagations), up to
 * {@link MAX_DELIVERY_GENERATIONS} generations.
 */
function deliverQueued(): void {
	delivering = true
	try {
		for (let index = 0; index < queuedDeliveries.length; index++) {
			deliveryGeneration = queuedGenerations[index]!
			if (deliveryGeneration > MAX_DELIVERY_GENERATIONS) {
				reportIsolatedException(new RangeError(`Inspection listeners kept changing what they observe for more than ${MAX_DELIVERY_GENERATIONS} rounds within one Runtime call; the remaining inspection notifications of that call were dropped.`))
				break
			}
			queuedDeliveries[index]!()
		}
	}
	finally {
		queuedDeliveries = []
		queuedGenerations = []
		deliveryGeneration = 0
		delivering = false
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
 * Closes a batch level its caller opened inside its own {@link runRuntimeOperation} frame (a
 * `RuntimeMethod` invocation's batch), unless another Runtime operation encloses that frame: the level is
 * then left open, and the outermost frame's release closes it (see {@link releaseBatches}), exactly as it
 * closes the levels {@link writeDeferringFlush} opens.
 *
 * An enclosing operation may be a Property read whose computed is mid-evaluation: a Property may invoke a
 * write-free Method, and when alien-signals' own flush evaluates that Property (an effect's dirty check),
 * the flush runs at batch depth `0`, so the invocation's own batch is the outermost one. A plain `endBatch()`
 * would then reach depth `0` and call `flush()` while the computed is mid-`updateComputed`, with the effects
 * the write queued still waiting — the nested flush {@link writeDeferringFlush} documents, which leaves the
 * Property's other dependents marked clean with stale values and their subscribers unnotified.
 *
 * Leaving the level open does not depend on whether the invocation also committed a changed diagnostic
 * snapshot (whose {@link writeDeferringFlush} level used to be the only thing keeping depth above `0`), so
 * the flush timing of a nested invocation no longer depends on its diagnostics either.
 */
export function endBatchDeferringFlush(): void {
	if (operationDepth > 1)
		return
	endBatch()
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
 * completed recompute. A bootstrap run that throws is isolated the same way. The exception is reported once
 * per synchronous turn however many subscriptions re-read it (see {@link reportTrackedReadException}).
 *
 * The effect is created inside a Runtime operation: its bootstrap read can evaluate Properties, and the
 * inspection completions it produces must be delivered after the effect's first run has finished, not inside
 * it, where alien-signals would not run the effect again for a write a listener makes (issue #198).
 */
export function createTrackedSubscription<Value>(
	context: RuntimeContext,
	read: () => Value,
	listener: (value: Value) => void,
): () => void {
	let isBootstrap = true

	const rawDispose = runRuntimeOperation(effect, () => {
		let value: Value
		try {
			value = read()
		}
		catch (error) {
			isBootstrap = false
			reportTrackedReadException(error)
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
