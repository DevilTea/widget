<script setup lang="ts">
/**
 * `Card` declares `config + slots` only, per checkpoint §2 — no `properties` projection of
 * `title`/`description` (see `../plugins/structural.ts`'s file header). This showcase reuses `Card`
 * three times (`metrics-card`/`pipeline-chart-card`/`deals-card`); rather than a title string this
 * renderer cannot access, each instance is visually distinguished by its own slotted `body` content.
 */
import { useWidget } from '@deviltea/widget-vue'
import { useInspectAnchor } from '../../../composables/use-inspect-anchor'
import { CardPlugin } from '../plugins/structural'

const { WidgetSlot, widgetId, widgetType } = useWidget(CardPlugin)
const inspectAnchor = useInspectAnchor(widgetId, widgetType)
</script>

<template>
	<section
		v-bind="inspectAnchor"
		:class="pika({ padding: '12px', border: '1px solid var(--lab-color-border)', borderRadius: 'var(--lab-radius)', background: 'var(--lab-color-surface)' })"
	>
		<WidgetSlot name="body" />
	</section>
</template>
