<script setup lang="ts">
/**
 * Hand-written pack. Presentation only: a heading, an optional description and the fields (the `fields` slot).
 */
import { useWidget } from '@deviltea/widget-vue'
import { useId } from 'vue'
import { useInspectAnchor } from '../../../../showcase-host'
import { SectionPlugin } from '../../plugins/section'
import { usePacksText } from '../use-packs-text'

const { useProperties, WidgetSlot, widgetId, widgetType } = useWidget(SectionPlugin)
const { title, description } = useProperties()
const { text } = usePacksText()
const anchor = useInspectAnchor(widgetId, widgetType)
const headingId = useId()
</script>

<template>
	<section
		v-bind="anchor"
		:data-tutorial-target="`packs-${widgetId}`"
		class="section"
		:aria-labelledby="headingId"
	>
		<h4
			:id="headingId"
			class="section-title"
		>
			{{ title === null ? widgetId : text(title) }}
		</h4>
		<p
			v-if="description !== null && description !== undefined"
			class="section-description"
		>
			{{ text(description) }}
		</p>
		<div class="section-fields">
			<WidgetSlot name="fields" />
		</div>
	</section>
</template>

<style scoped>
.section {
	display: flex;
	flex-direction: column;
	gap: 6px;
	padding: 12px 16px 16px;
	border: 1px solid var(--packs-border);
	border-radius: var(--packs-radius);
	background: var(--packs-surface);
}

.section-title {
	margin: 0;
	font-size: 16px;
}

.section-description {
	margin: 0;
	font-size: 14px;
	color: var(--packs-text-muted);
}

.section-fields {
	display: flex;
	flex-direction: column;
	gap: var(--packs-space);
	margin-top: 6px;
}
</style>
