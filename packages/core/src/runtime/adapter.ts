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
 *    listener never runs while alien-signals is evaluating, checking or flushing (see {@link deliverWhenIdle});
 *    the isolated exceptions of 3. reach a host-supplied handler the same way (see {@link setIsolatedErrorHandler}).
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
 * Receives an exception Core isolated from the operation that raised it (see {@link setIsolatedErrorHandler}).
 * It receives only the exception: nothing says which Runtime, member or call isolated it.
 */
export type IsolatedErrorHandler = (error: unknown) => void

/**
 * The function isolated exceptions are handed to, or `null` for the default report: a queued microtask
 * rethrow. Realm-wide, like the delivery queue it relies on: a report site has no Runtime at hand, and some
 * reports (a `WidgetDocument` subscriber's exception, the delivery bound's `RangeError`) belong to none.
 */
let isolatedErrorHandler: IsolatedErrorHandler | null = null

/**
 * Sets the function that receives the exceptions Core isolates: those thrown by a State, Property,
 * diagnostics, Event, disposal, inspection or `WidgetDocument` listener, by a Property `compute` while a
 * subscription re-evaluates it, and the `RangeError` that reports a bounded runaway loop. `null` or
 * `undefined` restores the default report, a rethrow in a queued microtask. Returns the handler that was set
 * before (`null` for the default), so a caller that sets one temporarily can put it back.
 *
 * Every report goes through one hand-over pass (see {@link deliverQueued}): an exception isolated while a
 * Runtime operation is in progress is handed over once the outermost operation has finished its work, still
 * before it returns to its caller (also when it throws); one isolated with no operation in progress starts the
 * pass at once. Within a pass, reports and Property inspection deliveries are handed over one at a time, in the
 * order Core produced them, and the handler is never re-entered: what its own calls isolate is handed over
 * after it returns, behind what was already waiting. The handler therefore never runs while Core is evaluating,
 * checking or flushing (unless the host holds its own alien-signals batch, which is unsupported), and it may
 * read and write any Runtime. A `compute` exception that several subscriptions re-read is handed over once
 * per pass.
 *
 * A handler that throws breaks nothing: its exception is rethrown in a queued microtask, and the remaining
 * reports are still handed over. A report still queued when the handler is replaced goes to the new handler;
 * one still queued when the handler is removed is rethrown in a microtask. A handler whose handling keeps
 * causing new isolated exceptions is stopped by {@link MAX_HANDLER_CAUSED_DEPTH} and
 * {@link MAX_HANDLER_CAUSED_REPORTS}, and what its handling causes after the inspection delivery bound stopped a
 * pass is rethrown in a microtask too. These rethrows are the only microtasks Core queues while a handler is
 * set; in a host without `queueMicrotask` such a report is dropped, and nothing else is affected. One handler serves the
 * whole loaded Core module, every System, Runtime and `WidgetDocument` alike: it belongs to the host, and a
 * plugin or renderer library must not set it.
 */
export function setIsolatedErrorHandler(handler: IsolatedErrorHandler | null | undefined): IsolatedErrorHandler | null {
	if (handler !== null && handler !== undefined && typeof handler !== 'function')
		throw new TypeError(`setIsolatedErrorHandler() expects a function, null or undefined, got ${typeof handler}.`)
	const previous = isolatedErrorHandler
	isolatedErrorHandler = handler ?? null
	return previous
}

/**
 * Reports an exception isolated from the current operation through the host's error-reporting
 * boundary, outside the current alien-signals flush: to the handler when one is set (see
 * {@link handOverIsolatedException}), otherwise by a queued microtask rethrow.
 */
function reportIsolatedException(error: unknown): void {
	if (isolatedErrorHandler !== null) {
		handOverIsolatedException(error, false)
		return
	}
	queueMicrotask(() => {
		throw error
	})
}

