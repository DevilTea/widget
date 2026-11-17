<script setup lang="ts">
import type { PanelVisibilityApi } from '../../composables/use-panel-visibility'
import type { WidgetIdentity } from '../../events/event-log'
/**
 * The live Events log (issue #230, audit U09): every Event the running Preview's widgets emit, as it happens. The
 * data plane is the Inspector protocol alone (`runtime.subscribeEvent` / `runtime.eventOccurred`, see
 * `composables/use-event-log.ts`); this panel never receives a Core Runtime and cannot emit. It listens only while
 * its tab is the visible one: the log is recorded while the panel is mounted (see `composables/use-event-log.ts`), so what
 * happened while another tab was open is here when this one is opened.
 */
import UButton from '@nuxt/ui/components/Button.vue'
import { computed, onScopeDispose, ref, shallowRef, watch } from 'vue'
import { useEventLog } from '../../composables/use-event-log'
import { useLabI18n } from '../../composables/use-lab-i18n'
import { useLabStore } from '../../composables/use-lab-store'
import { usePanelVisibility } from '../../composables/use-panel-visibility'
import { EVENT_LOG_LIMIT, isSameWidget, visibleEventLogEntries } from '../../events/event-log'
import { getRuntimeInspectorSource } from '../../runtime-inspector/source'
import EventLogEntryRow from '../events/EventLogEntryRow.vue'
import InspectorPanelShell from '../inspector/InspectorPanelShell.vue'

const props = defineProps<{ params?: { api?: PanelVisibilityApi } }>()
const store = useLabStore()
const i18n = useLabI18n()
const visible = usePanelVisibility(props.params?.api)
const log = useEventLog(visible)

const source = computed(() => getRuntimeInspectorSource(store.preview.value, store.documentState.value.revision))
const connection = computed(() => store.previewHost.connection.value)

// Filters (this panel's own state; the log itself is shared).
const widgetFilter = ref('')
const eventFilter = ref('')
const onlySelected = ref(false)

/** The widget selected in the Preview, by id and type: entries carry those, not a node id of a Runtime that may be gone. */
const selectedWidget = computed<WidgetIdentity | null>(() => {
	const nodeId = store.previewFocus.value?.nodeId
	const node = nodeId === undefined ? undefined : connection.value?.blueprint.nodes.find(candidate => candidate.nodeId === nodeId)
	return node?.resolved && node.widgetId !== undefined && node.widgetType !== undefined ? { widgetId: node.widgetId, widgetType: node.widgetType } : null
})

const widgetOptions = computed(() => [...new Set([
	...log.emitters.value.map(widget => widget.widgetId),
	...log.entries.value.map(entry => entry.widgetId),
	...(widgetFilter.value === '' ? [] : [widgetFilter.value]),
])].sort())
const eventOptions = computed(() => [...new Set([
	...log.emitters.value.flatMap(widget => widget.events),
	...log.entries.value.map(entry => entry.event),
	...(eventFilter.value === '' ? [] : [eventFilter.value]),
])].sort())

const shown = computed(() => visibleEventLogEntries(log.entries.value, {
	widgetId: widgetFilter.value === '' ? null : widgetFilter.value,
	event: eventFilter.value === '' ? null : eventFilter.value,
	// "Only the selected widget" with nothing selected shows nothing rather than everything.
	onlySelected: onlySelected.value,
	selectedWidget: selectedWidget.value,
}))
const filtering = computed(() => widgetFilter.value !== '' || eventFilter.value !== '' || onlySelected.value)

/** The node of the current Preview that is this entry's widget, when it still has one. */
function currentNodeId(entry: { readonly widgetId: string, readonly widgetType: string }): number | null {
	const node = connection.value?.blueprint.nodes.find(candidate => candidate.resolved && candidate.widgetId === entry.widgetId && candidate.widgetType === entry.widgetType)
	return node?.nodeId ?? null
}

