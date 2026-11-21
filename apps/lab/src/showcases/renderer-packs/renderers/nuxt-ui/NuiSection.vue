<script setup lang="ts">
/**
 * Nuxt UI pack. Presentation only: a `UCard` with a heading, an optional description and the fields (the `fields` slot).
 */

import { useWidget } from '@deviltea/widget-vue'
import UCard from '@nuxt/ui/components/Card.vue'
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
	<UCard
		v-bind="anchor"
		as="section"
		:data-tutorial-target="`packs-${widgetId}`"
		variant="outline"
		:aria-labelledby="headingId"
	>
		<template #header>
			<h4
				:id="headingId"
				class="text-base font-semibold text-highlighted"
			>
				{{ title === null ? widgetId : text(title) }}
			</h4>
			<p
				v-if="description !== null && description !== undefined"
				class="mt-1 text-sm text-muted"
			>
				{{ text(description) }}
			</p>
		</template>
		<div class="flex flex-col gap-4">
			<WidgetSlot name="fields" />
		</div>
	</UCard>
</template>