/**
 * Exception objects a subscription's tracked read threw that are queued for reporting and not reported yet.
 * One failing Property is re-read by each of its subscriptions and by every dependent's, and each read
 * rethrows the one cached exception object; it is reported once per synchronous turn, not once per read.
 * With a handler set the turn is the hand-over pass: an exception handed over stays here until the pass ends
 * (see {@link readExceptionsHandedOver}).
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
	if (isolatedErrorHandler !== null) {
		handOverIsolatedException(error, true)
		return
	}
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
 * Listener deliveries requested while a Runtime operation was in progress (Property inspection completions,
 * and the isolated exceptions queued for the handler, see {@link handOverIsolatedException}), in request
 * order, each with its generation (see {@link MAX_DELIVERY_GENERATIONS}).
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
/**
 * Whether the host call in progress has anything to finish when its outermost operation leaves (see
 * {@link finishHostCall}): deliveries in `queuedDeliveries`, or a subscription that counted a notification in it
 * (see {@link hostCalls}). One flag for both, so that the check every outermost operation makes when it leaves is
 * one load and one test while there is neither, the common case.
 */
let hostCallWork = false
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
 * reports a listener bug, like any exception an isolated listener throws). The reports queued for the handler
 * are not dropped with the deliveries (see {@link handOverAtDeliveryLimit}); a report that the handler's own
 * calls cause stays in the generation of the report the handler was handling, because the handler's feedback
 * has its own bounds ({@link MAX_HANDLER_CAUSED_DEPTH}, {@link MAX_HANDLER_CAUSED_REPORTS}). Internal, not
 * configurable.
 */
const MAX_DELIVERY_GENERATIONS = 100

/**
 * Numbers the host's calls into the Runtime in which a subscription was notified. A subscription compares it with
 * the number it last counted in to restart its count of notifications (see {@link MAX_NOTIFICATIONS_PER_CALL}).
 * Realm-wide, like {@link operationDepth}.
 *
 * It is advanced when such a call ends, not when a call starts, so that an operation in which nothing is
 * notified (a cached read, a write nobody observes) executes nothing for it: the first notification a
 * subscription counts in a call sets {@link hostCallWork}, and the outermost operation's exit, which tests that
 * flag already, advances the number in {@link finishHostCall}. A call ends when its outermost operation leaves
 * outside the queued-delivery drain, after the drain: the operations that the listeners of a queued delivery
 * start are outermost too, but they run before the host's call returns, on its behalf, so they keep its number.
 * It starts at `1`, above every value a subscription stores before its first count (see
 * {@link createTrackedSubscription}).
 */
let hostCalls = 1

/**
 * How many times one subscription's listener is notified within one host call into the Runtime, the deliveries
 * that call queues included (see {@link hostCalls}). Listeners that keep changing what they observe (a
 * self-normaliser that writes a fresh copy while something else reads the member, two listeners mirroring each
 * other's objects, a diverging pair) would otherwise make that call loop forever: the loop runs inside
 * alien-signals' flush, iteratively, so nothing else bounds it. Beyond the limit the listener is not called again
 * until the call returns, and one `RangeError` naming what the subscription observes is reported through the
 * isolated-exception channel (not a coded error: it reports a listener bug, like any exception an isolated
 * listener throws). High enough that a converging cascade of listeners does not reach it (it takes thousands of
 * listener steps in one call), low enough that a loop reaches it within milliseconds. Counted separately from
 * {@link MAX_DELIVERY_GENERATIONS}: an inspection delivery round is not a subscriber notification. It must stay
 * well above it, because a loop that runs through delivery rounds notifies a subscriber once per round, and
 * stopping and reporting that loop is the delivery bound's job. Internal, not configurable; exported for the tests only.
 */
export const MAX_NOTIFICATIONS_PER_CALL = 10_000

/**
 * What a subscription observes, for the limit's report: `"State"`/`"Property"` and `"the diagnostics of
 * State"`/`"of Property"`/`"of Method"` with the member's own primitive parameters as the owner, `"the
 * diagnostics of widget"` with the widget id as the owner. Static strings, so a subscription stores no message.
 */
export type SubscriptionSubject
	= | 'State'
		| 'Property'
		| 'the diagnostics of State'
		| 'the diagnostics of Property'
		| 'the diagnostics of Method'
		| 'the diagnostics of widget'

/**
 * Who the observed member belongs to, for the limit's report: an object the caller already holds (a primitive's
 * parameters, which name the widget and the member) or a widget id, so that a subscription keeps one reference
 * and the report's text is built only when the limit is reached.
 */
export type SubscriptionOwner
	= | { readonly widgetId: string, readonly key: string }
		| { readonly widgetId: string, readonly name: string }
		| string

