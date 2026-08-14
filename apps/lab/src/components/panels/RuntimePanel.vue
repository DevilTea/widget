<script setup lang="ts">
/**
 * Placeholder for this phase (issue #13 Widget Lab Phase 4 scope decision): the Runtime tab stays
 * present even for an invalid Blueprint (never disappears), showing an unavailable/blocked state
 * rather than an active inspector. The full readonly Runtime Inspector (via
 * `@deviltea/widget-core/inspection`'s `inspectRuntime`) arrives in the next phase.
 */
import { useLabStore } from '../../composables/use-lab-store'

const store = useLabStore()
</script>

<template>
	<div :class="pika({ padding: '16px', fontSize: '12px', color: 'var(--lab-color-text-muted)' })">
		<p v-if="store.active.value.runtime === null">
			Runtime unavailable (invalid Blueprint). Fix the diagnostics in the Blueprint tab, then Apply again.
		</p>
		<p v-else>
			Runtime active — inspector arrives in the next phase.
		</p>
	</div>
</template>
