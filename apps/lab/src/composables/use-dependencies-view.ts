/**
 * Which view the Dependencies panel shows (Relations or Graph), shared per store so another panel can ask for the Graph:
 * the Explain tab's "Open dependency graph" (Lab UX phase 2) switches the view and opens the Dependencies view of the Tools
 * group (Lab UX phase 3B), whose tab then takes keyboard focus like every view opened from elsewhere.
 *
 * Presentation state only, like `graphShowAbsent`: it never touches the Document or the focus. It lives beside the store
 * (one per store, created on first use), not in `LabStore` itself, because only these panels read it. "Reset layout" puts
 * it back to Relations (`reset()`, called by `Workbench.vue`), as it did while the view was the panel's own state and the
 * rebuilt panel started over.
 */
import type { Ref } from 'vue'
import type { LabStore } from './use-lab-store'
import { shallowRef } from 'vue'
import { useLabStore } from './use-lab-store'

export type DependenciesView = 'graph' | 'relations'

export interface DependenciesViewState {
	/** Relations is the default (issue #230 PR 3b). */
	readonly view: Ref<DependenciesView>
	/** Shows the Graph and opens (or focuses) the Dependencies view in the Tools group. */
	openGraph: () => void
	/** Back to the default view (Relations). */
	reset: () => void
}

const views = new WeakMap<LabStore, Ref<DependenciesView>>()

export function useDependenciesView(): DependenciesViewState {
	const store = useLabStore()
	let view = views.get(store)
	if (view === undefined) {
		view = shallowRef<DependenciesView>('relations')
		views.set(store, view)
	}
	const shared = view
	return {
		view: shared,
		openGraph: () => {
			shared.value = 'graph'
			store.openTool('dependencies')
		},
		reset: () => {
			shared.value = 'relations'
		},
	}
}
