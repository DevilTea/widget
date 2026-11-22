/**
 * Whether the Explain tab is on screen, shared per store (Lab UX phase 2). Preview Inspect reads it: a widget picked with
 * Inspect while Explain is showing stays in Explain instead of switching to Selected widget, so the Explain empty card's
 * "Click a widget in the Preview (Inspect)" does what it says. Reading it subscribes to nothing.
 */
import type { Ref } from 'vue'
import type { LabStore } from './use-lab-store'
import { computed, onScopeDispose, shallowRef, watch } from 'vue'
import { useLabStore } from './use-lab-store'

const counts = new WeakMap<LabStore, Ref<number>>()

function countOf(store: LabStore): Ref<number> {
	let count = counts.get(store)
	if (count === undefined) {
		count = shallowRef(0)
		counts.set(store, count)
	}
	return count
}

/** Called by the Explain panel with its Dockview visibility. */
export function reportExplainVisibility(visible: Readonly<Ref<boolean>>): void {
	const count = countOf(useLabStore())
	let counted = false
	const stop = watch(visible, (isVisible) => {
		if (isVisible === counted)
			return
		counted = isVisible
		count.value += isVisible ? 1 : -1
	}, { immediate: true, flush: 'sync' })
	onScopeDispose(() => {
		stop()
		if (counted)
			count.value -= 1
		counted = false
	})
}

/** `true` while the Explain tab is the visible panel of its group. */
export function useExplainVisible(): Readonly<Ref<boolean>> {
	const count = countOf(useLabStore())
	return computed(() => count.value > 0)
}
