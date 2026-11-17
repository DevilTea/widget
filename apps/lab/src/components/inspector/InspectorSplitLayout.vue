<script setup lang="ts">
/**
 * Presentation-only tree/details layout shared by inspectors. Slots deliberately keep the
 * Blueprint and Runtime data contracts separate; this component owns only the visual columns.
 */
</script>

<template>
	<div
		data-testid="inspector-split-layout"
		class="grid grid-cols-[220px_1px_1fr] flex-auto min-h-0"
	>
		<div>
			<slot name="tree" />
		</div>
		<div class="bg-lab-border" />
		<div class="flex flex-col min-h-0">
			<slot name="details" />
		</div>
	</div>
</template>
