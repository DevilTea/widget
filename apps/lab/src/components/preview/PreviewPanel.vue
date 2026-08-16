<script setup lang="ts">
/**
 * The persistent Preview surface. `store.previewRuntime` only ever changes through
 * `LabSession`'s replacement-ordering hooks (see `use-lab-store.ts`): this component simply renders
 * whatever it currently holds, or an "unavailable" placeholder when the active Blueprint is invalid.
 * `store.renderer` is the current showcase's `createWidgetVueRenderer` root component — it changes
 * only through `store.switchShowcase()`, which already guarantees the old Preview subtree has
 * unmounted first. `WidgetRenderer` never disposes the Runtime — `LabSession` owns that lifecycle.
 *
 * `data-tutorial-target="preview"` (issue #25 P1) is the Survey tour's step 1 spotlight target — the
 * whole scrollable Preview surface, not just the mounted widget tree, since step 1 is a plain
 * orientation ("this is the Interactive Survey") rather than a specific-control callout.
 */
import { useLabStore } from '../../composables/use-lab-store'
import PanelDescriptionBar from '../PanelDescriptionBar.vue'

const store = useLabStore()
</script>

<template>
	<div :class="pika({ display: 'flex', flexDirection: 'column', height: '100%', minHeight: '0' })">
		<PanelDescriptionBar
			storageKey="widget-lab:panel-desc:preview"
			text="The Vue presentation of the running widgets — interact here"
		/>
		<div
			data-tutorial-target="preview"
			:class="pika({ flex: '1 1 auto', overflow: 'auto', padding: '16px', background: 'var(--lab-color-bg)', minHeight: '0' })"
		>
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
	</div>
</template>
