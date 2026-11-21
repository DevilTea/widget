/**
 * The Nuxt UI pack as one component of the showcase root: it owns an element, mounts the pack's nested Vue app into it
 * (`./nested-app.ts`) once per mount and unmounts it when the pack is switched away or the page unmounts. It is loaded lazily
 * (a dynamic import in `../index.ts`), together with Nuxt UI, Tailwind and the pack's stylesheet.
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

		watch(() => props.runtime, (next) => {
			runtime.value = next
		})
		onMounted(() => {
			if (element.value !== null)
				nested = mountNuxtUiApp({ target: element.value, host, packs, runtime })
		})
		// Before Vue removes the element: the nested app unmounts its own tree first.
		onBeforeUnmount(() => {
			nested?.unmount()
			nested = null
		})

		return () => h('div', { 'ref': element, 'class': 'packs-nui-mount', 'data-testid': 'packs-nui-mount' })
	},
})
