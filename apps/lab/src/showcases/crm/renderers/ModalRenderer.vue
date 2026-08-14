<script setup lang="ts">
/**
 * Renderer visibility follows semantic `open` (checkpoint §2): the `body`/`footer` slot subtree is only
 * mounted in the Vue tree while `open === true`, but the Runtime widgets living there (`DealStageForm`
 * and its children) exist independently — `Button#change-stage` can invoke `deal-stage-form.open()`
 * (which itself invokes `Modal.open()`) while this subtree is unmounted, and that invocation succeeds
 * purely through `@deviltea/widget-core` dependency wiring, never through the Vue component tree
 * (checkpoint §3 "semantic availability is independent of current component visibility").
 *
 * `Modal#stage-modal` is the preset's single instance, so hardcoding its title here (matching
 * `../presets.ts`'s configured `title` verbatim) carries no per-instance ambiguity.
 */
import { useWidget } from '@deviltea/widget-vue'
import { ModalPlugin } from '../plugins/actions'

const { useState, WidgetSlot } = useWidget(ModalPlugin)
const { open } = useState()
</script>

<template>
	<div
		v-if="open"
		:class="pika({ position: 'fixed', inset: '0', display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'color-mix(in srgb, black 55%, transparent)', zIndex: '20' })"
	>
		<div :class="pika({ minWidth: '320px', maxWidth: '420px', padding: '16px', borderRadius: 'var(--lab-radius)', border: '1px solid var(--lab-color-border)', background: 'var(--lab-color-surface)', display: 'flex', flexDirection: 'column', gap: '12px' })">
			<h3 :class="pika({ margin: '0', fontSize: '14px' })">
				Change deal stage
			</h3>
			<WidgetSlot name="body" />
			<div :class="pika({ display: 'flex', justifyContent: 'flex-end', gap: '8px' })">
				<WidgetSlot name="footer" />
			</div>
		</div>
	</div>
</template>
