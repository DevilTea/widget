<script setup lang="ts">
/**
 * One Method failure in the Events log (issue #230, audit U08): the time it reached the Lab, the Preview revision, the
 * widget, the Method, and the code, reason and message of the failure it reported; a disclosure opens every diagnostic with
 * its arguments or result as the same expandable value tree the Runtime values use. It is labelled as a Method failure
 * because it is not an Event: it is the Method's diagnostic snapshot after a call that returned with diagnostics, so a repeated
 * identical failure is a new entry, a later success records nothing, and changes inside one Runtime call can arrive as one
 * entry. Widget id and type, Method name, code, reason and message are Runtime or Core data and are shown verbatim.
 * Presentation only.
 */
import type { MethodFailureEntry } from '../../events/event-log'
import UIcon from '@nuxt/ui/components/Icon.vue'
import { computed, ref, useId } from 'vue'
import { useLabI18n } from '../../composables/use-lab-i18n'
import { formatEventTime } from '../../events/event-log'
import MethodDiagnosticList from '../runtime/MethodDiagnosticList.vue'

const props = defineProps<{
	entry: MethodFailureEntry
	/** The widget is in the current Preview and can be selected. */
	selectable: boolean
	/** The widget is the one selected in the Preview right now. */
	selected: boolean
}>()

const emit = defineEmits<{ select: [] }>()

const i18n = useLabI18n()
const expanded = ref(false)
const detailId = useId()
const label = computed(() => `${props.entry.widgetId} : ${props.entry.widgetType}`)
const first = computed(() => props.entry.diagnostics[0]!)
const summary = computed(() => [
	first.value.code,
	...(first.value.reason === undefined ? [] : [first.value.reason]),
	first.value.message,
].join(' · '))
const reasonId = useId()
const reason = computed(() => props.selectable ? null : i18n.t('{widget} is not in the current Preview', { widget: label.value }))

function select(): void {
	if (props.selectable)
		emit('select')
}
</script>

<template>
	<li
		data-testid="method-failure-entry"
		:data-method="entry.method"
		:data-widget="entry.widgetId"
		:data-revision="entry.revision"
		class="border-b border-default py-0.5"
		:class="selected ? 'bg-elevated' : ''"
	>
		<div class="flex flex-wrap items-center gap-x-2 gap-y-0.5 px-1">
			<button
				type="button"
				data-testid="method-failure-expand"
				:aria-expanded="expanded"
				:aria-controls="expanded ? detailId : undefined"
				:aria-label="i18n.t('Details of the failed call of {name}', { name: `${entry.method}()` })"
				class="inline-flex size-6 shrink-0 cursor-pointer items-center justify-center rounded-(--lab-radius) border-0 bg-transparent text-muted hover:bg-elevated focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-primary"
				@click="expanded = !expanded"
			>
				<UIcon
					:name="expanded ? 'i-lucide-chevron-down' : 'i-lucide-chevron-right'"
					class="size-4"
					aria-hidden="true"
				/>
			</button>
			<time
				data-testid="event-time"
				class="shrink-0 font-mono text-[11px] text-muted"
			>{{ formatEventTime(entry.at) }}</time>
			<span
				data-testid="event-revision"
				class="shrink-0 rounded-full border border-default px-1.5 text-[11px] text-muted"
				:title="i18n.t('The Preview revision that reported this Method failure')"
			>{{ i18n.t('Preview r{revision}', { revision: entry.revision }) }}</span>
			<span
				data-testid="method-failure-badge"
				class="shrink-0 rounded-full border border-error px-1.5 text-[11px] text-error"
			>{{ i18n.t('Method failure') }}</span>
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
				data-testid="method-failure-name"
				class="shrink-0 font-mono text-[11px] font-semibold"
			>{{ entry.method }}()</span>
			<span
				data-testid="method-failure-summary"
				class="min-w-0 flex-1 truncate font-mono text-[11px] text-error"
				:title="summary"
			>{{ summary }}</span>
		</div>
		<div
			v-if="expanded"
			:id="detailId"
			data-testid="method-failure-detail"
			class="mb-1 ml-7 mt-0.5"
		>
			<MethodDiagnosticList :diagnostics="entry.diagnostics" />
		</div>
	</li>
</template>
