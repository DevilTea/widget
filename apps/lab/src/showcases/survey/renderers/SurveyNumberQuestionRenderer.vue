<script setup lang="ts">
/**
 * Thin presentation only. `min`/`max`/`integer` are read as Properties (config-derived) purely to
 * drive the `<input>` attributes; the authoritative accept/reject decision is `answer.validate`
 * (checkpoint §2) — this component never re-validates before writing.
 *
 * Diagnostic #28 accessibility fix: `useId()`-derived `for`/`id` ties the visible `label` to the `input`;
 * when `help` is configured, its paragraph gets its own id and the `input` points to it via
 * `aria-describedby` (help text is supplementary, not the accessible name).
 *
 * `data-tutorial-target` (diagnostic #25 P1): this component renders Adults/Children/Budget alike, so the
 * target key is looked up by `label` (`SURVEY_NUMBER_QUESTION_TARGETS`) rather than hardcoded — see that
 * module's header for why label, not widget id, is what a renderer can see.
 */
import { useWidget } from '@deviltea/widget-vue'
import { computed, useId } from 'vue'
import { useInspectAnchor } from '../../../composables/use-inspect-anchor'
import { SURVEY_NUMBER_QUESTION_TARGETS } from '../../../tutorial/survey-target-map'
import { SurveyNumberQuestionPlugin } from '../plugins/survey-questions'

const { useState, useProperties, useStateDiagnostics, widgetId, widgetType } = useWidget(SurveyNumberQuestionPlugin)
const { answer } = useState()
const { label, help, min, max, integer } = useProperties()
const { answer: answerDiagnostics } = useStateDiagnostics()

const inputId = useId()
const helpId = useId()
const tutorialTarget = computed(() => label.value === null ? undefined : SURVEY_NUMBER_QUESTION_TARGETS[label.value])
const inspectAnchor = useInspectAnchor(widgetId, widgetType)

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
	<div
		:data-tutorial-target="tutorialTarget"
		v-bind="inspectAnchor"
		:class="pika({ display: 'flex', flexDirection: 'column', gap: '4px', padding: '6px 0' })"
	>
		<label
			:for="inputId"
			:class="pika({ fontSize: '12px', fontWeight: '600' })"
		>{{ label }}</label>
		<p
			v-if="help"
			:id="helpId"
			:class="pika({ margin: '0', fontSize: '11px', color: 'var(--lab-color-text-muted)' })"
		>
			{{ help }}
		</p>
		<input
			:id="inputId"
			type="number"
			:value="answer ?? ''"
			:min="min ?? undefined"
			:max="max ?? undefined"
			:step="integer ? 1 : 'any'"
			:aria-describedby="help ? helpId : undefined"
			:class="pika({ padding: '4px 6px', fontSize: '12px', border: '1px solid var(--lab-color-border)', borderRadius: 'var(--lab-radius)', background: 'var(--lab-color-surface-alt)', color: 'var(--lab-color-text)' })"
			@change="onChange"
		>
		<p
			v-for="diagnostic in answerDiagnostics"
			:key="diagnostic.message"
			:class="pika({ margin: '0', fontSize: '11px', color: 'var(--lab-color-danger)' })"
		>
			{{ diagnostic.message }}
		</p>
	</div>
</template>
