/**
 * Workbench layout request bridge (audit U12), parallel to `use-document-tools.ts`: the overflow menu asks, and
 * `Workbench.vue` owns the Dockview side effect (clear the saved layout, rebuild the default one).
 */
import type { InjectionKey, Ref } from 'vue'
import { inject, shallowRef } from 'vue'

export interface WorkbenchLayoutStore {
	/** Bumped on every explicit "Reset layout" request. */
	readonly resetRequestTick: Readonly<Ref<number>>
	requestReset: () => void
}

export const WorkbenchLayoutKey: InjectionKey<WorkbenchLayoutStore> = Symbol('widget-lab:workbench-layout')

export function createWorkbenchLayoutStore(): WorkbenchLayoutStore {
	const resetRequestTick = shallowRef(0)
	return {
		resetRequestTick,
		requestReset: () => {
			resetRequestTick.value++
		},
	}
}

export function useWorkbenchLayout(): WorkbenchLayoutStore {
	const store = inject(WorkbenchLayoutKey)
	if (store === undefined)
		throw new Error('useWorkbenchLayout() was called outside the WorkbenchLayoutStore provider (App.vue).')
	return store
}
