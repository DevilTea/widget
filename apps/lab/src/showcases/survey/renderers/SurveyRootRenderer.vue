<script setup lang="ts">
/**
 * Presentation only: the survey's title and language switch, the `questions` slot, the Submit action,
 * the submitted snapshot and the live response.
 *
 * Reads: Property `text` (title and chrome in the survey language, with the languages' endonyms),
 * Property `changedSinceSubmit` and Property `response` (always: the tutorial's observed members and the
 * backend's view), Property `canSubmit`, State `language` and State `submitted`. Writes State `language`
 * and calls Method `submit()`. Whether a submit is allowed, what is stored and what counts as changed are
 * the plugin's: the Method's diagnostics (the "blocked" message) are shown verbatim, only while
 * `canSubmit` is not `true`, and nothing is checked here.
 */
import type { AnswerValue } from '../domain'
import { useWidget } from '@deviltea/widget-vue'
import { computed, useId } from 'vue'
import { useInspectAnchor, useShowcaseHost, useShowcaseMessages } from '../../../showcase-host'
import { surveyMessages } from '../messages'
import { SurveyPlugin } from '../plugins/survey'
import { FIELD_STYLE, PRIMARY_BUTTON_STYLE } from './control-style'

const { useState, useProperties, useMethods, useMethodDiagnostics, WidgetSlot, widgetId, widgetType } = useWidget(SurveyPlugin)
const { language, submitted } = useState()
const { text, canSubmit, changedSinceSubmit, response } = useProperties()
const { submit } = useMethods()
const { submit: submitDiagnostics } = useMethodDiagnostics()
const host = useShowcaseHost()
const { t } = useShowcaseMessages(surveyMessages)

const languageId = useId()
const anchor = useInspectAnchor(widgetId, widgetType)
/**
 * The Method's diagnostics from the last Submit, verbatim, but only while the survey still cannot be
 * submitted: once every error is fixed the "blocked" message is out of date and would sit next to a clean form.
 */
const blockedDiagnostics = computed(() => canSubmit.value === true ? [] : submitDiagnostics.value)
const responseJson = computed(() => JSON.stringify(response.value, null, 2))
/** The submitted snapshot's visible answers, as `[question id, display text]`. */
const submittedRows = computed(() => Object.entries(submitted.value?.answers ?? {})
	.filter(([, outcome]) => outcome.visible)
	.map(([id, outcome]) => [id, formatValue(outcome.value)] as const))

function formatValue(value: AnswerValue): string {
	if (value === null)
		return '—'
	return Array.isArray(value) ? value.join(', ') : String(value)
}

function onLanguageChange(event: Event): void {
	language.value = (event.target as HTMLSelectElement).value
}

function onSubmit(): void {
	submit()
}
</script>

<template>
	<div
		v-bind="anchor"
		:data-changed-since-submit="changedSinceSubmit === true"
		class="survey"
		:data-survey-theme="host.theme.value"
	>
		<header class="survey-header">
			<h1 class="survey-title">
				{{ text?.title ?? widgetId }}
			</h1>
			<div class="survey-language">
				<label
					:for="languageId"
					class="survey-language-label"
				>{{ t('language') }}</label>
				<select
					:id="languageId"
					:value="language ?? ''"
					class="survey-language-select"
					:style="FIELD_STYLE"
					@change="onLanguageChange"
				>
					<option
						v-for="entry in text?.languages ?? []"
						:key="entry.code"
						:value="entry.code"
					>
						{{ entry.name }}
					</option>
				</select>
			</div>
		</header>

		<div class="survey-questions">
			<WidgetSlot name="questions" />
		</div>

		<div
			data-tutorial-target="survey-actions"
			class="survey-actions"
		>
			<button
				type="button"
				data-testid="survey-submit"
				class="survey-submit"
				:style="PRIMARY_BUTTON_STYLE"
				@click="onSubmit"
			>
				{{ text?.submit ?? 'Submit' }}
			</button>
			<p
				v-for="(diagnostic, index) in blockedDiagnostics"
				:key="`${index}:${diagnostic.message}`"
				role="alert"
				data-testid="survey-submit-diagnostic"
				class="survey-diagnostic"
			>
				{{ diagnostic.message }}
			</p>
		</div>

		<section
			v-if="submitted !== null"
			data-tutorial-target="survey-submitted"
			data-testid="survey-submitted"
			class="survey-submitted"
		>
			<h2 class="survey-submitted-title">
				{{ text?.submitted ?? 'Submitted' }}
				<span
					v-if="changedSinceSubmit === true"
					data-testid="survey-changed-since-submit"
					class="survey-changed"
				>
					{{ text?.changedSinceSubmit }}
				</span>
			</h2>
			<dl class="survey-answers">
				<template
					v-for="[id, display] in submittedRows"
					:key="id"
				>
					<dt class="survey-answer-id">
						{{ id }}
					</dt>
					<dd class="survey-answer-value">
						{{ display }}
					</dd>
				</template>
			</dl>
		</section>

		<details
			data-testid="survey-response"
			class="survey-response"
		>
			<summary class="survey-response-summary">
				{{ t('response') }}
			</summary>
			<pre
				data-testid="survey-response-json"
				class="survey-response-json"
			>{{ responseJson }}</pre>
		</details>
	</div>
