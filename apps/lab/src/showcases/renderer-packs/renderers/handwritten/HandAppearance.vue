<script setup lang="ts">
/**
 * Hand-written pack. Presentation only: two groups of native radio buttons bound to State `density` and `mode`. Writing State
 * is always accepted for a known value; what `auto` means (follow the host theme) is resolved by the page, not here.
 */
import { useWidget } from '@deviltea/widget-vue'
import { useId } from 'vue'
import { useInspectAnchor } from '../../../../showcase-host'
import { DENSITIES, MODES } from '../../domain'
import { DENSITY_MESSAGE_KEYS, MODE_MESSAGE_KEYS } from '../../messages'
import { AppearancePlugin } from '../../plugins/appearance'
import { usePacksText } from '../use-packs-text'

const { useState, widgetId, widgetType } = useWidget(AppearancePlugin)
const { density, mode } = useState()
const { t } = usePacksText()
const anchor = useInspectAnchor(widgetId, widgetType)
const name = useId()
</script>

<template>
	<section
		v-bind="anchor"
		:data-tutorial-target="`packs-${widgetId}`"
		class="appearance"
		data-testid="hand-appearance"
	>
		<h4 class="appearance-title">
			{{ t('appearanceHeading') }}
		</h4>
		<fieldset class="appearance-group">
			<legend class="appearance-legend">
				{{ t('densityLabel') }}
			</legend>
			<label
				v-for="option in DENSITIES"
				:key="option"
				class="appearance-option"
			>
				<input
					type="radio"
					:name="`${name}-density`"
					:value="option"
					:checked="density === option"
					:data-testid="`hand-density-${option}`"
					@change="density = option"
				>
				<span>{{ t(DENSITY_MESSAGE_KEYS[option]) }}</span>
			</label>
		</fieldset>
		<fieldset class="appearance-group">
			<legend class="appearance-legend">
				{{ t('modeLabel') }}
			</legend>
			<label
				v-for="option in MODES"
				:key="option"
				class="appearance-option"
			>
				<input
					type="radio"
					:name="`${name}-mode`"
					:value="option"
					:checked="mode === option"
					:data-testid="`hand-mode-${option}`"
					@change="mode = option"
				>
				<span>{{ t(MODE_MESSAGE_KEYS[option]) }}</span>
			</label>
		</fieldset>
	</section>
</template>

<style scoped>
.appearance {
	display: flex;
	flex-wrap: wrap;
	align-items: flex-start;
	gap: var(--packs-space) 24px;
	padding: 12px 16px;
	border: 1px solid var(--packs-border);
	border-radius: var(--packs-radius);
	background: var(--packs-surface);
}

.appearance-title {
	flex-basis: 100%;
	margin: 0;
	font-size: 16px;
}

.appearance-group {
	display: flex;
	flex-wrap: wrap;
	gap: 4px 16px;
	margin: 0;
	padding: 0;
	border: 0;
}

.appearance-legend {
	padding: 0;
	margin-bottom: 4px;
	font-size: 14px;
	color: var(--packs-text-muted);
}

.appearance-option {
	display: inline-flex;
	align-items: center;
	gap: 6px;
	min-height: 24px;
	cursor: pointer;
}

.appearance-option input {
	width: 16px;
	height: 16px;
	margin: 0;
	accent-color: var(--packs-accent);
}

.appearance-option input:focus-visible {
	outline: 2px solid var(--packs-accent);
	outline-offset: 2px;
}
</style>
