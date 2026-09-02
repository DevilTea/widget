/**
 * Panel-local Dependency Graph edge selection (diagnostic #13 Phase 5 "inspector panel interaction
 * contract"). Graph edge selection is exactly the kind of panel-local, snapshot-bound selection that
 * comment calls out: it must reset when the committed Document Blueprint identity changes (including
 * an invalid committed Blueprint), it must
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

export function useGraphEdgeSelection(store: Pick<LabStore, 'documentState'>): GraphEdgeSelection {
	const selected = shallowRef<GraphEdgeData | null>(null)

	// The promoted snapshot receives a new Blueprint identity only after a changed Document commit is
	// ready to replace the old Runtime-facing snapshot. A structural `changed:false` Apply retains that
	// identity, so text-only representation changes do not clear panel-local graph selection. Showcase
	// replacement also supplies a new Blueprint identity even though its Document restarts at revision 0.
	watch(
		() => store.documentState.value.blueprint,
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
