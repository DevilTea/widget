<script setup lang="ts">
/**
 * The right-hand header action of a Dockview group (Lab UX phase 3B): on the Tools group only, one button that maximizes the
 * group over the whole workbench and restores it, through Dockview's own group maximize (`group.api.maximize()` /
 * `exitMaximized()`). The Tools group shares the Preview's column, so an expert view that needs room (the Graph above all, which
 * would otherwise fit at about 0.37) gets the workbench without the user dragging dividers; restoring brings Edit/Explain and the
 * Preview back as they were.
 *
 * The button is named by what a press does ("Maximize tools" / "Restore tools"), so it carries no `aria-pressed` (a pressed
 * state would contradict a label that changes); `data-maximized` says the state for specs. Keyboard focus stays on it across
 * the toggle. Escape is not bound (Dockview binds none for maximize either): it already belongs to the Catalog dialog, the
 * menus and Monaco. Every other group renders nothing here.
 *
 * Dockview mounts this once per group with `{ api, containerApi, group, panels, ... }` and later passes partial updates (a
 * location change replaces `params` with `{ location }`), so the group and container are read once, at setup, and what the
 * group holds is followed through the container's panel events.
 */
import type { DockviewApi, DockviewGroupPanelApi, IDockviewGroupPanel } from 'dockview-vue'
import UButton from '@nuxt/ui/components/Button.vue'
import { computed, nextTick, onBeforeUnmount, shallowRef, useTemplateRef } from 'vue'
import { useLabI18n } from '../composables/use-lab-i18n'
import { isToolId } from '../lab/tools'

const props = defineProps<{
	params: {
		api: DockviewGroupPanelApi
		containerApi: DockviewApi
		group: IDockviewGroupPanel
	}
}>()

const i18n = useLabI18n()
const { api, containerApi, group } = props.params
const CANONICAL: ReadonlySet<string> = new Set(['edit', 'explain', 'tools', 'preview'])

/** The Tools group: it holds an expert view and none of the canonical panels (the rule `Workbench.vue` opens views into). */
const isToolsGroup = shallowRef(false)
const maximized = shallowRef(false)
function sync(): void {
	const ids = group.panels.map(panel => panel.id)
	isToolsGroup.value = ids.some(isToolId) && !ids.some(id => CANONICAL.has(id))
	maximized.value = containerApi.hasMaximizedGroup() && api.isMaximized()
}
sync()
const subscriptions = [
	containerApi.onDidAddPanel(sync),
	containerApi.onDidRemovePanel(sync),
	containerApi.onDidMovePanel(sync),
	containerApi.onDidMaximizedGroupChange(sync),
]
onBeforeUnmount(() => {
	for (const subscription of subscriptions)
		subscription.dispose()
})

const button = useTemplateRef<InstanceType<typeof UButton>>('button')
const label = computed(() => i18n.t(maximized.value ? 'Restore tools' : 'Maximize tools'))

function toggle(): void {
	if (api.isMaximized())
		api.exitMaximized()
	else
		api.maximize()
	sync()
	// Dockview lays the grid out again; keep keyboard focus on the button the user pressed.
	void nextTick(() => {
		const element = (button.value as unknown as { $el?: HTMLElement } | null)?.$el
		element?.focus()
	})
}
</script>

<template>
	<div
		v-if="isToolsGroup"
		class="flex h-full items-center pr-1"
	>
		<UButton
			ref="button"
			data-testid="tools-maximize"
			:data-maximized="String(maximized)"
			color="neutral"
			variant="ghost"
			size="xs"
			square
			:icon="maximized ? 'i-lucide-minimize-2' : 'i-lucide-maximize-2'"
			:aria-label="label"
			:title="label"
			class="text-muted outline-primary hover:text-default focus-visible:outline-2"
			@click="toggle"
		/>
	</div>
</template>
