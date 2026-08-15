<script setup lang="ts">
/**
 * Thin presentation only: options come from `useProperties().options` (config-projected).
 *
 * Issue #28 accessibility fix: `useId()`-derived `for`/`id` ties the visible `label` to the `select`;
 * when `help` is configured, its paragraph gets its own id and the `select` points to it via
 * `aria-describedby` (help text is supplementary, not the accessible name, so `aria-describedby` — not
 * `aria-labelledby` — is the correct association here).
 */
import { useWidget } from '@deviltea/widget-vue'
import { useId } from 'vue'
import { SurveyChoiceQuestionPlugin } from '../plugins/survey-questions'

const { useState, useProperties, useStateIssues } = useWidget(SurveyChoiceQuestionPlugin)
const { answer } = useState()
const { label, help, options } = useProperties()
const { answer: answerIssues } = useStateIssues()

const selectId = useId()
const helpId = useId()

function onChange(event: Event): void {
	const value = (event.target as HTMLSelectElement).value
	answer.value = value === '' ? null : value
}
</script>

<template>
	<div :class="pika({ display: 'flex', flexDirection: 'column', gap: '4px', padding: '6px 0' })">
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
				— select —
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
