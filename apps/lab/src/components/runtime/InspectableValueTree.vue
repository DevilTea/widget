<script setup lang="ts">
/**
 * Expandable view of one Inspector value DTO (audit U10). Containers open and close one level at a time, strings
 * show in full (wrapping), and everything the Inspector left out is marked where it was left out: a subtree
 * replaced at the depth limit, a container cut at its entry/node budget, a string cut at its length limit. Those
 * limits are the Inspector snapshot's, set by the protocol; this component does not change or work around them.
 * Presentation only: it owns no Runtime data and invokes nothing.
 */
import type { InspectableValue } from '@deviltea/widget-inspector/value'
import UIcon from '@nuxt/ui/components/Icon.vue'
import { computed, ref, useId } from 'vue'
import { useLabI18n } from '../../composables/use-lab-i18n'
import { describeContainer } from '../../runtime-inspector/format-value'

defineOptions({ name: 'InspectableValueTree' })

const props = withDefaults(defineProps<{
	value: InspectableValue
	/** The key or index this value sits under, shown before it. */
	label?: string
	depth?: number
	/** Containers shallower than this start open. */
	openDepth?: number
}>(), { label: undefined, depth: 0, openDepth: 2 })

const i18n = useLabI18n()
const open = ref(props.depth < props.openDepth)
const groupId = useId()

const container = computed(() => props.value.type === 'array' || props.value.type === 'object' ? props.value : null)
const children = computed<readonly { readonly key: string, readonly value: InspectableValue, readonly keyTruncated: boolean }[]>(() => {
	const current = container.value
	if (current === null)
		return []
	return current.type === 'array'
		? current.items.map((item, index) => ({ key: String(index), value: item, keyTruncated: false }))
		: current.entries.map(entry => ({ key: entry.key, value: entry.value, keyTruncated: entry.keyTruncated === true }))
})

const scalarText = computed(() => {
	const current = props.value
	switch (current.type) {
		case 'null': return 'null'
		case 'undefined': return 'undefined'
		case 'boolean': return String(current.value)
		case 'string': return JSON.stringify(current.value)
		case 'number': return String(current.value)
		case 'number-special': return { 'nan': 'NaN', 'positive-infinity': 'Infinity', 'negative-infinity': '-Infinity', 'negative-zero': '-0' }[current.value]
		case 'bigint': return `${current.value}n`
		case 'reference': return `↻ #${current.ref}`
		case 'opaque': return `<${current.kind}>`
		default: return ''
	}
})

const scalarTitle = computed(() => props.value.type === 'reference'
	? i18n.t('The same object as one shown elsewhere in this value (#{ref})', { ref: props.value.ref })
	: undefined)
</script>

<template>
	<div
		class="font-mono text-[11px] leading-5"
		:data-value-type="value.type"
	>
		<template v-if="container !== null">
			<button
				type="button"
				data-testid="value-toggle"
				:aria-expanded="open"
				:aria-controls="groupId"
				class="flex min-h-6 max-w-full cursor-pointer items-center gap-1 rounded-(--lab-radius) border-0 bg-transparent px-1 text-left font-mono text-[11px] text-default hover:bg-elevated focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-primary"
				@click="open = !open"
			>
				<UIcon
					:name="open ? 'i-lucide-chevron-down' : 'i-lucide-chevron-right'"
					class="size-3.5 shrink-0 text-muted"
					aria-hidden="true"
				/>
				<span
					v-if="label !== undefined"
					class="shrink-0"
				>{{ label }}:</span>
				<span class="text-muted">{{ describeContainer(container) }}</span>
			</button>
			<div
				v-show="open"
				:id="groupId"
				role="group"
				class="ml-3 border-l border-default pl-2"
			>
				<InspectableValueTree
					v-for="child in children"
					:key="child.key"
					:value="child.value"
					:label="child.key + (child.keyTruncated ? '…' : '')"
					:depth="depth + 1"
					:openDepth="openDepth"
				/>
				<p
					v-if="container.truncated"
					data-testid="value-truncated"
					class="m-0 px-1 italic text-warning"
				>
					{{ i18n.t('… more entries were left out by the Inspector snapshot') }}
				</p>
				<p
					v-if="children.length === 0 && !container.truncated"
					class="m-0 px-1 text-muted"
				>
					{{ i18n.t(container.type === 'array' ? 'empty array' : 'empty object') }}
				</p>
			</div>
		</template>
		<div
			v-else-if="value.type === 'truncated'"
			class="flex min-h-6 items-baseline gap-1 px-1"
		>
			<span
				v-if="label !== undefined"
				class="shrink-0"
			>{{ label }}:</span>
			<span
				data-testid="value-truncated"
				class="italic text-warning"
			>{{ i18n.t('… truncated by the Inspector snapshot (nested too deeply)') }}</span>
		</div>
		<div
			v-else
			class="flex min-h-6 items-baseline gap-1 px-1"
		>
			<span
				v-if="label !== undefined"
				class="shrink-0"
			>{{ label }}:</span>
			<span
				class="min-w-0 whitespace-pre-wrap wrap-anywhere"
				:class="value.type === 'string' ? 'text-success' : 'text-info'"
				:title="scalarTitle"
			>{{ scalarText }}</span>
			<span
				v-if="value.type === 'string' && value.truncated"
				data-testid="value-truncated"
				class="shrink-0 italic text-warning"
			>{{ i18n.t('… cut by the Inspector snapshot') }}</span>
		</div>
	</div>
</template>
