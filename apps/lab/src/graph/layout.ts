/**
 * `layoutGraph(graph): Promise<LayoutedGraph>` — the layout adapter boundary (diagnostic #13 Phase 5
 * "Dependency Graph implementation stack" / "ELK layout worker" comments).
 *
 * This module owns only the shared shape; the real ELK-worker-backed implementation is
 * `layout-client.ts`, and `layout-session.ts` wraps any `LayoutGraphFn` (real or a test fake) with
 * generation-guarded async request handling. Nothing here imports `elkjs` at the value level — that
 * import lives exclusively inside `layout.worker.ts`.
 */

import type { SemanticGraph } from './types'

export interface LayoutRect {
	readonly x: number
	readonly y: number
	readonly width: number
	readonly height: number
}

/** Positions/sizes keyed by the same ids `SemanticGraph` clusters/vertices/stubs already use. */
export interface LayoutedGraph {
	readonly clusters: ReadonlyMap<string, LayoutRect>
	readonly vertices: ReadonlyMap<string, LayoutRect>
	readonly stubs: ReadonlyMap<string, LayoutRect>
}

export type LayoutGraphFn = (graph: SemanticGraph) => Promise<LayoutedGraph>
