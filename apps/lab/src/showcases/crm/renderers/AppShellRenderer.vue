<script setup lang="ts">
/**
 * `AppShell#crm-app` is the preset's single root instance, so hardcoding its header copy here (rather
 * than projecting `config.title`/`config.subtitle`, which `@deviltea/widget-vue` has no path to expose
 * — see `../plugins/structural.ts`'s file header) carries no per-instance ambiguity. #43 treats this
 * hardcoded shell copy as renderer-owned presentation chrome.
 */
import { useWidget } from '@deviltea/widget-vue'
import { useInspectAnchor } from '../../../composables/use-inspect-anchor'
import { useLabI18n } from '../../../composables/use-lab-i18n'
import { AppShellPlugin } from '../plugins/structural'

const { WidgetSlot, widgetId, widgetType } = useWidget(AppShellPlugin)
const i18n = useLabI18n()
const inspectAnchor = useInspectAnchor(widgetId, widgetType)
</script>

<template>
	<div
		v-bind="inspectAnchor"
		:class="pika({ display: 'flex', flexDirection: 'column', height: '100%', fontFamily: 'var(--lab-font-sans)', position: 'relative' })"
	>
		<header :class="pika({ display: 'flex', flexDirection: 'column', gap: '6px', padding: '10px 14px', borderBottom: '1px solid var(--lab-color-border)', background: 'var(--lab-color-surface)' })">
			<div :class="pika({ display: 'flex', alignItems: 'baseline', gap: '8px' })">
				<strong :class="pika({ fontSize: '14px' })">{{ i18n.t('Sales Pipeline CRM') }}</strong>
				<span :class="pika({ fontSize: '11px', color: 'var(--lab-color-text-muted)' })">{{ i18n.t('Interactive Product Prototype — Showcase B') }}</span>
			</div>
			<WidgetSlot name="header" />
		</header>
		<main :class="pika({ flex: '1', display: 'flex', flexDirection: 'column', gap: '12px', padding: '12px', overflow: 'auto' })">
			<WidgetSlot name="main" />
		</main>
		<WidgetSlot name="overlay" />
	</div>
</template>
