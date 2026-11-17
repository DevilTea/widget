import type { Ref } from 'vue'
import { onScopeDispose, shallowRef } from 'vue'

/** The part of Dockview's panel API this composable reads (`DockviewPanelApi`). */
export interface PanelVisibilityApi {
	readonly isVisible: boolean
	readonly onDidVisibilityChange: (listener: (event: { readonly isVisible: boolean }) => void) => { dispose: () => void }
}

/**
 * Whether a Dockview panel is the tab currently shown in its group. The canonical panels stay mounted while their tab
 * is hidden, so a panel that talks to the Preview frame uses this to stop while nobody can see it. Without a panel API
 * (a unit test, or a component used outside Dockview) the panel counts as visible.
 */
export function usePanelVisibility(api: PanelVisibilityApi | undefined): Readonly<Ref<boolean>> {
	const visible = shallowRef(api?.isVisible ?? true)
	if (api !== undefined) {
		const subscription = api.onDidVisibilityChange((event) => {
			visible.value = event.isVisible
		})
		onScopeDispose(() => subscription.dispose())
	}
	return visible
}
