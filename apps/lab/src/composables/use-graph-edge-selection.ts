/**
 * Panel-local Dependency Graph edge selection (diagnostic #13 Phase 5 "inspector panel interaction
 * contract"). Graph edge selection is exactly the kind of panel-local, snapshot-bound selection that
 * comment calls out: it must reset when the applied Blueprint identity changes (a successful Apply —
 * `store.active.value.blueprint` becomes a new object even when the new Blueprint is invalid), it must
 * not reset on ordinary tab switching, and it must never touch the separate, persistent Dependency
 * Graph filter preferences (`LabStore.graphShowAbsent`/`graphShowIsolatedMembers`), which this module
 * does not even reference.
 *
 * Factored out of `GraphPanel.vue` into its own composable — like `use-runtime-member.ts` and
 * `use-dependency-graph.ts` — so this regression-worthy reset contract stays independently unit-testable
 * without mounting the (template-heavy, intentionally untested per this app's `AGENTS.md`) panel SFC.
 */

import type { Ref } from 'vue'
import type { GraphEdgeData } from '../graph/vue-flow'
import type { LabStore } from './use-lab-store'
import { shallowRef, watch } from 'vue'

export interface GraphEdgeSelection {
	readonly selected: Readonly<Ref<GraphEdgeData | null>>
	select: (edge: GraphEdgeData | null) => void
}

export function useGraphEdgeSelection(store: Pick<LabStore, 'active'>): GraphEdgeSelection {
	const selected = shallowRef<GraphEdgeData | null>(null)

	// Fires only on an applied-snapshot boundary crossing (a successful Apply/`applyPreset` — including
	// one that lands on an invalid Blueprint), never on draft edits, Apply start/end, revert, format, or
	// plain tab switching, all of which leave `active.value.blueprint`'s identity untouched.
	watch(
		() => store.active.value.blueprint,
		() => {
			selected.value = null
		},
	)

	return {
		selected,
		select: (edge) => {
			selected.value = edge
		},
	}
}
