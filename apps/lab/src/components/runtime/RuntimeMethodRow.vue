<script setup lang="ts">
/**
 * One Method member row — inventory only (diagnostic #13 Phase 5 "Runtime Inspector becomes strictly
 * passive"): name and the compiler-authoritative `transitivelyWrites` fact. No invocation affordance, no
 * runtime execution facts (Methods do not retain any).
 */
defineProps<{
	name: string
	transitivelyWrites: boolean
	selected: boolean
}>()

const emit = defineEmits<{
	select: []
}>()
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
			v-if="transitivelyWrites"
			:class="pika({ marginLeft: 'auto', fontSize: '10px', padding: '1px 5px', borderRadius: '999px', background: 'var(--lab-color-surface-alt)', color: 'var(--lab-color-warning)' })"
		>writes</span>
	</button>
</template>
