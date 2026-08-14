<script setup lang="ts">
/**
 * `Card` declares `config + slots` only, per checkpoint §2 — no `properties` projection of
 * `title`/`description` (see `../plugins/structural.ts`'s file header). This showcase reuses `Card`
 * three times (`metrics-card`/`pipeline-chart-card`/`deals-card`); rather than a title string this
 * renderer cannot access, each instance is visually distinguished by its own slotted `body` content.
 */
import { useWidget } from '@deviltea/widget-vue'
import { CardPlugin } from '../plugins/structural'

const { WidgetSlot } = useWidget(CardPlugin)
</script>

<template>
	<section :class="pika({ padding: '12px', border: '1px solid var(--lab-color-border)', borderRadius: 'var(--lab-radius)', background: 'var(--lab-color-surface)' })">
		<WidgetSlot name="body" />
	</section>
</template>
