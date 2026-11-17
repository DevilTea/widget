<script setup lang="ts">
/**
 * One State or Property row of the Runtime inspectors: the member name, a one-line summary of its value, and (audit
 * U10) an explicit disclosure that opens the whole value as an expandable tree instead of a cell clipped at a fixed
 * width. The summary takes the room the row has and ends in an ellipsis only when it must; its full text is the
 * button's tooltip. Selecting the row (focus) and opening its value are separate controls. Presentation only.
 */
import type { InspectableValue } from '@deviltea/widget-inspector/value'
import UIcon from '@nuxt/ui/components/Icon.vue'
import { computed, ref, useId } from 'vue'
import { useLabI18n } from '../../composables/use-lab-i18n'
import { hasTruncation, isExpandableValue } from '../../runtime-inspector/format-value'
import InspectableValueTree from './InspectableValueTree.vue'

const props = defineProps<{
	name: string
	/** The value as one line of text (or a status such as "Never evaluated"). */
	summary: string
	/** The value to open as a tree; `null` when the row has no value (never evaluated, failed). */
	value: InspectableValue | null
	selected: boolean
	/** The summary is an error and is drawn as one. */
	danger?: boolean
}>()

const emit = defineEmits<{ select: [] }>()

const i18n = useLabI18n()
const expanded = ref(false)
const detailId = useId()
const expandable = computed(() => props.value !== null && isExpandableValue(props.value))
const truncated = computed(() => props.value !== null && hasTruncation(props.value))
</script>

<template>
	<div
		data-testid="runtime-value-row"
		:data-member="name"
	>
		<div class="flex items-center gap-0.5">
			<button
				v-if="expandable"
				type="button"
				data-testid="value-expand"
				:aria-expanded="expanded"
				:aria-controls="detailId"
				:aria-label="i18n.t(expanded ? 'Collapse the value of {name}' : 'Expand the value of {name}', { name })"
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
			<button
				type="button"
				data-testid="value-select"
				class="flex min-h-6 min-w-0 flex-1 cursor-pointer items-center gap-2 rounded-(--lab-radius) border-0 px-1.5 py-0.5 text-left font-mono text-[11px] text-default hover:bg-elevated focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-primary"
				:class="selected ? 'bg-elevated' : 'bg-transparent'"
				:title="summary"
				@click="emit('select')"
			>
				<span class="shrink-0">{{ name }}</span>
				<span
					data-testid="value-summary"
					class="ml-auto min-w-0 truncate"
					:class="danger === true ? 'text-error' : 'text-muted'"
				>{{ summary }}</span>
			</button>
		</div>
		<div
			v-if="expandable && expanded && value !== null"
			:id="detailId"
			data-testid="value-detail"
			class="mb-1 ml-6 mt-0.5 rounded-(--lab-radius) border border-default bg-muted p-1.5"
		>
			<InspectableValueTree :value="value" />
			<p
				v-if="truncated"
				data-testid="value-snapshot-note"
				class="m-0 mt-1 border-t border-default px-1 pt-1 text-[11px] text-muted"
			>
				{{ i18n.t('Parts of this value were left out by the Inspector snapshot, which limits depth, entries and string length. The Lab shows what the Inspector sends.') }}
			</p>
		</div>
	</div>
</template>