function select(entry: { readonly widgetId: string, readonly widgetType: string }): void {
	const nodeId = currentNodeId(entry)
	if (nodeId !== null)
		store.setFocus('preview', { nodeId })
}

// A polite live region that does not announce every occurrence: a count that settles after a quiet moment, and what
// Pause/Resume/Clear did.
const announcement = shallowRef('')
let settleTimer: ReturnType<typeof setTimeout> | null = null

function clearLog(): void {
	log.clear()
	announcement.value = i18n.t('Events log cleared')
}

function togglePaused(): void {
	const next = !log.paused.value
	log.setPaused(next)
	announcement.value = next ? i18n.t('Events log paused') : i18n.t('Events log resumed')
}

watch(() => log.entries.value.length + log.dropped.value, (total) => {
	if (settleTimer !== null)
		clearTimeout(settleTimer)
	settleTimer = null
	if (total === 0)
		return
	settleTimer = setTimeout(() => {
		settleTimer = null
		const count = log.entries.value.length
		announcement.value = i18n.t(count === 1 ? '{count} Event recorded' : '{count} Events recorded', { count })
	}, 1000)
})
onScopeDispose(() => {
	if (settleTimer !== null)
		clearTimeout(settleTimer)
})

const listeningText = computed(() => {
	const listening = log.listening.value
	switch (listening.state) {
		case 'no-preview': return i18n.t('No valid preview to listen to: fix the problems and Apply, and Events will be recorded from the new preview.')
		case 'loading': return i18n.t('Waiting for the preview to load. Events are recorded once it is running.')
		case 'lost': return i18n.t('The preview is not connected, so no Events are being recorded. Use Try again in the preview, or Apply again.')
		case 'no-events': return i18n.t('The widgets in this preview declare no Events, so there is nothing to record.')
		case 'listening': {
			const events = i18n.t(listening.events === 1 ? '{count} declared Event' : '{count} declared Events', { count: listening.events })
			const widgets = i18n.t(listening.widgets === 1 ? '{count} widget' : '{count} widgets', { count: listening.widgets })
			const listened = i18n.t('Listening to {events} on {widgets}.', { events, widgets })
			return listening.failed === 0
				? listened
				: `${listened} ${i18n.t(listening.failed === 1 ? 'Could not subscribe to {count} Event.' : 'Could not subscribe to {count} Events.', { count: listening.failed })}`
		}
		default: return ''
	}
})

const selectClass = 'h-6 min-w-0 max-w-44 rounded-(--lab-radius) border border-default bg-default px-1.5 font-mono text-[11px] text-default focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-primary'
</script>

