/**
 * Keyboard focus after a control removes or disables itself. A button that is replaced, removed or disabled by the render
 * that its own click causes leaves focus on `body`, so the renderers move it to the nearest sensible control once the new
 * DOM is in the page (the pattern of the onboarding showcase's `focusWhenRendered`).
 */

import { nextTick } from 'vue'

/** Focuses what `find` returns once it is in the page: the render that shows it follows the host's write, so wait a few ticks at most. */
export async function focusWhenRendered(find: () => HTMLElement | null | undefined): Promise<void> {
	for (let attempt = 0; attempt < 5; attempt++) {
		await nextTick()
		const target = find()
		if (target !== null && target !== undefined) {
			target.focus()
			return
		}
	}
}
