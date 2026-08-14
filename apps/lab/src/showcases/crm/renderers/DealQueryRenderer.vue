<script setup lang="ts">
/**
 * `DealQuery` is a CRM-domain semantic widget with no visual presentation of its own (checkpoint §3):
 * it renders empty/null DOM output, but this is a real registered Vue component — the renderer registry
 * entry is never `null`/omitted/optional. All search/filter/aggregation semantics live in its Properties
 * and stay fully evaluable through the Runtime regardless of this component's mount state.
 */
</script>

<template>
	<span
		v-once
		:style="{ display: 'none' }"
	/>
</template>
