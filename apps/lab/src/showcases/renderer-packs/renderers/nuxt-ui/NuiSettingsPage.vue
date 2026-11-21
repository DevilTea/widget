<script setup lang="ts">
/**
 * Nuxt UI pack. Presentation only: the page's title, the providers and the sections, as the root of the pack.
 *
 * This element is the pack's own root: it carries `.packs-ui` (the pack's Nuxt UI tokens, `./packs-ui.css`), the `dark` class
 * when the colour scheme is dark (the Appearance's mode, where `auto` follows the host theme; never the frame `<html>`), and the
 * overlay container (`[data-packs-portal]`) that `UApp` portals every Nuxt UI overlay into (`./nested-app.ts`), so a modal or a
 * menu never leaves the pack's root, and inherits its tokens and its `dark` class.
 *
 * Reads: Properties `title` and `appearance`.
 */
import { useWidget } from '@deviltea/widget-vue'
import { useId } from 'vue'
import { useInspectAnchor } from '../../../../showcase-host'
import { SettingsPagePlugin } from '../../plugins/settings-page'
import { usePacksText, useScheme } from '../use-packs-text'
import { PORTAL_ATTRIBUTE } from './portal'

const { useProperties, WidgetSlot, widgetId, widgetType } = useWidget(SettingsPagePlugin)
const { title, appearance } = useProperties()
const { text } = usePacksText()
const anchor = useInspectAnchor(widgetId, widgetType)
const scheme = useScheme(() => appearance.value?.mode)
const headingId = useId()
</script>

<template>
	<section
		v-bind="anchor"
		:data-tutorial-target="`packs-${widgetId}`"
		data-testid="nui-page"
		class="packs-ui flex flex-col gap-4 rounded-md p-4 text-base"
		:class="{ dark: scheme === 'dark' }"
		:data-packs-theme="scheme"
		:data-packs-density="appearance?.density ?? 'comfortable'"
		:aria-labelledby="headingId"
	>
		<h3
			:id="headingId"
			class="text-xl font-semibold text-highlighted"
		>
			{{ title === null ? widgetId : text(title) }}
		</h3>
		<div class="flex flex-col gap-4">
			<WidgetSlot name="providers" />
		</div>
		<div class="flex flex-col gap-4">
			<WidgetSlot name="sections" />
		</div>
		<div v-bind="{ [PORTAL_ATTRIBUTE]: '' }" />
	</section>
</template>
