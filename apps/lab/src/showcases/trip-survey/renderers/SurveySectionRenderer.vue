<script setup lang="ts">
import { useWidget } from '@deviltea/widget-vue'
import { useInspectAnchor } from '../../../composables/use-inspect-anchor'
import { SurveySectionPlugin } from '../plugins/sections'

const { useProperties, WidgetSlot, widgetId, widgetType } = useWidget(SurveySectionPlugin)
const { heading, description } = useProperties()
const inspectAnchor = useInspectAnchor(widgetId, widgetType)
</script>

<template>
	<section
		v-bind="inspectAnchor"
		:class="pika({ padding: '10px 12px', border: '1px solid var(--lab-color-border)', borderRadius: 'var(--lab-radius)', marginBottom: '10px', background: 'var(--lab-color-surface)' })"
	>
		<h3 :class="pika({ margin: '0 0 4px', fontSize: '13px' })">
			{{ heading }}
		</h3>
		<p
			v-if="description"
			:class="pika({ margin: '0 0 8px', fontSize: '11px', color: 'var(--lab-color-text-muted)' })"
		>
			{{ description }}
		</p>
		<div>
			<WidgetSlot name="body" />
		</div>
	</section>
</template>
