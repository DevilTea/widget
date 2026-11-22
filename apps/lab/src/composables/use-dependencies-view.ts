/**
 * Which view the Dependencies panel shows (Relations or Graph), shared per store so another panel can ask for the Graph:
 * the Explain tab's "Open dependency graph" (Lab UX phase 2) switches the view, activates the Dependencies tab and asks the
 * panel to move keyboard focus to its Graph tab (the control the user's activation lands on, as with the arrow keys).
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
	/** Bumped by `openGraph()`; the Dependencies panel focuses its Graph tab when it changes. */
	readonly focusGraphRequest: Readonly<Ref<number>>
	/** Shows the Graph, brings the Dependencies tab to the front and asks for focus on the Graph tab. */
	openGraph: () => void
	/** Back to the default view (Relations). */
	reset: () => void
}

interface Shared {
	readonly view: Ref<DependenciesView>
	readonly focusGraphRequest: Ref<number>
}

const states = new WeakMap<LabStore, Shared>()

export function useDependenciesView(): DependenciesViewState {
	const store = useLabStore()
	let shared = states.get(store)
	if (shared === undefined) {
		shared = { view: shallowRef<DependenciesView>('relations'), focusGraphRequest: shallowRef(0) }
		states.set(store, shared)
	}
	const { view, focusGraphRequest } = shared
	return {
		view,
		focusGraphRequest,
		openGraph: () => {
			view.value = 'graph'
			store.activeTab.value = 'dependencies'
			focusGraphRequest.value++
		},
		reset: () => {
			view.value = 'relations'
		},
	}
}
