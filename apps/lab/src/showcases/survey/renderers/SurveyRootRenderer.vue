<script setup lang="ts">
/**
 * Presentation only: the survey's title and language switch, the `questions` slot, the Submit action,
 * the submitted snapshot and the live response.
 *
 * Reads: Property `text` (title and chrome in the survey language, with the languages' endonyms),
 * Property `changedSinceSubmit` and Property `response` (always: the tutorial's observed members and the
 * backend's view), State `language` and State `submitted`. Writes State `language` and calls Method
 * `submit()`. Whether a submit is allowed, what is stored and what counts as changed are the plugin's:
 * the Method's diagnostics (the "blocked" message) are shown verbatim and nothing is checked here.
 */
import type { AnswerValue } from '../domain'
import { useWidget } from '@deviltea/widget-vue'
import { computed, useId } from 'vue'
import { useInspectAnchor } from '../../../composables/use-inspect-anchor'
import { useLabI18n } from '../../../composables/use-lab-i18n'
import { SurveyPlugin } from '../plugins/survey'

const { useState, useProperties, useMethods, useMethodDiagnostics, WidgetSlot, widgetId, widgetType } = useWidget(SurveyPlugin)
const { language, submitted } = useState()
const { text, changedSinceSubmit, response } = useProperties()
const { submit } = useMethods()
const { submit: submitDiagnostics } = useMethodDiagnostics()
const i18n = useLabI18n()

const languageId = useId()
const anchor = useInspectAnchor(widgetId, widgetType)
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
		:class="pika({ display: 'flex', flexDirection: 'column', gap: '16px', boxSizing: 'border-box', maxWidth: '760px', padding: '20px', color: 'var(--lab-color-text)', fontSize: '16px' })"
	>
		<header :class="pika({ display: 'flex', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: '12px' })">
			<h1 :class="pika({ margin: '0', fontSize: '26px', lineHeight: '1.25' })">
				{{ text?.title ?? widgetId }}
			</h1>
			<div :class="pika({ display: 'flex', alignItems: 'center', gap: '8px' })">
				<label
					:for="languageId"
					:class="pika({ fontSize: '15px', color: 'var(--lab-color-text-muted)' })"
				>{{ i18n.t('Language') }}</label>
				<select
					:id="languageId"
					:value="language ?? ''"
					:class="pika({ minHeight: '40px', padding: '6px 10px', fontSize: '16px', border: '1px solid var(--lab-color-border)', borderRadius: 'var(--lab-radius)', background: 'var(--lab-color-surface-alt)', color: 'var(--lab-color-text)' })"
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

		<div :class="pika({ display: 'flex', flexDirection: 'column', gap: '12px' })">
			<WidgetSlot name="questions" />
		</div>

		<div
			data-tutorial-target="survey-actions"
			:class="pika({ display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: '8px' })"
		>
			<button
				type="button"
				data-testid="survey-submit"
				:class="pika({ minHeight: '44px', padding: '8px 28px', fontSize: '17px', fontWeight: '600', border: '1px solid var(--lab-color-accent)', borderRadius: 'var(--lab-radius)', background: 'var(--lab-color-accent)', color: 'var(--lab-color-accent-contrast)', cursor: 'pointer' })"
				@click="onSubmit"
			>
				{{ text?.submit ?? 'Submit' }}
			</button>
			<p
				v-for="(diagnostic, index) in submitDiagnostics"
				:key="`${index}:${diagnostic.message}`"
				role="alert"
				data-testid="survey-submit-diagnostic"
				:class="pika({ margin: '0', padding: '2px 0 2px 10px', borderLeft: '4px solid var(--lab-color-danger)', fontSize: '16px', fontWeight: '600', color: 'var(--lab-color-danger)' })"
			>
				{{ diagnostic.message }}
			</p>
		</div>

		<section
			v-if="submitted !== null"
			data-tutorial-target="survey-submitted"
			data-testid="survey-submitted"
			:class="pika({ display: 'flex', flexDirection: 'column', gap: '8px', padding: '14px 16px', border: '2px solid var(--lab-color-accent)', borderRadius: 'var(--lab-radius)', background: 'var(--lab-color-surface)' })"
		>
			<h2 :class="pika({ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '10px', margin: '0', fontSize: '20px' })">
				{{ text?.submitted ?? 'Submitted' }}
				<span
					v-if="changedSinceSubmit === true"
					data-testid="survey-changed-since-submit"
					:class="pika({ padding: '2px 10px', border: '1px solid var(--lab-color-warning)', borderRadius: '999px', fontSize: '15px', fontWeight: '600', color: 'var(--lab-color-warning)' })"
				>
					{{ text?.changedSinceSubmit }}
				</span>
			</h2>
			<dl :class="pika({ display: 'grid', gridTemplateColumns: 'max-content 1fr', gap: '4px 16px', margin: '0', fontSize: '16px' })">
				<template
					v-for="[id, display] in submittedRows"
					:key="id"
				>
					<dt :class="pika({ fontFamily: 'var(--lab-font-mono)', color: 'var(--lab-color-text-muted)' })">
						{{ id }}
					</dt>
					<dd :class="pika({ margin: '0' })">
						{{ display }}
					</dd>
				</template>
			</dl>
		</section>

		<details
			data-testid="survey-response"
			:class="pika({ border: '1px solid var(--lab-color-border)', borderRadius: 'var(--lab-radius)', background: 'var(--lab-color-surface)' })"
		>
			<summary :class="pika({ padding: '10px 16px', fontSize: '16px', fontWeight: '600', cursor: 'pointer' })">
				{{ i18n.t('Response — what a backend reads') }}
			</summary>
			<pre
				data-testid="survey-response-json"
				:class="pika({ margin: '0', padding: '12px 16px', maxHeight: '360px', overflow: 'auto', fontFamily: 'var(--lab-font-mono)', fontSize: '14px', lineHeight: '1.45', borderTop: '1px solid var(--lab-color-border)' })"
			>{{ responseJson }}</pre>
		</details>
	</div>
</template>
