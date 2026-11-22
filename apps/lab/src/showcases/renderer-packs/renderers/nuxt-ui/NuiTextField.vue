<script setup lang="ts">
/**
 * Nuxt UI pack. Presentation only: a `UFormField` around a `UInput` bound to State `value`, with the validation message of
 * Property `message` as the field's error. Writing State is always accepted; the plugin says whether the value is acceptable.
 * The density is Property `density`, which the widget read from the Appearance it names (it picks the input's size).
 */

import { useWidget } from '@deviltea/widget-vue'
import UFormField from '@nuxt/ui/components/FormField.vue'
import UInput from '@nuxt/ui/components/Input.vue'
import { computed } from 'vue'
import { useInspectAnchor } from '../../../../showcase-host'
import { textLength } from '../../domain'
import { TextFieldPlugin } from '../../plugins/text-field'
import { usePacksText } from '../use-packs-text'

const { useState, useProperties, widgetId, widgetType } = useWidget(TextFieldPlugin)
const { value } = useState()
const { label, placeholder, maxLength, message, density } = useProperties()
const { tf, text } = usePacksText()
const anchor = useInspectAnchor(widgetId, widgetType)
// The input takes a string or nothing; State holds a string or nothing (null before it is first read).
const model = computed({ get: () => value.value ?? undefined, set: (next) => {
	value.value = next ?? ''
} })
const problem = computed(() => message.value === null || message.value === undefined ? undefined : text(message.value))
</script>

<template>
	<UFormField
		v-bind="anchor"
		:data-tutorial-target="`packs-${widgetId}`"
		:label="label === null ? widgetId : text(label)"
		:error="problem"
		:hint="tf('characters', { count: textLength(value ?? ''), max: maxLength ?? 0 })"
		:size="density === 'compact' ? 'sm' : 'md'"
		class="max-w-md"
	>
		<UInput
			v-model="model"
			:placeholder="placeholder === null || placeholder === undefined ? undefined : text(placeholder)"
			class="w-full"
			:data-testid="`nui-input-${widgetId}`"
		/>
	</UFormField>
</template>
