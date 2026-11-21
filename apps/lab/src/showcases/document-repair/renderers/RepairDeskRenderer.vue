<script setup lang="ts">
/**
 * Presentation only: the desk's heading and the sentence that says whose policy the repair is, the drafts (the `drafts`
 * slot), the page's one status line (`role="status"`: what the last action did) and its one alert (`role="alert"`: the
 * latest refused patch, explained from Core's failure `code`).
 *
 * The page paints itself from its own `--repair-*` custom properties, chosen by the host's light/dark theme
 * (`useShowcaseHost()` of the showcase host contract); no chrome token is used.
 *
 * Reads: Property `appVersion`. The sessions, the status and the alert belong to the host (`./repair-host.ts`).
 */
import { useWidget } from '@deviltea/widget-vue'
import { computed, inject, useId } from 'vue'
import { useInspectAnchor, useShowcaseHost } from '../../../showcase-host'
import { RepairDeskPlugin } from '../plugins/repair-desk'
import { BUTTON_STYLE } from './control-style'
import { RepairHostKey } from './repair-host'
import { useRepairText } from './use-repair-text'

const { useProperties, WidgetSlot, widgetId, widgetType } = useWidget(RepairDeskPlugin)
const { appVersion } = useProperties()
const host = useShowcaseHost()
const repairHost = inject(RepairHostKey, null)
const { t, tf, explain } = useRepairText()
const anchor = useInspectAnchor(widgetId, widgetType)
const headingId = useId()

const STATUS_KEYS = {
	'opened': 'statusOpened',
	'applied': 'statusApplied',
	'no-change': 'statusNoChange',
	'other-saved': 'statusOtherSaved',
	'reread': 'statusReread',
	'previewed': 'statusPreviewed',
	'exported': 'statusExported',
	'closed': 'statusClosed',
	'reset': 'statusReset',
} as const

const statusText = computed(() => {
	const note = repairHost?.status.value
	return note === null || note === undefined ? '' : tf(STATUS_KEYS[note.kind], note.values)
})

const alert = computed(() => repairHost?.alert.value ?? null)
const alertHeading = computed(() => {
	const current = alert.value
	if (current === null)
		return ''
	return current.stepId === null ? t('alertEdit') : tf('alertRefused', { step: current.stepId })
})
</script>

<template>
	<main
		v-bind="anchor"
		data-tutorial-target="repair-desk"
		:data-repair-theme="host.theme.value"
		class="repair"
		:aria-labelledby="headingId"
	>
		<header class="repair-header">
			<h1
				:id="headingId"
				class="repair-title"
			>
				{{ t('deskHeading') }}
			</h1>
			<p class="repair-intro">
				{{ tf('deskIntro', { version: appVersion ?? '' }) }}
			</p>
		</header>

		<p
			role="status"
			class="repair-status"
			data-testid="repair-status"
			:data-kind="repairHost?.status.value?.kind ?? 'none'"
		>
			{{ statusText }}
		</p>

		<p
			v-if="alert !== null"
			role="alert"
			class="repair-alert"
			data-testid="repair-alert"
			data-tutorial-target="repair-alert"
			:data-code="alert.code"
		>
			<strong>{{ alertHeading }}</strong>
			<span class="repair-alert-text">{{ explain(alert) }}</span>
			<code class="repair-alert-code">{{ alert.code }}<template v-if="alert.operationIndex !== undefined"> · {{ alert.operationIndex }}</template></code>
		</p>

		<div class="repair-drafts">
			<h2 class="repair-drafts-title">
				{{ t('draftsHeading') }}
			</h2>
			<WidgetSlot name="drafts" />
		</div>

		<div class="repair-footer">
			<button
				type="button"
				class="repair-button"
				:style="BUTTON_STYLE"
				:title="t('closeAllHint')"
				data-testid="repair-close-all"
				@click="repairHost?.resetAll()"
			>
				{{ t('closeAll') }}
			</button>
		</div>
	</main>
</template>

<style scoped>
/* Dark is the default, like the frame; light is chosen by `data-repair-theme`. Every descendant inherits these. */
.repair {
	--repair-bg: #14161a;
	--repair-surface: #1b1e24;
	--repair-surface-alt: #22262e;
	--repair-border: #2c313a;
	--repair-text: #e6e8eb;
	--repair-text-muted: #9aa2af;
	--repair-accent: #5b9dff;
	--repair-on-accent: #0b1220;
	--repair-danger: #ff7a80;
	--repair-ok: #3fbf7f;
	--repair-warning: #e0b341;
	--repair-radius: 6px;
	--repair-font-mono: "SFMono-Regular", ui-monospace, Menlo, Consolas, monospace;
	background: var(--repair-bg);
	min-height: 100%;
}

.repair[data-repair-theme='light'] {
	--repair-bg: #f6f7f9;
	--repair-surface: #ffffff;
	--repair-surface-alt: #eef1f5;
	--repair-border: #d4d9e2;
	--repair-text: #1b1f24;
	--repair-text-muted: #596273;
	--repair-accent: #1769e0;
	--repair-on-accent: #ffffff;
	--repair-danger: #b3262f;
	--repair-ok: #18794e;
	--repair-warning: #8a5a00;
}

.repair {
	display: flex;
	flex-direction: column;
	gap: 14px;
	box-sizing: border-box;
	min-height: 100vh;
	padding: 20px max(20px, calc((100% - 760px) / 2));
	color: var(--repair-text);
	font-size: 15px;
	color-scheme: dark;
}

.repair[data-repair-theme='light'] {
	color-scheme: light;
}

.repair-header {
	display: flex;
	flex-direction: column;
	gap: 6px;
}

.repair-title {
	margin: 0;
	font-size: 24px;
	line-height: 1.25;
}

.repair-intro {
	margin: 0;
	font-size: 14px;
	color: var(--repair-text-muted);
}

.repair-status {
	min-height: 1.5em;
	margin: 0;
	font-size: 14px;
	color: var(--repair-text-muted);
}

.repair-alert {
	display: flex;
	flex-wrap: wrap;
	align-items: baseline;
	gap: 4px 10px;
	margin: 0;
	padding: 10px 12px;
	border: 1px solid var(--repair-danger);
	border-radius: var(--repair-radius);
	background: var(--repair-surface);
}

.repair-alert strong {
	color: var(--repair-danger);
}

.repair-alert-text {
	flex-basis: 100%;
}

.repair-alert-code {
	font-family: var(--repair-font-mono);
	font-size: 12px;
	color: var(--repair-text-muted);
}

.repair-drafts {
	display: flex;
	flex-direction: column;
	gap: 12px;
}

.repair-drafts-title {
	margin: 0;
	font-size: 18px;
}

.repair-footer {
	display: flex;
}

.repair-button {
	min-height: 32px;
	padding: 4px 12px;
	border-radius: var(--repair-radius);
	background: var(--repair-surface-alt);
	box-sizing: border-box;
	cursor: pointer;
}

.repair-button:focus-visible {
	outline: 2px solid var(--repair-accent);
	outline-offset: 2px;
}
</style>
