<script setup lang="ts">
/**
 * `DealStore` is a CRM-domain semantic widget with no visual presentation of its own (checkpoint §3):
 * it renders empty/null DOM output, but this is a real registered Vue component — the renderer registry
 * entry is never `null`/omitted/optional. `DealStore.updateStage`/`reset` remain fully callable through
 * the Runtime regardless of this component ever being mounted (it always is, since it lives directly
 * under `AppShell#crm-app`'s `main` slot, but its Method/State semantics do not depend on that).
 */
</script>

<template>
	<span
		v-once
		:style="{ display: 'none' }"
	/>
</template>
