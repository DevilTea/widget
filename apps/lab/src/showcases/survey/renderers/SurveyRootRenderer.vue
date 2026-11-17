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
import { useInspectAnchor } from '../../../composables/use-inspect-anchor'
import { useLabI18n } from '../../../composables/use-lab-i18n'
import { SurveyPlugin } from '../plugins/survey'
import { FIELD_STYLE, PRIMARY_BUTTON_STYLE } from './control-style'

const { useState, useProperties, useMethods, useMethodDiagnostics, WidgetSlot, widgetId, widgetType } = useWidget(SurveyPlugin)
const { language, submitted } = useState()
const { text, canSubmit, changedSinceSubmit, response } = useProperties()
const { submit } = useMethods()
const { submit: submitDiagnostics } = useMethodDiagnostics()
const i18n = useLabI18n()

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
	>
		<header class="survey-header">
			<h1 class="survey-title">
				{{ text?.title ?? widgetId }}
			</h1>
			<div class="survey-language">
				<label
					:for="languageId"
					class="survey-language-label"
				>{{ i18n.t('Language') }}</label>
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
				{{ i18n.t('Response — what a backend reads') }}
			</summary>
			<pre
				data-testid="survey-response-json"
				class="survey-response-json"
			>{{ responseJson }}</pre>
		</details>
	</div>
</template>

<style scoped>
.survey {
	display: flex;
	flex-direction: column;
	gap: 16px;
	box-sizing: border-box;
	max-width: 760px;
	padding: 20px;
	color: var(--lab-color-text);
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
	color: var(--lab-color-text-muted);
}

/* The select's text colour, size, weight and border are set inline (`control-style.ts`). */
.survey-language-select {
	min-height: 40px;
	padding: 6px 10px;
	border-radius: var(--lab-radius);
	background: var(--lab-color-surface-alt);
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
	border: 1px solid var(--lab-color-accent);
	border-radius: var(--lab-radius);
	background: var(--lab-color-accent);
	cursor: pointer;
}

.survey-diagnostic {
	margin: 0;
	padding: 2px 0 2px 10px;
	border-left: 4px solid var(--lab-color-danger);
	font-size: 16px;
	font-weight: 600;
	color: var(--lab-color-danger);
}

.survey-submitted {
	display: flex;
	flex-direction: column;
	gap: 8px;
	padding: 14px 16px;
	border: 2px solid var(--lab-color-accent);
	border-radius: var(--lab-radius);
	background: var(--lab-color-surface);
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
	border: 1px solid var(--lab-color-warning);
	border-radius: 999px;
	font-size: 15px;
	font-weight: 600;
	color: var(--lab-color-warning);
}

.survey-answers {
	display: grid;
	grid-template-columns: max-content 1fr;
	gap: 4px 16px;
	margin: 0;
	font-size: 16px;
}

.survey-answer-id {
	font-family: var(--lab-font-mono);
	color: var(--lab-color-text-muted);
}

.survey-answer-value {
	margin: 0;
}

.survey-response {
	border: 1px solid var(--lab-color-border);
	border-radius: var(--lab-radius);
	background: var(--lab-color-surface);
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
	font-family: var(--lab-font-mono);
	font-size: 14px;
	line-height: 1.45;
	border-top: 1px solid var(--lab-color-border);
}
</style>
