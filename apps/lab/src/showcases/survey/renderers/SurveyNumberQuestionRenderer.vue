<script setup lang="ts">
/**
 * Thin presentation only. `min`/`max`/`integer` are read as Properties (config-derived) purely to
 * drive the `<input>` attributes; the authoritative accept/reject decision is `answer.validate`
 * (checkpoint §2) — this component never re-validates before writing.
 */
import { useWidget } from '@deviltea/widget-vue'
import { SurveyNumberQuestionPlugin } from '../plugins/survey-questions'

const { useState, useProperties, useStateIssues } = useWidget(SurveyNumberQuestionPlugin)
const { answer } = useState()
const { label, help, min, max, integer } = useProperties()
const { answer: answerIssues } = useStateIssues()

function onChange(event: Event): void {
	const raw = (event.target as HTMLInputElement).value
	if (raw === '') {
		answer.value = null
		return
	}
	const parsed = Number(raw)
	if (Number.isNaN(parsed))
		return
	answer.value = parsed
}
</script>

<template>
	<div :class="pika({ display: 'flex', flexDirection: 'column', gap: '4px', padding: '6px 0' })">
		<label :class="pika({ fontSize: '12px', fontWeight: '600' })">{{ label }}</label>
		<p
			v-if="help"
			:class="pika({ margin: '0', fontSize: '11px', color: 'var(--lab-color-text-muted)' })"
		>
			{{ help }}
		</p>
		<input
			type="number"
			:value="answer ?? ''"
			:min="min ?? undefined"
			:max="max ?? undefined"
			:step="integer ? 1 : 'any'"
			:class="pika({ padding: '4px 6px', fontSize: '12px', border: '1px solid var(--lab-color-border)', borderRadius: 'var(--lab-radius)', background: 'var(--lab-color-surface-alt)', color: 'var(--lab-color-text)' })"
			@change="onChange"
		>
		<p
			v-for="issue in answerIssues"
			:key="issue.message"
			:class="pika({ margin: '0', fontSize: '11px', color: 'var(--lab-color-danger)' })"
		>
			{{ issue.message }}
		</p>
	</div>
</template>
