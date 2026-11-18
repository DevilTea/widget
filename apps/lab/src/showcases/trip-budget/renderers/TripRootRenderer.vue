<script setup lang="ts">
/**
 * Presentation only: the trip's title, the language switch, "Start over" and the four slots in reading
 * order (money settings, the settlement, the people and the expenses; the settlement sits above the
 * expenses so a change below shows its effect without scrolling).
 *
 * The page paints itself from its own `--trip-*` custom properties, chosen by the host's light/dark theme
 * (`useShowcaseHost()` of the showcase host contract); no chrome token is used.
 *
 * Reads: Property `title` and `view` (the interface language), State `language`. Writes State `language`.
 * "Start over" asks the host (`./reset-host.ts`) to call Core's `runtime.resetState()`; the language is the one
 * thing put back afterwards, so Start over does not also switch the language of the page.
 */
import { useWidget } from '@deviltea/widget-vue'
import { computed, inject, useId } from 'vue'
import { useInspectAnchor, useShowcaseHost } from '../../../showcase-host'
import { LANGUAGE_ENDONYMS, TRIP_LANGUAGES, tripText } from '../domain'
import { TripPlugin } from '../plugins/trip'
import { BUTTON_STYLE, FIELD_STYLE } from './control-style'
import { TripResetHostKey } from './reset-host'

const { useState, useProperties, WidgetSlot, widgetId, widgetType } = useWidget(TripPlugin)
const { language } = useState()
const { title, view } = useProperties()
const text = computed(() => tripText(view.value?.language ?? 'en'))
const host = inject(TripResetHostKey, null)
const { theme } = useShowcaseHost()

const languageId = useId()
const peopleHeadingId = useId()
const expensesHeadingId = useId()
const anchor = useInspectAnchor(widgetId, widgetType)

function onLanguageChange(event: Event): void {
	language.value = (event.target as HTMLSelectElement).value
}

function onStartOver(): void {
	const keep = language.value
	host?.resetAll()
	if (keep !== null && language.value !== keep)
		language.value = keep
}
</script>

<template>
	<main
		v-bind="anchor"
		:data-tutorial-target="`trip-${widgetId}`"
		:data-trip-theme="theme"
		class="trip"
	>
		<header class="trip-header">
			<h1 class="trip-title">
				{{ title ?? widgetId }}
			</h1>
			<div class="trip-tools">
				<label
					:for="languageId"
					class="trip-tools-label"
				>{{ text.language }}</label>
				<select
					:id="languageId"
					:value="language ?? ''"
					class="trip-select"
					:style="FIELD_STYLE"
					data-testid="trip-language"
					@change="onLanguageChange"
				>
					<option
						v-for="code in TRIP_LANGUAGES"
						:key="code"
						:value="code"
					>
						{{ LANGUAGE_ENDONYMS[code] }}
					</option>
				</select>
				<button
					type="button"
					class="trip-button"
					:style="BUTTON_STYLE"
					:title="text.startOverHint"
					data-testid="trip-start-over"
					data-tutorial-target="trip-start-over"
					@click="onStartOver"
				>
					{{ text.startOver }}
				</button>
			</div>
		</header>

		<WidgetSlot name="settings" />
		<WidgetSlot name="summary" />

		<section
			:aria-labelledby="peopleHeadingId"
			class="trip-section"
		>
			<h2
				:id="peopleHeadingId"
				class="trip-heading"
			>
				{{ text.people }}
			</h2>
			<div class="trip-people">
				<WidgetSlot name="people" />
			</div>
		</section>

		<section
			:aria-labelledby="expensesHeadingId"
			class="trip-section"
		>
			<h2
				:id="expensesHeadingId"
				class="trip-heading"
			>
				{{ text.expenses }}
			</h2>
			<div class="trip-expenses">
				<WidgetSlot name="expenses" />
			</div>
		</section>
	</main>
</template>

<style scoped>
/* Dark is the default, like the frame; light is chosen by `data-trip-theme`. Every descendant inherits these. */
.trip {
	--trip-bg: #14161a;
	--trip-surface: #1b1e24;
	--trip-surface-alt: #22262e;
	--trip-border: #2c313a;
	--trip-text: #e6e8eb;
	--trip-text-muted: #9aa2af;
	--trip-accent: #5b9dff;
	--trip-danger: #f2545b;
	--trip-ok: #3fbf7f;
	--trip-radius: 6px;
	--trip-font-mono: "SFMono-Regular", ui-monospace, Menlo, Consolas, monospace;
	background: var(--trip-bg);
	min-height: 100%;
}

.trip[data-trip-theme='light'] {
	--trip-bg: #f6f7f9;
	--trip-surface: #ffffff;
	--trip-surface-alt: #eef1f5;
	--trip-border: #d4d9e2;
	--trip-text: #1b1f24;
	--trip-text-muted: #596273;
	--trip-accent: #1769e0;
	--trip-danger: #c9373f;
	--trip-ok: #18794e;
}

.trip {
	display: flex;
	flex-direction: column;
	gap: 16px;
	box-sizing: border-box;
	min-height: 100vh;
	padding: 20px max(20px, calc((100% - 720px) / 2));
	color: var(--trip-text);
	font-size: 15px;
	color-scheme: dark;
}

.trip[data-trip-theme='light'] {
	color-scheme: light;
}

.trip-header {
	display: flex;
	flex-wrap: wrap;
	align-items: center;
	justify-content: space-between;
	gap: 12px;
}

.trip-title {
	margin: 0;
	font-size: 26px;
	line-height: 1.25;
}

.trip-tools {
	display: flex;
	flex-wrap: wrap;
	align-items: center;
	gap: 8px;
}

.trip-tools-label {
	font-size: 14px;
	color: var(--trip-text-muted);
}

/* Text colour, size, weight and border of the controls are set inline (`control-style.ts`). */
.trip-select,
.trip-button {
	min-height: 36px;
	padding: 4px 10px;
	border-radius: var(--trip-radius);
	background: var(--trip-surface-alt);
}

.trip-button {
	cursor: pointer;
}

.trip-section {
	display: flex;
	flex-direction: column;
	gap: 8px;
}

.trip-heading {
	margin: 0;
	font-size: 18px;
}

.trip-people {
	align-items: start;
	display: grid;
	grid-template-columns: repeat(auto-fill, minmax(220px, 1fr));
	gap: 10px;
}

.trip-expenses {
	display: flex;
	flex-direction: column;
	gap: 10px;
}
</style>
