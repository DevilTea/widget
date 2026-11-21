/**
 * Repair desk Vue renderer registry, registered against `repairSystem` through the public `@deviltea/widget-vue` contract
 * only (`createWidgetVueRenderer`). Every plugin has exactly one renderer registration (the registry is exhaustive by
 * construction). The notice board system's own renderers (`./board/`) are separate and only used for the preview.
 *
 * `DocumentRepairRenderer` is the component the Lab mounts: the registry's own renderer wrapped in the **host** that owns the
 * Runtime (`./repair-host.ts`). The host plays the notice-board application (it opens the editing sessions) and releases
 * every session and preview Runtime when the Preview unmounts the page or replaces the Runtime.
 */

import type { PropType } from 'vue'
import type { RepairRuntime } from '../system'
import { createWidgetVueRenderer } from '@deviltea/widget-vue'
import { defineComponent, h, onScopeDispose, provide } from 'vue'
import { repairSystem } from '../system'
import { createRepairHost, RepairHostKey } from './repair-host'
import RepairDeskRenderer from './RepairDeskRenderer.vue'
import SavedDraftRenderer from './SavedDraftRenderer.vue'

export const RepairWidgetRenderer = createWidgetVueRenderer(repairSystem, renderers =>
	renderers
		.RepairDesk(RepairDeskRenderer)
		.SavedDraft(SavedDraftRenderer))

/** One host for one Runtime: created when it mounts, disposed when it unmounts. */
const RepairHostScope = defineComponent({
	name: 'RepairHostScope',
	props: {
		runtime: { type: Object as PropType<RepairRuntime>, required: true },
	},
	setup(props) {
		const { host, dispose } = createRepairHost(props.runtime)
		provide(RepairHostKey, host)
		onScopeDispose(dispose)
		return () => h(RepairWidgetRenderer, { runtime: props.runtime })
	},
})

const hostKeys = new WeakMap<object, number>()
let nextHostKey = 1

export const DocumentRepairRenderer = defineComponent({
	name: 'DocumentRepairRenderer',
	props: {
		runtime: { type: Object as PropType<RepairRuntime>, required: true },
	},
	setup(props) {
		// A different Runtime is a different desk: it gets its own host (and sessions), not a re-pointed one.
		return () => {
			if (!hostKeys.has(props.runtime))
				hostKeys.set(props.runtime, nextHostKey++)
			return h(RepairHostScope, { runtime: props.runtime, key: hostKeys.get(props.runtime) })
		}
	},
})
