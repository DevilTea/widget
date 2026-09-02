/**
 * Implementation-panel open/activate request bridge.
 *
 * The panel remains a closable, lazily-added Dockview surface rather than a sixth canonical Lab tab.
 * Every caller routes through `open()`; Workbench owns the actual `addPanel`/activation side effect.
 *
 * Diagnostic #42 adds a second explorer mode without changing the shared widget-focus model:
 *
 * - `focused` is the existing contextual inspector. Existing Preview/Blueprint/tutorial callers use
 *   this default and the panel resolves whatever `LabStore.focus` already points at.
 * - `catalog` is a passive, plugin-type browser over the current showcase's existing `SourcesRegistry`.
 *   It is requested directly from the header and never creates/changes widget focus.
 *
 * `requestedMode` is request metadata, not semantic/application state. It only tells a newly-mounted or
 * already-open Implementation panel which presentation mode the latest explicit open request intended.
 */

import type { InjectionKey, Ref } from 'vue'
import { inject, shallowRef } from 'vue'

export type ImplementationExplorerMode = 'focused' | 'catalog'

export interface ImplementationExplorerStore {
	/** Bumped on every `open()` call — `Workbench.vue` watches this to add/activate the panel. */
	readonly openRequestTick: Readonly<Ref<number>>
	/** Presentation mode requested by the most recent explicit `open()` call. */
	readonly requestedMode: Readonly<Ref<ImplementationExplorerMode>>
	/** Existing call sites default to the focused-widget flow; header/catalog entry opts into `catalog`. */
	open: (mode?: ImplementationExplorerMode) => void
}

export const ImplementationExplorerKey: InjectionKey<ImplementationExplorerStore> = Symbol('widget-lab:implementation-explorer')

export function createImplementationExplorerStore(): ImplementationExplorerStore {
	const openRequestTick = shallowRef(0)
	const requestedMode = shallowRef<ImplementationExplorerMode>('focused')
	return {
		openRequestTick,
		requestedMode,
		open: (mode = 'focused') => {
			requestedMode.value = mode
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
