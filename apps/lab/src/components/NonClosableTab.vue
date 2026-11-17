<script setup lang="ts">
/**
 * Custom Dockview tab-content renderer for Workbench.vue's canonical panels (diagnostic #27 Finding 2).
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
 *
 * The Events tab also carries a small count of Events recorded while it was not the visible tab (issue #230, audit
 * U09): drawn, not announced (a tab is not a live region, so nothing is read out per Event), with the same count as
 * text for assistive technology in the tab's name, and `data-recording` says whether the log is subscribed. Read without subscribing
 * to anything.
 */
import type { DockviewPanelApi } from 'dockview-vue'
import { computed, inject, onBeforeUnmount, ref } from 'vue'
import { useEventLogTabState } from '../composables/use-event-log'
import { LabI18nKey } from '../composables/use-lab-i18n'
import { LabStoreKey } from '../composables/use-lab-store'

const props = defineProps<{
	params: {
		api: DockviewPanelApi
	}
}>()

// `api.title` is a plain getter, so follow `onDidTitleChange` to keep the tab in step when a title changes (the Lab
// language switch retitles the translated tabs).
const title = ref(props.params.api.title)
const titleChange = props.params.api.onDidTitleChange((event) => {
	title.value = event.title
})
onBeforeUnmount(() => titleChange.dispose())

const i18n = inject(LabI18nKey, null)
// Only the Events tab has a count, and only where the Lab store is provided (it is not in an isolated mount).
const eventsTab = props.params.api.id === 'events' && inject(LabStoreKey, null) !== null ? useEventLogTabState() : null
const unseen = eventsTab?.unseen ?? null
const unseenText = computed(() => {
	const count = unseen?.value ?? 0
	return count > 99 ? '99+' : String(count)
})
const unseenLabel = computed(() => {
	const count = unseen?.value ?? 0
	return i18n === null ? `${count} new` : i18n.t('{count} new', { count })
})
</script>

<template>
	<span
		:data-recording="eventsTab === null ? undefined : String(eventsTab.recording.value)"
		class="relative flex items-center h-full w-full whitespace-nowrap overflow-hidden text-ellipsis"
	>{{ title }}<template v-if="unseen !== null && unseen > 0"><span
		data-testid="events-unseen"
		aria-hidden="true"
		class="ml-1.5 inline-flex min-w-5 items-center justify-center rounded-full bg-primary px-1 text-[11px] leading-4 font-semibold text-inverted"
	>{{ unseenText }}</span><span class="sr-only">, {{ unseenLabel }}</span></template></span>
</template>
