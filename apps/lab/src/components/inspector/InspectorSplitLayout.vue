<script setup lang="ts">
/**
 * Presentation-only tree/details layout shared by inspectors. Slots deliberately keep the
 * Blueprint and Runtime data contracts separate; this component owns only the visual columns.
 */
</script>

<template>
	<div
		data-testid="inspector-split-layout"
		:class="pika({ display: 'grid', gridTemplateColumns: '220px 1px 1fr', flex: '1 1 auto', minHeight: '0' })"
	>
		<div>
			<slot name="tree" />
		</div>
		<div :class="pika({ background: 'var(--lab-color-border)' })" />
		<div :class="pika({ display: 'flex', flexDirection: 'column', minHeight: '0' })">
			<slot name="details" />
		</div>
	</div>
</template>