/** Reports that a subscription reached {@link MAX_NOTIFICATIONS_PER_CALL}; `observed` names what it observes. */
function reportNotificationLimit(observed: string): void {
	reportIsolatedException(new RangeError(`The subscription to ${observed} was notified ${MAX_NOTIFICATIONS_PER_CALL} times within one call into the Runtime, so its listener is not called again until that call returns. The usual cause is listeners that keep writing what one another observe.`))
}

function describeSubscription(subject: SubscriptionSubject, owner: SubscriptionOwner): string {
	if (typeof owner === 'string')
		return `${subject} "${owner}"`
	return `${subject} "${'key' in owner ? owner.key : owner.name}" of widget "${owner.widgetId}"`
}

/**
 * Closes every batch level opened inside the outermost Runtime operation, letting alien-signals flush the
 * notifications it already queued.
 *
 * In normal operation the only levels still open here are the ones {@link writeDeferringFlush} opened, the ones
 * nested Method invocations left open ({@link endBatchDeferringFlush}) and the ones nested writes opened
 * ({@link runRuntimeWrite}): every other level is closed by its own `endBatch()` in a `finally`.
 * But that `finally` cannot be relied
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
 *
 * Reads, Method invocations and subscriptions use this entry; State writes use {@link runRuntimeWrite}, which
 * differs only on a nested entry, so that this one executes nothing for a feature only writes need.
 */
export function runRuntimeOperation<Result, Argument = undefined>(fn: (argument: Argument) => Result, argument?: Argument): Result {
	if (operationDepth === 0)
		entryBatchDepth = getBatchDepth()
	++operationDepth
	try {
		return fn(argument as Argument)
	}
	finally {
		if (operationDepth === 1) {
			try {
				releaseBatches()
			}
			finally {
				--operationDepth
				// Only the outermost frame looks at what the host call has to finish, through a flag that is false
				// while there is nothing (always, when no inspection listener is registered and nobody was notified).
				// In this `finally`, so the queued deliveries also run when `fn` or the release threw (an effect that
				// does not belong to a Runtime can throw out of the release's flush); `finishHostCall` itself never
				// throws, so that exception still reaches the caller.
				if (hostCallWork && !delivering)
					finishHostCall()
			}
		}
		else {
			--operationDepth
		}
	}
}

/**
 * {@link runRuntimeOperation} for an operation that writes State (`RuntimeState`'s `attemptSet`, both
 * `resetState()`s). It executes the same statements, except that when it is entered while another operation is
 * in progress (a listener the enclosing operation's flush invokes, say) with no batch level open, it opens one,
 * which the outermost frame's release closes: its writes never flush on their own, like a nested Method
 * invocation's (see {@link endBatchDeferringFlush}). Flushing them there would run the effects they queue inside
 * the flush that is running the listener's own effect, and alien-signals does not queue an effect again for a
 * write made while that effect runs, so a subscriber whose value the write changes could miss it.
 *
 * A separate entry rather than a parameter of {@link runRuntimeOperation}, so that a read, outermost or nested,
 * executes nothing for this; and a copy of its body rather than a call to it, so that an outermost write executes
 * exactly what it did before. Keep the two bodies identical apart from the nested entry.
 */
