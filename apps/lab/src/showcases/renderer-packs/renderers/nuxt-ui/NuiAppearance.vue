<script setup lang="ts">
/**
 * Nuxt UI pack. Presentation only: two `URadioGroup`s bound to State `density` and `mode`. Writing State is always accepted
 * for a known value; what `auto` means (follow the host theme) is resolved by the page, not here.
 */

import { useWidget } from '@deviltea/widget-vue'
import URadioGroup from '@nuxt/ui/components/RadioGroup.vue'
import { computed } from 'vue'
import { useInspectAnchor } from '../../../../showcase-host'
import { DENSITIES, MODES } from '../../domain'
import { DENSITY_MESSAGE_KEYS, MODE_MESSAGE_KEYS } from '../../messages'
import { AppearancePlugin } from '../../plugins/appearance'
import { usePacksText } from '../use-packs-text'

const { useState, widgetId, widgetType } = useWidget(AppearancePlugin)
const { density, mode } = useState()
const { t } = usePacksText()
const anchor = useInspectAnchor(widgetId, widgetType)
// The groups take a value or nothing; State holds a value or nothing (null before it is first read).
const densityModel = computed({ get: () => density.value ?? undefined, set: (next) => {
	if (next !== undefined)
		density.value = next
} })
const modeModel = computed({ get: () => mode.value ?? undefined, set: (next) => {
	if (next !== undefined)
		mode.value = next
} })

const densityItems = computed(() => DENSITIES.map(value => ({ value, label: t(DENSITY_MESSAGE_KEYS[value]) })))
const modeItems = computed(() => MODES.map(value => ({ value, label: t(MODE_MESSAGE_KEYS[value]) })))
</script>

<template>
	<section
		v-bind="anchor"
		:data-tutorial-target="`packs-${widgetId}`"
		class="flex flex-wrap items-start gap-x-8 gap-y-3 rounded-md border border-default bg-muted px-4 py-3"
		data-testid="nui-appearance"
	>
		<h4 class="basis-full text-base font-semibold text-highlighted">
			{{ t('appearanceHeading') }}
		</h4>
		<URadioGroup
			v-model="densityModel"
			:legend="t('densityLabel')"
			:items="densityItems"
			orientation="horizontal"
			size="sm"
			:ui="{ label: 'min-h-6' }"
			data-testid="nui-density"
		/>
		<URadioGroup
			v-model="modeModel"
			:legend="t('modeLabel')"
			:items="modeItems"
			orientation="horizontal"
			size="sm"
			:ui="{ label: 'min-h-6' }"
			data-testid="nui-mode"
		/>
	</section>
</template>
