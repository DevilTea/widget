<script setup lang="ts">
/**
 * Custom Dockview tab-content renderer for Workbench.vue's five canonical panels (issue #27 Finding 2).
 *
 * Dockview's own `Tab` class (drag/drop, click-to-activate, active/inactive tab styling — see
 * `dockview-core`'s `dockview/components/tab/tab.d.ts`) is a wrapper the host app never touches; it hosts
 * whatever `ITabRenderer` the panel's `tabComponent` resolves to as its *content* only. The built-in
 * content (`DefaultTab`) renders a title plus a close button. Registering this component as
 * `tabComponents.nonClosable` in `Workbench.vue` and selecting it via `AddPanelOptions.tabComponent` on
 * each canonical panel's `addPanel()` call replaces only that content — so these tabs render a title and
 * nothing else, with no close affordance to click, while every other Dockview affordance the wrapper
 * itself owns (drag to reorder/dock, resize, click to activate) keeps working untouched.
 *
 * `dockview-vue`'s bridge (`VueRenderer.init`, see `dockview-vue`'s `utils.d.ts`/compiled source) mounts
 * this component with a single `params` prop shaped `{ params, api, containerApi, tabLocation }` — the
 * panel's own title is not forwarded separately, so it is read from `api.title`
 * (`DockviewPanelApi.title`) instead.
 */
import type { DockviewPanelApi } from 'dockview-vue'

const props = defineProps<{
	params: {
		api: DockviewPanelApi
	}
}>()
</script>

<template>
	<span
		:class="pika({ position: 'relative', display: 'flex', alignItems: 'center', height: '100%', width: '100%', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' })"
	>{{ props.params.api.title }}</span>
</template>
