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
 * A mutable holder so callbacks save and restore it with plain assignments rather than calls: a restore
 * in a `finally` then still runs when runaway recursion has exhausted the stack, and each frame restores
 * the absolute value it saved, so one frame that cannot restore is corrected by the next.
 */
export const callbackScope: { owner: CallbackOwner | null } = { owner: null }

export interface RuntimeContext {
	isDisposed: () => boolean
	assertActive: () => void
	/**
	 * Registers an alien-signals disposal handle created for a Runtime-owned public subscription.
	 * Returns an idempotent unsubscribe function safe to call before or after Runtime disposal.
	 */
	registerSubscription: (rawDispose: () => void) => () => void
	/**
	 * Marks the Runtime disposed and tears down every still-owned subscription. Idempotent.
	 */
	dispose: () => void
}

export function createRuntimeContext(): RuntimeContext {
	let disposed = false
	const owned = new Set<() => void>()

	function assertActive(): void {
		if (disposed)
			throw new WidgetSystemRuntimeDisposedError()
	}

	return {
		isDisposed: () => disposed,
		assertActive,

		registerSubscription(rawDispose) {
			let unsubscribed = false
			const handle = () => {
				if (unsubscribed)
					return
				unsubscribed = true
				owned.delete(handle)
				rawDispose()
			}
			owned.add(handle)
			return handle
		},

		dispose() {
			if (disposed)
				return
			// Mark disposed before tearing down so synchronous teardown reentrancy already observes it.
			disposed = true
			for (const handle of [...owned])
				handle()
			owned.clear()
		},
	}
}
