/**
 * `createLayoutSession()` — generation-guarded async wrapper around any `LayoutGraphFn` (issue #13
 * Phase 5 "Graph layout is an asynchronous projection" comment).
 *
 * Framework-agnostic on purpose (no Vue import), mirroring `../lab/session.ts`'s plain-getter +
 * `subscribe()` shape: independently unit-testable with a fake/stub `LayoutGraphFn`, and reused as-is by
 * whichever Vue composable bridges it into refs. `request()` bumps an internal generation counter on
 * every call; a still-pending older request's resolution/rejection is discarded once a newer `request()`
 * has been made, so a layout result for a superseded snapshot never clobbers state for the current one.
 * Only the caller decides *when* to call `request()` (issue #13 Phase 5: only graph/topology/layout-
 * option changes trigger ELK work — Runtime state/property/method activity never relayouts).
 */

import type { LayoutedGraph, LayoutGraphFn } from './layout'
import type { SemanticGraph } from './types'

export type LayoutSessionState
	= | { readonly status: 'idle' }
		| { readonly status: 'loading', readonly graph: SemanticGraph }
		| { readonly status: 'ready', readonly graph: SemanticGraph, readonly layout: LayoutedGraph }
		| { readonly status: 'error', readonly graph: SemanticGraph, readonly error: unknown }

export interface LayoutSession {
	getState: () => LayoutSessionState
	subscribe: (listener: () => void) => () => void
	/** Requests a fresh layout for `graph`. Superseded by any later `request()` call. */
	request: (graph: SemanticGraph) => void
	/** Stops accepting new requests and discards any in-flight one. Idempotent. */
	dispose: () => void
}

export function createLayoutSession(layoutFn: LayoutGraphFn): LayoutSession {
	const listeners = new Set<() => void>()
	let state: LayoutSessionState = { status: 'idle' }
	let generation = 0
	let disposed = false

	function emit(): void {
		for (const listener of listeners) listener()
	}

	function setState(next: LayoutSessionState): void {
		state = next
		emit()
	}

	return {
		getState: () => state,

		subscribe: (listener) => {
			listeners.add(listener)
			return () => {
				listeners.delete(listener)
			}
		},

		request: (graph) => {
			if (disposed)
				return

			const myGeneration = ++generation
			setState({ status: 'loading', graph })

			layoutFn(graph)
				.then(
					(layout) => {
						if (disposed || myGeneration !== generation)
							return
						setState({ status: 'ready', graph, layout })
					},
					(error: unknown) => {
						if (disposed || myGeneration !== generation)
							return
						setState({ status: 'error', graph, error })
					},
				)
		},

		dispose: () => {
			disposed = true
			// A stale in-flight promise can no longer match any future generation.
			generation++
			listeners.clear()
		},
	}
}
