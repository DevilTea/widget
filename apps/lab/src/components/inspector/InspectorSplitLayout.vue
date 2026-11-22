<script setup lang="ts">
/**
 * Presentation-only tree/details layout shared by inspectors. Slots deliberately keep the
 * Blueprint and Runtime data contracts separate; this component owns only the visual columns.
 *
 * The details track is `minmax(0, 1fr)` and both columns are `min-w-0`: a plain `1fr` has the content's
 * min-content width as its minimum, so one long value (a JSON preview in a Runtime row) stretched the grid far past
 * the panel and `overflow: hidden` hid every value. The rows truncate instead, with the full value in their tooltip
 * and disclosure.
 */
</script>

<template>
	<div
		data-testid="inspector-split-layout"
		class="grid grid-cols-[220px_1px_minmax(0,1fr)] flex-auto min-h-0"
	>
		<div class="min-w-0">
			<slot name="tree" />
		</div>
		<div class="bg-lab-border" />
		<div class="flex flex-col min-h-0 min-w-0">
			<slot name="details" />
		</div>
	</div>
</template>
