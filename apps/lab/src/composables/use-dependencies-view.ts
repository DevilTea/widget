/**
 * Which view the Dependencies panel shows (Relations or Graph), shared per store so another panel can ask for the Graph:
 * the Explain tab's "Open dependency graph" (Lab UX phase 2) switches the view and activates the Dependencies tab.
 *
 * Presentation state only, like `graphShowAbsent`: it never touches the Document or the focus. It lives beside the store
 * (one per store, created on first use), not in `LabStore` itself, because only these two panels read it.
 */
import type { Ref } from 'vue'
import type { LabStore } from './use-lab-store'
import { shallowRef } from 'vue'
import { useLabStore } from './use-lab-store'

export type DependenciesView = 'graph' | 'relations'

export interface DependenciesViewState {
	/** Relations is the default (issue #230 PR 3b). */
	readonly view: Ref<DependenciesView>
	/** Shows the Graph and brings the Dependencies tab to the front. */
	openGraph: () => void
}

const states = new WeakMap<LabStore, Ref<DependenciesView>>()

export function useDependenciesView(): DependenciesViewState {
	const store = useLabStore()
	let view = states.get(store)
	if (view === undefined) {
		view = shallowRef<DependenciesView>('relations')
		states.set(store, view)
	}
	const shared = view
	return {
		view: shared,
		openGraph: () => {
			shared.value = 'graph'
			store.activeTab.value = 'dependencies'
		},
	}
}
