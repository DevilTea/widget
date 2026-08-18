import type { Ref } from 'vue'
import { onBeforeUnmount, onMounted, shallowRef } from 'vue'

export const MIN_SUPPORTED_WORKBENCH_WIDTH = 900
const QUERY = `(min-width: ${MIN_SUPPORTED_WORKBENCH_WIDTH}px)`

/**
 * Presentation-only mirror of #27's CSS viewport gate. The workbench stays mounted on either side of
 * the threshold; consumers use this only to avoid putting native modal dialogs in the browser top
 * layer while the unsupported-width gate owns the experience.
 */
export function useSupportedWorkbenchViewport(): Readonly<Ref<boolean>> {
	const supported = shallowRef(typeof matchMedia !== 'function' || matchMedia(QUERY).matches)
	let media: MediaQueryList | null = null

	function onChange(event: MediaQueryListEvent): void {
		supported.value = event.matches
	}

	onMounted(() => {
		if (typeof matchMedia !== 'function')
			return
		media = matchMedia(QUERY)
		supported.value = media.matches
		media.addEventListener('change', onChange)
	})

	onBeforeUnmount(() => media?.removeEventListener('change', onChange))

	return supported
}
