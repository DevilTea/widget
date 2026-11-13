/**
 * Shared per-Runtime bookkeeping: the disposed guard and the alien-signals disposal handles Runtime owns;
 * plus the realm-wide callback scope that bounds the lifetime of a callback context's dependency and
 * `emit` callables and routes dependency-leaf diagnostics into the running operation-local collector.
 *
 * Normative contract: DevilTea/widget Discussion #12, Core composition architecture topic. Historical source (migrated): diagnostic #10 consolidated handoff §12 ("automatically insert wrapped consumer Diagnostics
 * into the active operation-local collector"), §19 (disposal), §17 (alien-signals adapter disposal
 * bookkeeping); Discussion #12 C0R159 (callback-context lifetime).
 */

import type { DedupeDescriptor } from './collector'
import { WidgetSystemRuntimeDisposedError } from '../diagnostic'
import { invokeListenerIsolated } from './adapter'

/**
 * The narrow surface dependency-leaf wrapping needs from the operation-local collector of the running
 * callback (a Property recompute or a Method invocation).
 */
export interface ActiveDiagnosticSink {
	addFinalizedDiagnostic: (diagnostic: unknown, dedupe?: DedupeDescriptor) => void
}

/**
 * One Property's `compute` or one Method's `execute`, shared by every invocation of that primitive. Its
 * dependency callables — and, for a Method, its widget's `emit` callables — are materialized once and
 * closed over this owner, so the lifetime check costs one comparison instead of re-wrapping `deps` on
 * every operation.
 */
export interface CallbackOwner {
	/** The diagnostic sink of this owner's innermost running invocation; `null` while none runs. */
	sink: ActiveDiagnosticSink | null
	/** The `emit` surface this owner's callback receives, or `null` (Property `compute`, no events). */
	readonly emitter: object | null
}

export function createCallbackOwner(emitter: object | null): CallbackOwner {
	return { sink: null, emitter }
}

/**
 * The innermost running `compute`/`execute` callback of this widget-core instance, across every Runtime.
 *
 * A dependency callable may run only while its own owner is the innermost running callback — not after
 * that callback returned or threw, and not from another callback running inside it. The second half is
 * what keeps a Property `compute` from ever writing State through a setter retained from a Method that is
 * still running further down the stack (a Property is the innermost callback while it evaluates; a
 * read-only Method it invokes is innermost while that Method runs). Realm-wide rather than per Runtime
 * so the same holds when the Method and the Property belong to different Runtimes.
 *
 * Code that is not such a callback never counts as one, even while it runs inside one: an external
 * listener (State, Property, diagnostics, Event, `WidgetDocument`, inspection) and a plugin callback that
 * owns no callables (`validate`, `validateArgs`, `default`, a dependency `.validate()` refinement, config
 * and structure callbacks) run with `owner` set to `null`, so a callable retained from the Method that
 * triggered them throws there; the owner is restored once that code returned or threw. What this cannot
 * tell apart is a callable retained from an earlier invocation of the same member and used during a later
 * one: the check compares members, not invocations (the one accepted gap).
 *
 * A mutable holder so callbacks save and restore it with plain assignments rather than calls: a restore
 * in a `finally` then still runs when runaway recursion has exhausted the stack, and each frame restores
 * the absolute value it saved, so one frame that cannot restore is corrected by the next.
 */
export const callbackScope: { owner: CallbackOwner | null } = { owner: null }

/**
 * Runs `run` with no callback open (see {@link callbackScope}) and restores the previous owner afterwards,
 * also when `run` throws. For code that is not a callback owning dependency or `emit` callables; hot paths
 * inline the same save/restore instead of allocating a closure.
 */
export function runOutsideCallbacks<Result>(run: () => Result): Result {
	const previousOwner = callbackScope.owner
	callbackScope.owner = null
	try {
		return run()
	}
	finally {
		callbackScope.owner = previousOwner
	}
}

/**
 * This Runtime's event-emit nesting, kept for the emit re-entrancy guard (see `createEventPrimitive`). A
 * mutable holder updated with plain assignments, so the bookkeeping survives an exhausted stack.
 */
export interface EmitNesting {
	/** How many of this Runtime's emits are on the stack. */
	depth: number
	/**
	 * The error unwinding a runaway emit loop — the re-entrancy guard's error or an engine stack overflow —
	 * while it is on its way out of this Runtime's nested emits; `null` otherwise. Cleared when the
	 * outermost emit leaves.
	 */
	unwinding: unknown
}

export interface RuntimeContext {
	isDisposed: () => boolean
	assertActive: () => void
	readonly emitNesting: EmitNesting
	/**
	 * Registers an alien-signals disposal handle created for a Runtime-owned public subscription.
	 * Returns an idempotent unsubscribe function safe to call before or after Runtime disposal.
	 */
	registerSubscription: (rawDispose: () => void) => () => void
	/**
	 * Registers a listener to run once, when the Runtime is disposed. Throws if the Runtime already is.
	 * Returns an idempotent unsubscribe function safe to call before or after Runtime disposal.
	 */
	subscribeDisposal: (listener: () => void) => () => void
	/**
	 * Marks the Runtime disposed, tears down every still-owned subscription, then delivers the disposal
	 * listeners (see `subscribeDisposal`). Idempotent.
	 */
	dispose: () => void
}

export function createRuntimeContext(): RuntimeContext {
	let disposed = false
	const owned = new Set<() => void>()
	// Disposal listeners in subscription order. One entry per registration, so registering the same function
	// twice stays two independent registrations. Emptied when delivery starts. An entry lets go of its listener once that ran or was
	// unsubscribed, so a kept unsubscribe handle never keeps the listener alive.
	let disposalListeners = new Set<{ listener: (() => void) | null }>()

	function assertActive(): void {
		if (disposed)
			throw new WidgetSystemRuntimeDisposedError()
	}

	return {
		isDisposed: () => disposed,
		assertActive,
		emitNesting: { depth: 0, unwinding: null },

		registerSubscription(rawDispose) {
			let unsubscribed = false
			const handle = () => {
				if (unsubscribed)
					return
				unsubscribed = true
				// `dispose()` tears the whole set down and clears it at once; removing entries one by one meanwhile
				// would only be bookkeeping on a set that is about to be emptied.
				if (!disposed)
					owned.delete(handle)
				rawDispose()
			}
			owned.add(handle)
			return handle
		},

		subscribeDisposal(listener) {
			assertActive()
			const entry: { listener: (() => void) | null } = { listener }
			disposalListeners.add(entry)
			return () => {
				// Once disposal began the entry is in the delivery snapshot, which runs it and then clears it.
				if (disposed)
					return
				disposalListeners.delete(entry)
				entry.listener = null
			}
		},

		dispose() {
			if (disposed)
				return
			// Mark disposed before tearing down so synchronous teardown reentrancy already observes it.
			disposed = true
			for (const handle of owned)
				handle()
			owned.clear()
			// Delivery runs on the list as it stood when disposal began, and the Runtime lets go of it first:
			// a listener removed meanwhile still runs, and none is retained once it has.
			const delivering = [...disposalListeners]
			disposalListeners = new Set()
			for (const entry of delivering) {
				const listener = entry.listener
				entry.listener = null
				if (listener !== null)
					invokeListenerIsolated(() => listener(), undefined)
			}
		},
	}
}