</template>

<style scoped>
/*
 * The survey's own colour tokens (`--survey-*`), the only ones any survey renderer reads. They are declared
 * on the root element, so every question renderer inside it inherits them, and are keyed off the theme the
 * host provides (`data-survey-theme`, from `useShowcaseHost().theme`): dark is the default, light overrides
 * it. The values are the survey's own palette, deliberately not read from the Lab chrome's tokens.
 */
.survey {
	color-scheme: dark;
	--survey-color-surface: #1b1e24;
	--survey-color-surface-alt: #22262e;
	--survey-color-border: #2c313a;
	--survey-color-text: #e6e8eb;
	--survey-color-text-muted: #9aa2af;
	--survey-color-accent: #5b9dff;
	--survey-color-accent-contrast: #04101f;
	--survey-color-danger: #f2545b;
	--survey-color-warning: #e8a33d;
	--survey-radius: 6px;
	--survey-font-mono: "SFMono-Regular", ui-monospace, Menlo, Consolas, monospace;
}

.survey[data-survey-theme='light'] {
	color-scheme: light;
	--survey-color-surface: #ffffff;
	--survey-color-surface-alt: #eef1f5;
	--survey-color-border: #d4d9e2;
	--survey-color-text: #1b1f24;
	--survey-color-text-muted: #596273;
	--survey-color-accent: #1769e0;
	--survey-color-accent-contrast: #ffffff;
	--survey-color-danger: #c9373f;
	--survey-color-warning: #9a6200;
}

.survey {
	display: flex;
	flex-direction: column;
	gap: 16px;
	box-sizing: border-box;
	max-width: 760px;
	padding: 20px;
	color: var(--survey-color-text);
	font-size: 16px;
}

.survey-header {
	display: flex;
	flex-wrap: wrap;
	align-items: center;
	justify-content: space-between;
	gap: 12px;
}

.survey-title {
	margin: 0;
	font-size: 26px;
	line-height: 1.25;
}

.survey-language {
	display: flex;
	align-items: center;
	gap: 8px;
}

.survey-language-label {
	font-size: 15px;
	color: var(--survey-color-text-muted);
}

/* The select's text colour, size, weight and border are set inline (`control-style.ts`). */
.survey-language-select {
	min-height: 40px;
	padding: 6px 10px;
	border-radius: var(--survey-radius);
	background: var(--survey-color-surface-alt);
}

.survey-questions {
	display: flex;
	flex-direction: column;
	gap: 12px;
}

.survey-actions {
	display: flex;
	flex-direction: column;
	align-items: flex-start;
	gap: 8px;
}

/* The Submit label's colour, size and weight are set inline (`control-style.ts`). */
.survey-submit {
	min-height: 44px;
	padding: 8px 28px;
	border: 1px solid var(--survey-color-accent);
	border-radius: var(--survey-radius);
	background: var(--survey-color-accent);
	cursor: pointer;
}

.survey-diagnostic {
	margin: 0;
	padding: 2px 0 2px 10px;
	border-left: 4px solid var(--survey-color-danger);
	font-size: 16px;
	font-weight: 600;
	color: var(--survey-color-danger);
}

.survey-submitted {
	display: flex;
	flex-direction: column;
	gap: 8px;
	padding: 14px 16px;
	border: 2px solid var(--survey-color-accent);
	border-radius: var(--survey-radius);
	background: var(--survey-color-surface);
}

.survey-submitted-title {
	display: flex;
	flex-wrap: wrap;
	align-items: center;
	gap: 10px;
	margin: 0;
	font-size: 20px;
}

.survey-changed {
	padding: 2px 10px;
	border: 1px solid var(--survey-color-warning);
	border-radius: 999px;
	font-size: 15px;
	font-weight: 600;
	color: var(--survey-color-warning);
}

.survey-answers {
	display: grid;
	grid-template-columns: max-content 1fr;
	gap: 4px 16px;
	margin: 0;
	font-size: 16px;
}

.survey-answer-id {
	font-family: var(--survey-font-mono);
	color: var(--survey-color-text-muted);
}

.survey-answer-value {
	margin: 0;
}

.survey-response {
	border: 1px solid var(--survey-color-border);
	border-radius: var(--survey-radius);
	background: var(--survey-color-surface);
}

.survey-response-summary {
	padding: 10px 16px;
	font-size: 16px;
	font-weight: 600;
	cursor: pointer;
}

.survey-response-json {
	margin: 0;
	padding: 12px 16px;
	max-height: 360px;
	overflow: auto;
	font-family: var(--survey-font-mono);
	font-size: 14px;
	line-height: 1.45;
	border-top: 1px solid var(--survey-color-border);
}
</style>