export function runRuntimeWrite<Result, Argument = undefined>(fn: (argument: Argument) => Result, argument?: Argument): Result {
	// The nested case first: then the outermost case executes the same bytecodes as `runRuntimeOperation`'s, with
	// no jump over the other branch.
	if (operationDepth !== 0) {
		if (getBatchDepth() === 0)
			startBatch()
	}
	else {
		entryBatchDepth = getBatchDepth()
	}
	++operationDepth
	try {
		return fn(argument as Argument)
	}
	finally {
		if (operationDepth === 1) {
			try {
				releaseBatches()
			}
			finally {
				--operationDepth
				if (hostCallWork && !delivering)
					finishHostCall()
			}
		}
		else {
			--operationDepth
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
	hostCallWork = true
}

/**
 * Finishes the host call whose outermost operation is leaving: runs the deliveries it queued (see
 * {@link deliverQueued}), then advances {@link hostCalls}, so the notifications of those deliveries count in this
 * call and the next call starts every count from zero. The advance is in a `finally` of plain statements, so it
 * happens even when the drain throws (only an exhausted engine stack can make it throw).
 */
function finishHostCall(): void {
	try {
		if (queuedDeliveries.length > 0)
			deliverQueued()
	}
	finally {
		hostCallWork = false
		++hostCalls
	}
}

/**
 * The causal depth of the report the handler is handling now, or `-1` while it is not running. Every hand-over
 * happens inside {@link deliverQueued}, so the handler is never re-entered: one value is enough. A report
 * isolated while the handler runs was caused by its handling of this report, one level deeper.
 */
let handlingDepth = -1
/** Whether the running pass of {@link deliverQueued} handed a report over: its end then resets the state below. */
let handOverPassDirty = false
/** Read exceptions handed over in the running pass: they stay in {@link queuedReadExceptions} until it ends. */
let readExceptionsHandedOver: unknown[] = []
/** Reports caused by the handler's handling (depth above `0`) handed over in the running pass. */
let handlerCausedReports = 0
/** Whether the running pass already handed the handler the `RangeError` of each bound below. */
let depthBoundReported = false
let totalBoundReported = false

/**
 * How long a chain of reports, each caused by the handler's handling of the previous one, is handed back to the
 * handler within one pass. A handler that keeps causing what it handles (on every report it writes a State whose
 * subscriber throws) would otherwise make the host's call loop forever. Independent reports are not counted: a
 * call in which 150 listeners throw and the handler causes one new exception for each hands all 300 over.
 * Beyond the limit the handler is handed one `RangeError`, and the exceptions further down that chain are
 * rethrown in a microtask. Internal, not configurable; exported for the tests only.
 */
export const MAX_HANDLER_CAUSED_DEPTH = 100

/**
 * How many reports caused by the handler's handling are handed over within one pass, whatever their depth. The
 * depth bound alone does not stop a handler whose handling of each report causes two new ones: the chains stay
 * short of the limit while their number doubles at every level. Far above anything a converging handler
 * causes. Beyond it the handler is handed one `RangeError`, and the reports its handling causes later in that
 * pass are rethrown in a microtask. Internal, not configurable; exported for the tests only.
 */
export const MAX_HANDLER_CAUSED_REPORTS = 10_000

/**
 * Runs every queued delivery in order, including those queued by the operations the delivered listeners start
 * (each of those operations is outermost while it runs, so it releases its own deferred propagations), up to
 * {@link MAX_DELIVERY_GENERATIONS} generations. This is also the one hand-over pass of the isolated-error handler
 * (see {@link handOverIsolatedException}).
 */
function deliverQueued(): void {
	delivering = true
	try {
		for (let index = 0; index < queuedDeliveries.length; index++) {
			deliveryGeneration = queuedGenerations[index]!
			if (deliveryGeneration > MAX_DELIVERY_GENERATIONS) {
				handOverAtDeliveryLimit(index)
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
		if (handOverPassDirty)
			endHandOverPass()
	}
}

function endHandOverPass(): void {
	handOverPassDirty = false
	for (const error of readExceptionsHandedOver)
		queuedReadExceptions.delete(error)
	readExceptionsHandedOver = []
	handlerCausedReports = 0
	depthBoundReported = false
	totalBoundReported = false
}

/** An isolated exception waiting in the delivery queue for the handler. */
interface QueuedReport {
	readonly error: unknown
	/** Whether it is in {@link queuedReadExceptions} until the pass that hands it over ends. */
	readonly readException: boolean
	/** `0`, or one more than the depth of the report whose handling caused it (see {@link MAX_HANDLER_CAUSED_DEPTH}). */
	readonly depth: number
}

/** The queued delivery of each report, so the delivery bound can tell reports apart from inspection deliveries. */
const queuedReports = new WeakMap<() => void, QueuedReport>()

/**
 * Ends a delivery run that reached {@link MAX_DELIVERY_GENERATIONS} at `from`. The inspection deliveries from
 * there on are dropped; the reports among them are still handed over, in order, and then the `RangeError` that
 * reports the bound. An exception isolated by what the handler does meanwhile is not handed to it in this call
 * (that could go on forever): it is rethrown in a microtask, like an exception the handler throws.
 */
function handOverAtDeliveryLimit(from: number): void {
	const end = queuedDeliveries.length
	for (let index = from; index < end; index++) {
		const report = queuedReports.get(queuedDeliveries[index]!)
		if (report !== undefined)
			handOverQueuedReport(report)
	}
	const handler = isolatedErrorHandler
	const limitError = new RangeError(`Inspection listeners kept changing what they observe for more than ${MAX_DELIVERY_GENERATIONS} rounds within one Runtime call; the remaining inspection notifications of that call were dropped.`)
	// Not `reportIsolatedException`: a delivery run is in progress, so it would queue the report behind the
	// deliveries this run is dropping.
	if (handler === null) {
		queueMicrotask(() => {
			throw limitError
		})
	}
	else {
		callIsolatedErrorHandler(handler, limitError, 0)
	}
	for (let index = end; index < queuedDeliveries.length; index++) {
		const report = queuedReports.get(queuedDeliveries[index]!)
		if (report !== undefined)
			fallBack(report)
	}
}

/**
 * Queues `error` for the handler behind the deliveries already waiting, exactly like {@link deliverWhenIdle},
 * and starts the pass at once when no Runtime operation is in progress and none is running: otherwise the
 * outermost operation's existing exit check, or the running pass, hands it over.
 */
function handOverIsolatedException(error: unknown, readException: boolean): void {
	const depth = handlingDepth < 0 ? 0 : handlingDepth + 1
	if (readException)
		queuedReadExceptions.add(error)
	const report: QueuedReport = { error, readException, depth }
	const deliver = (): void => handOverQueuedReport(report)
	queuedReports.set(deliver, report)
	queuedDeliveries.push(deliver)
	// A report the handler's handling caused stays in the round being delivered: the handler's feedback is
	// bounded by `MAX_HANDLER_CAUSED_DEPTH` and `MAX_HANDLER_CAUSED_REPORTS`, not by `MAX_DELIVERY_GENERATIONS`.
	queuedGenerations.push(depth === 0 ? deliveryGeneration + 1 : deliveryGeneration)
	hostCallWork = true
	// With no operation in progress the pass is a host call of its own: `finishHostCall` runs it and then
	// advances `hostCalls`, so what the handler's own calls notify is counted apart from the host's other calls.
	if (operationDepth === 0 && !delivering)
		finishHostCall()
}

/** Hands a queued report to the handler that is set now, or rethrows it in a microtask when none is. */
function handOverQueuedReport(report: QueuedReport): void {
	const handler = isolatedErrorHandler
	if (handler === null) {
		fallBack(report)
		return
	}
	handOverPassDirty = true
	if (report.readException)
		readExceptionsHandedOver.push(report.error)
	const depth = report.depth
	if (depth > MAX_HANDLER_CAUSED_DEPTH) {
		if (!depthBoundReported) {
			depthBoundReported = true
			callIsolatedErrorHandler(handler, new RangeError(`The isolated-error handler caused a new isolated exception while handling the previous one ${MAX_HANDLER_CAUSED_DEPTH} times in a row within one Runtime call; the exceptions further down that chain are rethrown in a microtask instead of being handed to it.`), depth)
		}
		fallBack(report)
		return
	}
	if (depth > 0 && ++handlerCausedReports > MAX_HANDLER_CAUSED_REPORTS) {
		if (!totalBoundReported) {
			totalBoundReported = true
			callIsolatedErrorHandler(handler, new RangeError(`The isolated-error handler caused more than ${MAX_HANDLER_CAUSED_REPORTS} new isolated exceptions while handling others within one Runtime call; the ones it causes later in that call are rethrown in a microtask instead of being handed to it.`), depth)
		}
		fallBack(report)
		return
	}
	callIsolatedErrorHandler(handler, report.error, depth)
}

/** Rethrows a report the handler does not take in a microtask; it leaves the de-duplication set when the pass ends. */
function fallBack(report: QueuedReport): void {
	handOverPassDirty = true
	if (report.readException)
		readExceptionsHandedOver.push(report.error)
	rethrowInMicrotask(report.error)
}

/**
 * Calls the handler with no active alien subscriber (see {@link invokeListenerIsolated}), recording the depth of
 * the report it handles; its own exception goes to a microtask rethrow, never back to it.
 */
function callIsolatedErrorHandler(handler: IsolatedErrorHandler, error: unknown, depth: number): void {
	const previous = setActiveSub(undefined)
	handlingDepth = depth
	try {
		handler(error)
	}
	catch (handlerError) {
		rethrowInMicrotask(handlerError)
	}
	finally {
		handlingDepth = -1
		setActiveSub(previous)
	}
}

/**
 * The fallback channel while a handler is set. It never throws: in a host without `queueMicrotask` the report is
 * dropped, and the pass, the host's call and every other report go on as if it had been queued.
 */
function rethrowInMicrotask(error: unknown): void {
	try {
		queueMicrotask(() => {
			throw error
		})
	}
	catch {
		// No microtask channel: this one report is lost (documented under "Host requirements").
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
 * A caller whose `read()` can evaluate Properties (a Property's `subscribe()`) calls this inside a Runtime
 * operation, so that the inspection completions the bootstrap run produces are delivered after the effect's
 * first run has finished, not inside it, where alien-signals would not run the effect again for a write a
 * listener makes (issue #198). The other subscriptions only read signals, and need no operation.
 *
 * Within one host call into the Runtime (see {@link hostCalls}) the listener is called at most
 * {@link MAX_NOTIFICATIONS_PER_CALL} times; `subject` and `owner` name what the subscription observes in the
 * report of the limit, whose text is built only when the limit is reached. A notification adds three comparisons
 * and an increment (and three assignments in the first notification of a call). The subscription stores the two
 * references it is given and one number besides what it stored before: `countedIn` replaces the bootstrap flag
 * (`-1` until the bootstrap run, then the host call the count belongs to; `0` matches no call, since
 * {@link hostCalls} starts at `1`). Nothing is allocated unless the limit is reached.
 */
export function createTrackedSubscription<Value>(
	context: RuntimeContext,
	read: () => Value,
	listener: (value: Value) => void,
	subject: SubscriptionSubject,
	owner: SubscriptionOwner,
): () => void {
	let countedIn = -1
	let notifications = 0

	const rawDispose = effect(() => {
		let value: Value
		try {
			value = read()
		}
		catch (error) {
			if (countedIn === -1)
				countedIn = 0
			reportTrackedReadException(error)
			return
		}

		if (countedIn === -1) {
			countedIn = 0
			return
		}
		// Every flush Core starts runs inside a Runtime operation; outside one there is no call to bound.
		if (operationDepth !== 0) {
			if (countedIn !== hostCalls) {
				countedIn = hostCalls
				notifications = 0
				hostCallWork = true
			}
			if (++notifications > MAX_NOTIFICATIONS_PER_CALL) {
				if (notifications === MAX_NOTIFICATIONS_PER_CALL + 1)
					reportNotificationLimit(describeSubscription(subject, owner))
				return
			}
		}

		invokeListenerIsolated(listener, value)
	})

	return context.registerSubscription(rawDispose)
}

/**
 * {@link createTrackedSubscription} for the Runtime diagnostics aggregate, whose `read()` re-runs after any commit
 * but whose value changes less often: a run whose value is the one last delivered (initially `initial`) neither
 * calls the listener nor counts towards the limit. A separate function with the same body, so that the other
 * subscriptions store and test nothing for this filter and the aggregate allocates no filter closure. Keep the two
 * bodies identical apart from the filter.
 */
export function createDistinctTrackedSubscription<Value>(
	context: RuntimeContext,
	read: () => Value,
	listener: (value: Value) => void,
	initial: Value,
): () => void {
	let delivered = initial
	let countedIn = -1
	let notifications = 0

	const rawDispose = effect(() => {
		let value: Value
		try {
			value = read()
		}
		catch (error) {
			if (countedIn === -1)
				countedIn = 0
			reportTrackedReadException(error)
			return
		}

		if (countedIn === -1) {
			countedIn = 0
			return
		}
		if (value === delivered)
			return
		if (operationDepth !== 0) {
			if (countedIn !== hostCalls) {
				countedIn = hostCalls
				notifications = 0
				hostCallWork = true
			}
			if (++notifications > MAX_NOTIFICATIONS_PER_CALL) {
				if (notifications === MAX_NOTIFICATIONS_PER_CALL + 1)
					reportNotificationLimit('the diagnostics of the Runtime')
				return
			}
		}

		delivered = value
		invokeListenerIsolated(listener, value)
	})

	return context.registerSubscription(rawDispose)
}
