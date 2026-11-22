<script setup lang="ts">
/**
 * Hand-written pack. Presentation only: the page's title, the providers (the `providers` slot) and the sections.
 *
 * The page paints itself from its own `--packs-*` custom properties, chosen by the colour scheme: the Appearance's mode, where
 * `auto` follows the host theme (`useShowcaseHost()` of the showcase host contract, see `useScheme`). No chrome token is used.
 *
 * Reads: Properties `title` and `appearance`.
 */
import { useWidget } from '@deviltea/widget-vue'
import { useId } from 'vue'
import { useInspectAnchor } from '../../../../showcase-host'
import { SettingsPagePlugin } from '../../plugins/settings-page'
import { usePacksText, useScheme } from '../use-packs-text'

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
		data-testid="hand-page"
		class="hand"
		:data-packs-theme="scheme"
		:data-packs-density="appearance?.density ?? 'comfortable'"
		:aria-labelledby="headingId"
	>
		<h3
			:id="headingId"
			class="hand-title"
		>
			{{ title === null ? widgetId : text(title) }}
		</h3>
		<div class="hand-providers">
			<WidgetSlot name="providers" />
		</div>
		<div class="hand-sections">
			<WidgetSlot name="sections" />
		</div>
	</section>
</template>

<style scoped>
/* Dark is the default, like the frame; light is chosen by `data-packs-theme`. Every descendant inherits these. */
.hand {
	--packs-bg: #14161a;
	--packs-surface: #1b1e24;
	--packs-surface-alt: #22262e;
	--packs-border: #2c313a;
	--packs-control-border: #8a93a1;
	--packs-text: #e6e8eb;
	--packs-text-muted: #9aa2af;
	--packs-accent: #5b9dff;
	--packs-on-accent: #0b1220;
	--packs-danger: #ff7a80;
	--packs-on-danger: #1c0b0d;
	--packs-ok: #3fbf7f;
	--packs-radius: 6px;
	--packs-space: 12px;
	--packs-control-height: 36px;
	background: var(--packs-bg);
	color: var(--packs-text);
	color-scheme: dark;
}

.hand[data-packs-theme='light'] {
	--packs-bg: #f6f7f9;
	--packs-surface: #ffffff;
	--packs-surface-alt: #eef1f5;
	--packs-border: #d4d9e2;
	--packs-control-border: #667085;
	--packs-text: #1b1f24;
	--packs-text-muted: #596273;
	--packs-accent: #1769e0;
	--packs-on-accent: #ffffff;
	--packs-danger: #b3262f;
	--packs-on-danger: #ffffff;
	--packs-ok: #18794e;
	color-scheme: light;
}

.hand[data-packs-density='compact'] {
	--packs-space: 6px;
	--packs-control-height: 28px;
}

.hand {
	display: flex;
	flex-direction: column;
	gap: calc(var(--packs-space) * 1.5);
	box-sizing: border-box;
	padding: 16px;
	border-radius: var(--packs-radius);
	font-size: 15px;
}

.hand-title {
	margin: 0;
	font-size: 22px;
	line-height: 1.25;
}

.hand-providers,
.hand-sections {
	display: flex;
	flex-direction: column;
	gap: calc(var(--packs-space) * 1.5);
}
</style>
