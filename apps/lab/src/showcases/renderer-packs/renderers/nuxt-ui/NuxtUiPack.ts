/**
 * The Nuxt UI pack as one component of the showcase root: it owns an element, mounts the pack's nested Vue app into it
 * (`./nested-app.ts`) once per mount and unmounts it when the pack is switched away or the page unmounts. It is loaded lazily
 * (a dynamic import in `../index.ts`), together with Nuxt UI, Tailwind and the pack's stylesheet.
 *
 * The pack's stylesheet is part of the frame document only while a pack is mounted (`./pack-styles.ts`): this component acquires it
 * when it mounts and releases it when it unmounts, once each, and the last release takes it out. A mount after that waits for it to be
 * put back and loaded, so the pack is never drawn unstyled; the first mount (the lazy chunk has just loaded its stylesheet) mounts at
 * once. A pack switched away while it waits mounts nothing and still releases, and releases only its own hold, so the pack that
 * replaced it keeps the stylesheet.
 *
 * It never touches the Runtime: a Runtime that is replaced reaches the nested app through a ref, and the pack's root renderer
 * remounts for the new Runtime like any `@deviltea/widget-vue` root.
 */

import type { PropType } from 'vue'
import type { PacksRuntime } from '../../system'
import type { NestedNuxtUiApp } from './nested-app'
import { defineComponent, h, onBeforeUnmount, onMounted, ref, shallowRef, watch } from 'vue'
import { useShowcaseHost } from '../../../../showcase-host'
import { requirePacksHost } from '../use-packs-text'
import { mountNuxtUiApp } from './nested-app'
import { acquirePackStyles, releasePackStyles } from './pack-styles'

export const NuxtUiPack = defineComponent({
	name: 'NuxtUiPack',
	props: {
		runtime: { type: Object as PropType<PacksRuntime>, required: true },
	},
	setup(props) {
		const host = useShowcaseHost()
		const packs = requirePacksHost()
		const element = ref<HTMLElement | null>(null)
		const runtime = shallowRef(props.runtime)
		let nested: NestedNuxtUiApp | null = null
		let gone = false

		watch(() => props.runtime, (next) => {
			runtime.value = next
		})
		onMounted(() => {
			const mount = (): void => {
				// Switched away while the stylesheet was coming back: nothing to mount (the release is the unmount hook's).
				if (!gone && element.value !== null)
					nested = mountNuxtUiApp({ target: element.value, host, packs, runtime })
			}
			const restoring = acquirePackStyles()
			if (restoring === null)
				mount()
			else
				void restoring.then(mount)
		})
		// Before Vue removes the element: the nested app unmounts its own tree first.
		onBeforeUnmount(() => {
			gone = true
			nested?.unmount()
			nested = null
			releasePackStyles()
		})

		return () => h('div', { 'ref': element, 'class': 'packs-nui-mount', 'data-testid': 'packs-nui-mount' })
	},
})
