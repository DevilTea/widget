/**
 * Shared per-Runtime bookkeeping: the disposed guard, the active operation-local collector seam used
 * by dependency-leaf issue wrapping, and the alien-signals disposal handles Runtime owns.
 *
 * Normative source: issue #10 consolidated handoff §12 ("automatically insert wrapped consumer Issues
 * into the active operation-local collector"), §19 (disposal), §17 (alien-signals adapter disposal
 * bookkeeping).
 */

import { WidgetSystemRuntimeDisposedError } from '../issue'

/**
 * The narrow surface dependency-leaf wrapping needs from whichever operation-local collector is
 * currently in scope (a Property recompute or a Method invocation). Not a competing reactive engine:
 * plain save/restore bookkeeping mirroring alien-signals' own `getActiveSub`/`setActiveSub` seam.
 */
export interface ActiveIssueSink {
	addFinalizedIssue: (issue: unknown, dedupeKey?: string) => void
}

export interface RuntimeContext {
	isDisposed: () => boolean
	assertActive: () => void
	/**
	 * Runs `fn` with `collector` as the active issue sink for dependency-leaf wrapping, restoring the
	 * previous one afterward (including on throw).
	 */
	withActiveCollector: <R>(collector: ActiveIssueSink, fn: () => R) => R
	getActiveCollector: () => ActiveIssueSink | null
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
	let activeCollector: ActiveIssueSink | null = null
	const owned = new Set<() => void>()

	function assertActive(): void {
		if (disposed)
			throw new WidgetSystemRuntimeDisposedError()
	}

	return {
		isDisposed: () => disposed,
		assertActive,

		withActiveCollector(collector, fn) {
			const previous = activeCollector
			activeCollector = collector
			try {
				return fn()
			}
			finally {
				activeCollector = previous
			}
		},

		getActiveCollector: () => activeCollector,

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