<template>
	<InspectorPanelShell
		storageKey="widget-lab:panel-desc:events"
		text="Events the running widgets emit, listed as they happen, also while another tab is open. The latest 500 are kept"
	>
		<div
			data-testid="events-panel"
			class="flex min-h-0 flex-1 flex-col"
		>
			<div class="flex flex-wrap items-center gap-x-2 gap-y-1 border-b border-default px-2 py-1 text-[11px]">
				<strong data-testid="events-revision">{{ i18n.t(source.previewRevision === null ? 'Preview unavailable' : 'Preview r{revision}', { revision: source.previewRevision ?? '' }) }}</strong>
				<UButton
					data-testid="events-pause"
					color="neutral"
					variant="outline"
					size="xs"
					:icon="log.paused.value ? 'i-lucide-play' : 'i-lucide-pause'"
					:label="log.paused.value ? i18n.t('Resume') : i18n.t('Pause')"
					class="outline-primary focus-visible:outline-2"
					@click="togglePaused"
				/>
				<UButton
					data-testid="events-clear"
					color="neutral"
					variant="outline"
					size="xs"
					icon="i-lucide-trash-2"
					:label="i18n.t('Clear')"
					class="outline-primary focus-visible:outline-2"
					@click="clearLog"
				/>
				<label class="flex items-center gap-1">
					<span class="text-muted">{{ i18n.t('Widget') }}</span>
					<select
						v-model="widgetFilter"
						data-testid="events-filter-widget"
						:class="selectClass"
					>
						<option value="">{{ i18n.t('All widgets') }}</option>
						<option
							v-for="id in widgetOptions"
							:key="id"
							:value="id"
						>{{ id }}</option>
					</select>
				</label>
				<label class="flex items-center gap-1">
					<span class="text-muted">Event</span>
					<select
						v-model="eventFilter"
						data-testid="events-filter-event"
						:class="selectClass"
					>
						<option value="">{{ i18n.t('All Events') }}</option>
						<option
							v-for="name in eventOptions"
							:key="name"
							:value="name"
						>{{ name }}</option>
					</select>
				</label>
				<label class="flex min-h-6 cursor-pointer items-center gap-1">
					<input
						v-model="onlySelected"
						type="checkbox"
						data-testid="events-only-selected"
						class="size-6 cursor-pointer accent-primary focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-primary"
					>
					<span>{{ i18n.t('Only the selected widget') }}</span>
				</label>
			</div>

			<div
				data-testid="events-status"
				class="flex flex-col gap-0.5 border-b border-default px-2 py-1 text-[11px] text-muted"
			>
				<span data-testid="events-listening">{{ listeningText }}</span>
				<span
					v-if="log.paused.value"
					data-testid="events-paused-note"
				>{{ log.skippedWhilePaused.value > 0
					? i18n.t(log.skippedWhilePaused.value === 1 ? 'Paused: {count} Event was not recorded.' : 'Paused: {count} Events were not recorded.', { count: log.skippedWhilePaused.value })
					: i18n.t('Paused: Events that happen now are not recorded.') }}</span>
				<span
					v-else-if="log.skippedWhilePaused.value > 0"
					data-testid="events-paused-note"
				>{{ i18n.t(log.skippedWhilePaused.value === 1 ? '{count} Event was not recorded while the log was paused.' : '{count} Events were not recorded while the log was paused.', { count: log.skippedWhilePaused.value }) }}</span>
				<span
					v-if="log.dropped.value > 0"
					data-testid="events-dropped-note"
					class="text-warning"
				>{{ i18n.t(log.dropped.value === 1 ? 'Showing the latest {limit} Events: {count} older one was dropped.' : 'Showing the latest {limit} Events: {count} older ones were dropped.', { limit: EVENT_LOG_LIMIT, count: log.dropped.value }) }}</span>
				<span data-testid="events-count">{{ filtering
					? i18n.t(log.entries.value.length === 1 ? '{shown} of {total} recorded Event shown' : '{shown} of {total} recorded Events shown', { shown: shown.length, total: log.entries.value.length })
					: i18n.t(log.entries.value.length === 1 ? '{total} recorded Event' : '{total} recorded Events', { total: log.entries.value.length }) }}</span>
			</div>

			<!-- Polite and throttled: the count after a burst settles, and what Pause/Resume/Clear did. Not one announcement per Event. -->
			<p
				data-testid="events-live"
				class="sr-only"
				aria-live="polite"
				aria-atomic="true"
			>
				{{ announcement }}
			</p>

			<ol
				v-if="shown.length > 0"
				data-testid="events-list"
				:aria-label="i18n.t('Recorded Events, newest first')"
				class="m-0 min-h-0 flex-1 list-none overflow-auto p-0"
			>
				<EventLogEntryRow
					v-for="entry in shown"
					:key="entry.seq"
					:entry="entry"
					:selectable="currentNodeId(entry) !== null"
					:selected="isSameWidget(entry, selectedWidget)"
					@select="select(entry)"
				/>
			</ol>
			<p
				v-else
				data-testid="events-empty"
				class="m-0 px-3 py-3 text-xs text-muted"
			>
				{{ log.entries.value.length > 0
					? i18n.t('No recorded Event matches the filters.')
					: i18n.t('No Events yet. Use the Preview (for example submit the form): each Event a widget emits is listed here.') }}
			</p>
		</div>
	</InspectorPanelShell>
</template>
