<script setup lang="ts">
/**
 * One Method member row (issue #230, audit U08; diagnostic #13 Phase 5 "Runtime Inspector becomes strictly passive"):
 * the name and the compiler-authoritative `transitivelyWrites` and `transitivelyEmits` facts, and the Method's
 * latest diagnostics as the Inspector protocol 0.5 reports them (`runtime.subscribeMember` with a Method member, the
 * same subscription path State and Property rows use). The snapshot is the diagnostics of the Method's latest call that
 * returned a result, which the Preview's own use of the widget produced: there is no invocation affordance and no call
 * history here (Core retains none). So an empty snapshot says "No failure recorded" and never "succeeded" or "never
 * called", which it cannot tell apart.
 *
 * `transitivelyEmits` arrives through the Inspector snapshot, where it exists only from protocol 0.4. As an optional Vue
 * Boolean prop, an omitted value is cast to `false`, so an absent field and `false` both show no marker: the Lab cannot
 * tell them apart and does not show "unknown", so for a peer below protocol 0.4 a Method that emits shows no marker.
 * Without a Method snapshot (`initial` omitted, a peer below protocol 0.5) the row shows no failure status at all.
 */
import type { InspectorClient } from '@deviltea/widget-inspector/client'
import type { InspectorRuntimeMethodSnapshot, WidgetRef } from '@deviltea/widget-inspector/protocol'
import UIcon from '@nuxt/ui/components/Icon.vue'
import { computed, ref, useId } from 'vue'
import { useLabI18n } from '../../composables/use-lab-i18n'
import { useRemoteRuntimeMember } from '../../composables/use-remote-runtime-member'
import MethodDiagnosticList from './MethodDiagnosticList.vue'

const props = defineProps<{
	name: string
	transitivelyWrites: boolean
	transitivelyEmits?: boolean
	selected: boolean
	client?: InspectorClient
	widgetRef?: WidgetRef
	/** The Method's snapshot from the widget's Runtime snapshot; omitted when the peer reports none. */
	initial?: InspectorRuntimeMethodSnapshot | null
}>()

const emit = defineEmits<{
	select: []
}>()

const i18n = useLabI18n()
const open = ref(true)
const detailId = useId()

const snapshot = useRemoteRuntimeMember(
	() => props.initial === null || props.initial === undefined ? null : props.client ?? null,
	() => props.widgetRef ?? null,
	() => ({ type: 'method', name: props.name }),
	() => props.initial ?? null,
)

const diagnostics = computed(() => snapshot.value?.type === 'method' ? snapshot.value.diagnostics : null)
const failed = computed(() => diagnostics.value !== null && diagnostics.value.length > 0)
</script>

<template>
	<div
		data-testid="runtime-method-row"
		:data-member="name"
		:data-failed="failed ? 'true' : undefined"
	>
		<div class="flex items-center gap-0.5">
			<button
				v-if="failed"
				type="button"
				data-testid="method-failure-toggle"
				:aria-expanded="open"
				:aria-controls="open ? detailId : undefined"
				:aria-label="i18n.t('Failure details of {name}', { name })"
				class="inline-flex size-6 shrink-0 cursor-pointer items-center justify-center rounded-(--lab-radius) border-0 bg-transparent text-muted hover:bg-elevated focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-primary"
				@click="open = !open"
			>
				<UIcon
					:name="open ? 'i-lucide-chevron-down' : 'i-lucide-chevron-right'"
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
				data-testid="method-select"
				class="flex min-h-6 min-w-0 flex-1 cursor-pointer items-center gap-2 rounded-(--lab-radius) border-0 px-1.5 py-0.5 text-left font-mono text-[11px] text-default hover:bg-elevated focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-primary"
				:class="selected ? 'bg-elevated' : 'bg-transparent'"
				@click="emit('select')"
			>
				<span class="shrink-0">{{ name }}()</span>
				<span
					v-if="transitivelyWrites || transitivelyEmits"
					class="flex gap-1"
				>
					<span
						v-if="transitivelyWrites"
						class="rounded-full bg-elevated px-1.5 text-[11px] text-warning"
					>writes</span>
					<span
						v-if="transitivelyEmits"
						class="rounded-full bg-elevated px-1.5 text-[11px] text-warning"
						:title="i18n.t('Emits an Event directly or through the Methods it invokes')"
					>emits</span>
				</span>
				<span
					v-if="diagnostics !== null"
					data-testid="method-status"
					class="ml-auto min-w-0 truncate"
					:class="failed ? 'text-error' : 'text-muted'"
					:title="failed ? undefined : i18n.t('The latest call of this Method that returned reported no diagnostics, or none has returned yet.')"
				>{{ failed ? i18n.t('Last call failed') : i18n.t('No failure recorded') }}</span>
			</button>
		</div>
		<div
			v-if="failed && open && diagnostics !== null"
			:id="detailId"
			data-testid="method-failure-detail"
			class="mb-1 ml-6 mt-0.5"
		>
			<MethodDiagnosticList :diagnostics="diagnostics" />
		</div>
	</div>
</template>
