<script setup lang="ts">
import { useLabI18n } from '../../composables/use-lab-i18n'

/**
 * One Method member row — inventory only (diagnostic #13 Phase 5 "Runtime Inspector becomes strictly
 * passive"): name and the compiler-authoritative `transitivelyWrites` and `transitivelyEmits` facts.
 * `transitivelyEmits` arrives through the Inspector snapshot, where it exists only from protocol 0.4. As an
 * optional Vue Boolean prop, an omitted value is cast to `false`, so an absent field and `false` both show no
 * marker: the Lab cannot tell them apart and does not show "unknown", so for a peer below protocol 0.4 a
 * Method that emits shows no marker. No invocation affordance, no runtime execution facts (Methods do not
 * retain any).
 */
defineProps<{
	name: string
	transitivelyWrites: boolean
	transitivelyEmits?: boolean
	selected: boolean
}>()

const emit = defineEmits<{
	select: []
}>()

const i18n = useLabI18n()
</script>

<template>
	<button
		type="button"
		class="flex items-center gap-[8px] w-full text-left [border:none] rounded-lab p-[4px_6px] min-h-[24px] text-[11px] font-lab-mono text-lab-text cursor-pointer"
		:style="{ background: selected ? 'var(--lab-color-surface-alt)' : 'transparent' }"
		@click="emit('select')"
	>
		<span>{{ name }}()</span>
		<span
			v-if="transitivelyWrites || transitivelyEmits"
			class="flex gap-[4px] ml-[auto]"
		>
			<span
				v-if="transitivelyWrites"
				class="text-[11px] p-[1px_5px] rounded-[999px] bg-lab-surface-alt text-lab-warning"
			>writes</span>
			<span
				v-if="transitivelyEmits"
				class="text-[11px] p-[1px_5px] rounded-[999px] bg-lab-surface-alt text-lab-warning"
				:title="i18n.t('Emits an Event directly or through the Methods it invokes')"
			>emits</span>
		</span>
	</button>
</template>
