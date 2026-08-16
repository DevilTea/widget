/**
 * Implementation-panel open/activate request bridge (issue #25 P3 Scope D "Opening = `api.addPanel` if
 * absent else activate"). A small parallel mechanism, deliberately NOT an extension of
 * `use-lab-store.ts`'s `activeTab`/`LabToolTab` bridge: that bridge is scoped to the five canonical,
 * always-present, non-closable panels (`Workbench.vue`'s `onReady()` adds all five up front), while the
 * Implementation panel is closable and only ever added lazily, on first request — a materially
 * different Dockview lifecycle this store owns on its own rather than widening `LabToolTab`'s literal
 * union for a panel that is not one of the five canonical surfaces (issue #25 P1 gate review point 8:
 * "not a sixth canonical non-closable panel").
 *
 * `Workbench.vue` is the one consumer that turns `openRequestTick` into a real
 * `DockviewApi.addPanel()`/`.setActive()` call, mirroring `activeTab`'s own watch-driven bridge. Every
 * other caller (Preview's "View implementation" button, Blueprint's selected-node detail, the Survey
 * tour's step 8 link) only ever calls `open()` — none of them touch Dockview directly. `open()` does
 * NOT set focus itself: every call site is expected to already be showing/selecting the widget it wants
 * curated (Preview/Blueprint act on the widget the visitor just selected; the tutorial's `onEnter` hooks
 * already set focus per step) — the Implementation panel itself reads the existing shared
 * `LabStore.focus` reactively (see `ImplementationPanel.vue`), so there is no second focus-setting path
 * to keep in sync with the first.
 */

import type { InjectionKey, Ref } from 'vue'
import { inject, shallowRef } from 'vue'

export interface ImplementationExplorerStore {
	/** Bumped on every `open()` call — `Workbench.vue` watches this to add/activate the panel. */
	readonly openRequestTick: Readonly<Ref<number>>
	open: () => void
}

export const ImplementationExplorerKey: InjectionKey<ImplementationExplorerStore> = Symbol('widget-lab:implementation-explorer')

export function createImplementationExplorerStore(): ImplementationExplorerStore {
	const openRequestTick = shallowRef(0)
	return {
		openRequestTick,
		open: () => {
			openRequestTick.value++
		},
	}
}

export function useImplementationExplorer(): ImplementationExplorerStore {
	const store = inject(ImplementationExplorerKey)
	if (store === undefined)
		throw new Error('useImplementationExplorer() was called outside the ImplementationExplorerStore provider (App.vue).')
	return store
}
