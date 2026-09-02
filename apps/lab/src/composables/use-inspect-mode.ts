/**
 * Preview panel's Inspect-mode toggle/hover state (diagnostic #25 P2 "Preview -> semantic inspector bridge").
 *
 * Off by default. `active` gates every pointer/click behavior `PreviewPanel.vue` wires up around it;
 * flipping `active` back to `false` (via `toggle()`/`disable()`, or Escape while active) must restore
 * normal Preview behavior immediately — this composable owns exactly that state transition, nothing
 * about DOM highlighting/focus/tab-activation (that stays in `PreviewPanel.vue`, since it needs the
 * actual anchor DOM elements and the shared `LabStore`).
 *
 * The Escape listener is attached for this component's whole lifetime rather than only while
 * `active` — `PreviewPanel.vue` is one of the five canonical, never-closed panels (see this app's
 * `AGENTS.md`), so this composable's owner never remounts during ordinary Lab use; the listener itself
 * is a no-op whenever `active` is already `false`.
 */

import type { Ref } from 'vue'
import { onBeforeUnmount, onMounted, shallowRef } from 'vue'

export interface InspectHoverState {
	readonly widgetId: string
	readonly widgetType: string
	/** The hovered anchor element's `getBoundingClientRect()`, captured at hover time for badge placement. */
	readonly rect: DOMRect
}

export interface InspectMode {
	readonly active: Readonly<Ref<boolean>>
	readonly hovered: Readonly<Ref<InspectHoverState | null>>
	toggle: () => void
	disable: () => void
	setHovered: (state: InspectHoverState | null) => void
}

export function useInspectMode(): InspectMode {
	const active = shallowRef(false)
	const hovered = shallowRef<InspectHoverState | null>(null)

	function disable(): void {
		active.value = false
		hovered.value = null
	}

	function toggle(): void {
		if (active.value)
			disable()
		else
			active.value = true
	}

	function onKeydown(event: KeyboardEvent): void {
		if (event.key === 'Escape' && active.value)
			disable()
	}

	onMounted(() => document.addEventListener('keydown', onKeydown))
	onBeforeUnmount(() => document.removeEventListener('keydown', onKeydown))

	return {
		active,
		hovered,
		toggle,
		disable,
		setHovered: (state) => {
			hovered.value = state
		},
	}
}
