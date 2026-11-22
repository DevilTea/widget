/**
 * The page of the "One document, two renderer packs" showcase: the page frame (intro, pack chooser, panes) around the packs'
 * renderers, with the **host** of one Runtime (`./packs-host.ts`: the pack choice, which is not widget State) provided to
 * everything below. It owns no Runtime. Both packs render the SAME Runtime the Lab inspects, so both stamp inspect anchors on
 * their renderer roots, and switching the pack never disposes or recreates the Runtime.
 *
 * - `./handwritten/`: plain Vue components with scoped CSS (part of this chunk);
 * - `./nuxt-ui/`: Nuxt UI components in a nested Vue app of their own (a lazy chunk: Nuxt UI, Tailwind and the pack's stylesheet).
 *
 * This module is a lazy chunk of its own, loaded by the facade (`./index.ts`); see there for why.
 */

import type { PropType } from 'vue'
import type { PacksRuntime } from '../system'
import { defineComponent, h, provide } from 'vue'
import { createPacksHost, PacksHostKey } from './packs-host'
import PacksFrame from './PacksFrame.vue'

export { HandWrittenRenderer } from './handwritten'
export type { PackChoice, PackId, PacksHost } from './packs-host'

/** One host for one Runtime: created when it mounts, dropped when it unmounts. */
const PacksHostScope = defineComponent({
	name: 'PacksHostScope',
	props: {
		runtime: { type: Object as PropType<PacksRuntime>, required: true },
	},
	setup(props) {
		provide(PacksHostKey, createPacksHost())
		return () => h(PacksFrame, { runtime: props.runtime })
	},
})

const hostKeys = new WeakMap<object, number>()
let nextHostKey = 1

export const RendererPacksRenderer = defineComponent({
	name: 'RendererPacksRenderer',
	props: {
		runtime: { type: Object as PropType<PacksRuntime>, required: true },
	},
	setup(props) {
		// A different Runtime is a different page: it gets its own host (and the default pack), not a re-pointed one.
		return () => {
			if (!hostKeys.has(props.runtime))
				hostKeys.set(props.runtime, nextHostKey++)
			return h(PacksHostScope, { runtime: props.runtime, key: hostKeys.get(props.runtime) })
		}
	},
})
