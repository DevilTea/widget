<script setup lang="ts">
/**
 * Presentation-only shell shared by the Document Blueprint and Preview Runtime inspectors.
 * The caller owns all semantic data, revision labels, diagnostics, and focus interactions.
 */
import PanelDescriptionBar from '../PanelDescriptionBar.vue'

defineProps<{
	storageKey: string
	text: string
}>()
</script>

<template>
	<div
		data-testid="inspector-panel-shell"
		:class="pika({ display: 'flex', flexDirection: 'column', height: '100%', minHeight: '0' })"
	>
		<PanelDescriptionBar
			:storageKey="storageKey"
			:text="text"
		/>
		<slot />
	</div>
</template>
