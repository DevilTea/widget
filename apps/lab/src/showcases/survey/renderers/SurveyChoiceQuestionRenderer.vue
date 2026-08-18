<script setup lang="ts">
/**
 * Thin presentation only: options come from `useProperties().options` (config-projected). #43 leaves
 * those labels and all validation issues verbatim; only the renderer-owned empty-choice placeholder is
 * presentation chrome.
 *
 * Issue #28 accessibility fix: `useId()`-derived `for`/`id` ties the visible `label` to the `select`;
 * when `help` is configured, its paragraph gets its own id and the `select` points to it via
 * `aria-describedby`.
 */
import { useWidget } from '@deviltea/widget-vue'
import { useId } from 'vue'
import { useInspectAnchor } from '../../../composables/use-inspect-anchor'
import { useLabI18n } from '../../../composables/use-lab-i18n'
import { SurveyChoiceQuestionPlugin } from '../plugins/survey-questions'

const { useState, useProperties, useStateIssues, widgetId, widgetType } = useWidget(SurveyChoiceQuestionPlugin)
const { answer } = useState()
const { label, help, options } = useProperties()
const { answer: answerIssues } = useStateIssues()
const i18n = useLabI18n()

const selectId = useId()
const helpId = useId()
const inspectAnchor = useInspectAnchor(widgetId, widgetType)

function onChange(event: Event): void {
	const value = (event.target as HTMLSelectElement).value
	answer.value = value === '' ? null : value
}
</script>

<template>
	<div
		v-bind="inspectAnchor"
		:class="pika({ display: 'flex', flexDirection: 'column', gap: '4px', padding: '6px 0' })"
	>
		<label
			:for="selectId"
			:class="pika({ fontSize: '12px', fontWeight: '600' })"
		>{{ label }}</label>
		<p
			v-if="help"
			:id="helpId"
			:class="pika({ margin: '0', fontSize: '11px', color: 'var(--lab-color-text-muted)' })"
		>
			{{ help }}
		</p>
		<select
			:id="selectId"
			:value="answer ?? ''"
			:aria-describedby="help ? helpId : undefined"
			:class="pika({ padding: '4px 6px', fontSize: '12px', border: '1px solid var(--lab-color-border)', borderRadius: 'var(--lab-radius)', background: 'var(--lab-color-surface-alt)', color: 'var(--lab-color-text)' })"
			@change="onChange"
		>
			<option value="">
				{{ i18n.t('— select —') }}
			</option>
			<option
				v-for="option in options"
				:key="option.value"
				:value="option.value"
			>
				{{ option.label }}
			</option>
		</select>
		<p
			v-for="issue in answerIssues"
			:key="issue.message"
			:class="pika({ margin: '0', fontSize: '11px', color: 'var(--lab-color-danger)' })"
		>
			{{ issue.message }}
		</p>
	</div>
</template>
