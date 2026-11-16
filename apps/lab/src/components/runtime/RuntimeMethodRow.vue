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
		:class="pika({ display: 'flex', alignItems: 'center', gap: '8px', width: '100%', textAlign: 'left', border: 'none', borderRadius: 'var(--lab-radius)', padding: '4px 6px', fontSize: '11px', fontFamily: 'var(--lab-font-mono)', color: 'var(--lab-color-text)', cursor: 'pointer' })"
		:style="{ background: selected ? 'var(--lab-color-surface-alt)' : 'transparent' }"
		@click="emit('select')"
	>
		<span>{{ name }}()</span>
		<span
			v-if="transitivelyWrites || transitivelyEmits"
			:class="pika({ display: 'flex', gap: '4px', marginLeft: 'auto' })"
		>
			<span
				v-if="transitivelyWrites"
				:class="pika({ fontSize: '10px', padding: '1px 5px', borderRadius: '999px', background: 'var(--lab-color-surface-alt)', color: 'var(--lab-color-warning)' })"
			>writes</span>
			<span
				v-if="transitivelyEmits"
				:class="pika({ fontSize: '10px', padding: '1px 5px', borderRadius: '999px', background: 'var(--lab-color-surface-alt)', color: 'var(--lab-color-warning)' })"
				:title="i18n.t('Emits an Event directly or through the Methods it invokes')"
			>emits</span>
		</span>
	</button>
</template>
