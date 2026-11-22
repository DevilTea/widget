<script setup lang="ts">
/**
 * Nuxt UI pack. Presentation only: a `UFormField` around a `USelect` bound to State `value`. A value that is not one of the
 * options is refused by the State's own validation, so the select can only show what the widget holds. The select's menu is
 * teleported into the pack's overlay container (`UApp`'s portal), not the frame's `<body>`.
 */

import { useWidget } from '@deviltea/widget-vue'
import UFormField from '@nuxt/ui/components/FormField.vue'
import USelect from '@nuxt/ui/components/Select.vue'
import { computed } from 'vue'
import { useInspectAnchor } from '../../../../showcase-host'
import { ChoicePlugin } from '../../plugins/choice'
import { usePacksText } from '../use-packs-text'

const { useState, useProperties, widgetId, widgetType } = useWidget(ChoicePlugin)
const { value } = useState()
const { label, options, density } = useProperties()
const { t, text } = usePacksText()
const anchor = useInspectAnchor(widgetId, widgetType)
// The select takes a value or nothing; State holds a value or nothing (null before it is first read).
const model = computed({ get: () => value.value ?? undefined, set: (next) => {
	if (next !== undefined)
		value.value = next
} })
const items = computed(() => (options.value ?? []).map(option => ({ value: option.value, label: text(option.label) })))
</script>

<template>
	<UFormField
		v-bind="anchor"
		:data-tutorial-target="`packs-${widgetId}`"
		:label="label === null ? widgetId : text(label)"
		:size="density === 'compact' ? 'sm' : 'md'"
		class="max-w-md"
	>
		<USelect
			v-model="model"
			:items="items"
			:placeholder="t('selectPlaceholder')"
			class="w-full"
			:data-testid="`nui-select-${widgetId}`"
		/>
	</UFormField>
</template>
