<script setup lang="ts">
/**
 * The Tools tab (Lab UX phase 3B, design "information architecture"): the menu of expert views, each with a one-line
 * description. Choosing one opens it as its own closable, named tab in the Tools group beside the Preview (or focuses the tab
 * that is already open); it never opens inside the Edit/Explain group, so this menu stays where it is.
 *
 * It is a list of buttons, so it is operated like the rest of the page (Tab, Enter, Space), and the arrow keys, Home and End
 * also move between the entries. An open view is marked; the Events log entry carries the count of Events recorded while the
 * log was not visible, like the Tools tab itself (`NonClosableTab.vue`).
 *
 * This panel is also what keeps the Events log recording while the log is not open (`useEventLog`, as a consumer that is
 * never "visible"): Events are push-only and Core has no replay, so a Submit pressed before the log is opened must already be
 * in it. The Tools tab is canonical and mounted from the start, as the Events panel was while it was a canonical tab.
 */
import type { ToolId } from '../../lab/tools'
import { computed, shallowRef, useTemplateRef } from 'vue'
import { useEventLog } from '../../composables/use-event-log'
import { useLabI18n } from '../../composables/use-lab-i18n'
import { useLabStore } from '../../composables/use-lab-store'
import { useOpenTool } from '../../composables/use-open-tool'
import { TOOL_IDS, TOOL_TEXT } from '../../lab/tools'

const store = useLabStore()
const i18n = useLabI18n()
const openTool = useOpenTool()
// A consumer that is never visible: it keeps the log recording and leaves the unseen count to the log's own panel.
const eventLog = useEventLog(shallowRef(false))

const list = useTemplateRef<HTMLUListElement>('list')

const unseenText = computed(() => {
	const count = eventLog.unseen.value
	return count > 99 ? '99+' : String(count)
})

function buttons(): HTMLButtonElement[] {
	return [...(list.value?.querySelectorAll<HTMLButtonElement>('button[data-tool]') ?? [])]
}

function onKeydown(event: KeyboardEvent): void {
	const all = buttons()
	const index = all.indexOf(event.target as HTMLButtonElement)
	if (index === -1)
		return
	let next: number | null = null
	if (event.key === 'ArrowDown')
		next = Math.min(index + 1, all.length - 1)
	else if (event.key === 'ArrowUp')
		next = Math.max(index - 1, 0)
	else if (event.key === 'Home')
		next = 0
	else if (event.key === 'End')
		next = all.length - 1
	if (next === null)
		return
	event.preventDefault()
	all[next]?.focus()
}

function choose(tool: ToolId): void {
	openTool(tool)
}
</script>

<template>
	<div
		data-testid="tools-menu"
		class="flex h-full min-h-0 flex-col overflow-auto"
	>
		<p
			id="tools-menu-intro"
			class="m-0 border-b border-b-lab-border bg-lab-surface-alt px-2.5 py-1.5 text-[11px] text-lab-text-muted"
		>
			{{ i18n.t('Expert views. Each one opens in its own tab beside the Preview, so what you are reading stays here.') }}
		</p>
		<ul
			ref="list"
			role="list"
			class="m-0 flex list-none flex-col gap-1 p-2"
			:aria-label="i18n.t('Expert views')"
			@keydown="onKeydown"
		>
			<li
				v-for="tool in TOOL_IDS"
				:key="tool"
			>
				<button
					type="button"
					:data-tool="tool"
					:data-testid="`tools-entry-${tool}`"
					:data-open="String(store.openTools.value.has(tool))"
					:aria-labelledby="tool === 'events' && eventLog.unseen.value > 0 ? 'tools-entry-events-name' : `tools-entry-${tool}-label`"
					:aria-describedby="`tools-entry-${tool}-description${store.openTools.value.has(tool) ? ` tools-entry-${tool}-open` : ''}`"
					class="flex w-full cursor-pointer flex-col items-start gap-0.5 rounded-lab border border-lab-border bg-lab-surface px-2.5 py-1.5 text-left text-lab-text hover:bg-lab-surface-alt focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-lab-accent"
					@click="choose(tool)"
				>
					<span class="flex w-full items-center gap-1.5 text-xs font-semibold">
						<span :id="`tools-entry-${tool}-label`">{{ i18n.t(TOOL_TEXT[tool].menuLabel) }}</span>
						<template v-if="tool === 'events' && eventLog.unseen.value > 0">
							<span
								data-testid="tools-events-unseen"
								aria-hidden="true"
								class="inline-flex min-w-5 items-center justify-center rounded-full bg-primary px-1 text-[11px] leading-4 font-semibold text-inverted"
							>{{ unseenText }}</span>
							<span
								id="tools-entry-events-name"
								class="sr-only"
							>{{ i18n.t('{name}, {count} new', { name: i18n.t(TOOL_TEXT[tool].menuLabel), count: eventLog.unseen.value }) }}</span>
						</template>
						<span
							v-if="store.openTools.value.has(tool)"
							:id="`tools-entry-${tool}-open`"
							class="ml-auto text-[11px] font-normal text-lab-text-muted"
						>{{ i18n.t('(open)') }}</span>
					</span>
					<span
						:id="`tools-entry-${tool}-description`"
						class="text-[11px] text-lab-text-muted"
					>{{ i18n.t(TOOL_TEXT[tool].description) }}</span>
				</button>
			</li>
		</ul>
	</div>
</template>
