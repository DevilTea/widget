<script setup lang="ts">
/**
 * One occurrence in the Events log (issue #230, audit U09): the time it reached the Lab, the Preview revision that
 * emitted it, the widget, the Event name and a one-line payload summary; a disclosure opens the payload as the same
 * expandable value tree the Runtime values use, with whatever the Inspector snapshot cut marked where it was cut. The
 * widget is a button that selects it in the Preview (aria-disabled, and still focusable, when the current Preview no longer has
 * it, with the reason as its description). Event name,
 * widget id and type and the payload are Runtime data and are shown verbatim. Presentation only.
 */
import type { EventLogEntry } from '../../events/event-log'
import UIcon from '@nuxt/ui/components/Icon.vue'
import { computed, ref, useId } from 'vue'
import { useLabI18n } from '../../composables/use-lab-i18n'
import { formatEventTime } from '../../events/event-log'
import { formatInspectableValue, hasTruncation } from '../../runtime-inspector/format-value'
import InspectableValueTree from '../runtime/InspectableValueTree.vue'

const props = defineProps<{
	entry: EventLogEntry
	/** The widget is in the current Preview and can be selected. */
	selectable: boolean
	/** The widget is the one selected in the Preview right now. */
	selected: boolean
}>()

const emit = defineEmits<{ select: [] }>()

const i18n = useLabI18n()
const expanded = ref(false)
const detailId = useId()
const hasPayload = computed(() => props.entry.args.length > 0)
const summary = computed(() => hasPayload.value
	? props.entry.args.map(formatInspectableValue)
			.join(', ')
	: '')
const truncated = computed(() => props.entry.args.some(hasTruncation))
const label = computed(() => `${props.entry.widgetId} : ${props.entry.widgetType}`)
const reasonId = useId()
const reason = computed(() => props.selectable ? null : i18n.t('{widget} is not in the current Preview', { widget: label.value }))

function select(): void {
	if (props.selectable)
		emit('select')
}
</script>

<template>
	<li
		data-testid="event-entry"
		:data-event="entry.event"
		:data-widget="entry.widgetId"
		:data-revision="entry.revision"
		class="border-b border-default py-0.5"
		:class="selected ? 'bg-elevated' : ''"
	>
		<div class="flex flex-wrap items-center gap-x-2 gap-y-0.5 px-1">
			<button
				v-if="hasPayload"
				type="button"
				data-testid="event-expand"
				:aria-expanded="expanded"
				:aria-controls="expanded ? detailId : undefined"
				:aria-label="i18n.t('Payload of {name}', { name: entry.event })"
				class="inline-flex size-6 shrink-0 cursor-pointer items-center justify-center rounded-(--lab-radius) border-0 bg-transparent text-muted hover:bg-elevated focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-primary"
				@click="expanded = !expanded"
			>
				<UIcon
					:name="expanded ? 'i-lucide-chevron-down' : 'i-lucide-chevron-right'"
					class="size-4"
					aria-hidden="true"
				/>
			</button>
			<span
				v-else
				class="size-6 shrink-0"
				aria-hidden="true"
			/>
			<time
				data-testid="event-time"
				class="shrink-0 font-mono text-[11px] text-muted"
			>{{ formatEventTime(entry.at) }}</time>
			<span
				data-testid="event-revision"
				class="shrink-0 rounded-full border border-default px-1.5 text-[11px] text-muted"
				:title="i18n.t('The Preview revision that emitted this Event')"
			>{{ i18n.t('Preview r{revision}', { revision: entry.revision }) }}</span>
			<button
				type="button"
				data-testid="event-widget"
				:aria-disabled="selectable ? undefined : 'true'"
				:aria-current="selected ? 'true' : undefined"
				:aria-describedby="reason === null ? undefined : reasonId"
				:title="reason ?? i18n.t('Select {widget} in the Preview', { widget: label })"
				class="min-h-6 shrink-0 cursor-pointer rounded-(--lab-radius) border-0 bg-transparent px-1.5 py-0.5 font-mono text-[11px] text-default hover:bg-elevated hover:underline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-primary aria-disabled:cursor-default aria-disabled:text-muted aria-disabled:hover:bg-transparent aria-disabled:hover:no-underline"
				@click="select"
			>
				{{ label }}
			</button>
			<span
				v-if="reason !== null"
				:id="reasonId"
				class="sr-only"
			>{{ reason }}</span>
			<span
				data-testid="event-name"
				class="shrink-0 font-mono text-[11px] font-semibold"
			>{{ entry.event }}</span>
			<span
				v-if="hasPayload"
				data-testid="event-summary"
				class="min-w-0 flex-1 truncate font-mono text-[11px] text-muted"
				:title="summary"
			>{{ summary }}</span>
			<span
				v-else
				data-testid="event-summary"
				class="text-[11px] italic text-muted"
			>{{ i18n.t('no payload') }}</span>
		</div>
		<div
			v-if="hasPayload && expanded"
			:id="detailId"
			data-testid="event-payload"
			class="mb-1 ml-7 mt-0.5 rounded-(--lab-radius) border border-default bg-muted p-1.5"
		>
			<InspectableValueTree
				v-for="(arg, index) in entry.args"
				:key="index"
				:value="arg"
				:label="entry.args.length > 1 ? String(index) : undefined"
			/>
			<p
				v-if="truncated"
				data-testid="value-snapshot-note"
				class="m-0 mt-1 border-t border-default px-1 pt-1 text-[11px] text-muted"
			>
				{{ i18n.t('Parts of this value were left out by the Inspector snapshot, which limits depth, entries and string length. The Lab shows what the Inspector sends.') }}
			</p>
		</div>
	</li>
</template>
