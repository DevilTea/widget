/**
 * `layoutGraph()` — the real, Worker-backed `LayoutGraphFn` (issue #13 Phase 5 "Dependency Graph worker
 * loading" comment).
 *
 * One persistent Vite module Worker for the Lab's lifetime, created lazily on first use rather than a
 * one-shot Blob Worker per layout request. `layout.worker.ts` makes that Worker *be* elkjs's own worker
 * side (`elk-worker.js`, self-registering `self.onmessage`); this module supplies elkjs's `ELK`
 * orchestrator class (`elk-api.js`, the lightweight requesting-side promise/request-id wrapper) with a
 * `workerFactory` that returns our persistent Worker instead of letting `ELK` spawn its own — reusing
 * elkjs's own protocol/bookkeeping rather than hand-rolling a second one. Worker transport is hidden
 * entirely behind the `layoutGraph(graph): Promise<LayoutedGraph>` adapter boundary; callers needing
 * generation-guarded staleness handling compose this with `createLayoutSession()` (`layout-session.ts`).
 */

import type { ELK as ElkInstance, ElkNode } from 'elkjs/lib/elk-api'
import type { LayoutGraphFn } from './layout'
import ELK from 'elkjs/lib/elk-api'
import { fromElkResult, toElkGraph } from './elk-adapter'

let worker: Worker | null = null
let elk: ElkInstance | null = null

function ensureElk(): ElkInstance {
	if (elk !== null)
		return elk

	// Vite native module-worker integration (issue #13 Phase 5 comment) — not `useWebWorkerFn` and not a
	// Blob Worker, so Vite owns bundling/code-splitting for `layout.worker.ts` and its `elkjs` import.
	worker = new Worker(new URL('./layout.worker.ts', import.meta.url), { type: 'module' })
	elk = new ELK({ workerFactory: () => worker! })
	return elk
}

/** The `layoutGraph(graph): Promise<LayoutedGraph>` adapter (issue #13 Phase 5 implementation stack). */
export const layoutGraph: LayoutGraphFn = async (graph) => {
	const result = await ensureElk()
		.layout(toElkGraph(graph))
	return fromElkResult(result as ElkNode, graph)
}

/**
 * Application/component lifecycle cleanup (issue #13 Phase 5: "Worker shutdown is app lifecycle
 * cleanup"). Does not touch widget-core Runtime ownership/disposal semantics — this only tears down the
 * Lab-local layout transport.
 */
export function disposeLayoutWorker(): void {
	elk?.terminateWorker()
	elk = null
	worker = null
}
