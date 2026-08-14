<script setup lang="ts">
/**
 * The persistent Preview surface. `store.previewRuntime` only ever changes through
 * `LabSession`'s replacement-ordering hooks (see `use-lab-store.ts`): this component simply renders
 * whatever it currently holds, or an "unavailable" placeholder when the active Blueprint is invalid.
 * `store.renderer` is the current showcase's `createWidgetVueRenderer` root component — it changes
 * only through `store.switchShowcase()`, which already guarantees the old Preview subtree has
 * unmounted first. `WidgetRenderer` never disposes the Runtime — `LabSession` owns that lifecycle.
 */
import { useLabStore } from '../../composables/use-lab-store'

const store = useLabStore()
</script>

<template>
	<div :class="pika({ height: '100%', overflow: 'auto', padding: '16px', background: 'var(--lab-color-bg)' })">
		<component
			:is="store.renderer.value"
			v-if="store.previewRuntime.value !== null"
			:runtime="store.previewRuntime.value"
		/>
		<p
			v-else
			:class="pika({ color: 'var(--lab-color-text-muted)', fontSize: '13px' })"
		>
			Preview unavailable — the current Blueprint is invalid. See the Blueprint tab for diagnostics.
		</p>
	</div>
</template>
