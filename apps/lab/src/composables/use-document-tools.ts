/**
 * Document Tools open/activate request bridge.
 *
 * The panel is a developer aid, not a canonical workbench surface. Workbench owns the Dockview
 * add/activate side effect, matching the lazy Implementation explorer lifecycle.
 */
import type { InjectionKey, Ref } from 'vue'
import { inject, shallowRef } from 'vue'

export interface DocumentToolsStore {
	/** Bumped on every explicit open request; Workbench adds or activates the closable panel. */
	readonly openRequestTick: Readonly<Ref<number>>
	open: () => void
}

export const DocumentToolsKey: InjectionKey<DocumentToolsStore> = Symbol('widget-lab:document-tools')

export function createDocumentToolsStore(): DocumentToolsStore {
	const openRequestTick = shallowRef(0)
	return {
		openRequestTick,
		open: () => {
			openRequestTick.value++
		},
	}
}

export function useDocumentTools(): DocumentToolsStore {
	const store = inject(DocumentToolsKey)
	if (store === undefined)
		throw new Error('useDocumentTools() was called outside the DocumentToolsStore provider (App.vue).')
	return store
}
