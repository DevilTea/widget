<script setup lang="ts">
/**
 * Presentation only: a number input. It shows Properties (`visible`, `text`, `required`, `errors`) and
 * writes State `answer`: an empty box is `null`, anything else goes through `Number` and a non-finite
 * result is `null`. It sets no `min`, `max` or `step` on the input and never rejects a number: a number
 * that breaks the config is stored and the plugin reports it in `errors`.
 */
import { useWidget } from '@deviltea/widget-vue'
import { useInspectAnchor } from '../../../composables/use-inspect-anchor'
import { surveyQuestionTarget } from '../../../tutorial/survey-target-map'
import { NumericPlugin } from '../plugins/numeric'
import QuestionFrame from './QuestionFrame.vue'

const { useState, useProperties, widgetId, widgetType } = useWidget(NumericPlugin)
const { answer } = useState()
const { text, visible, required, errors } = useProperties()

const anchor = useInspectAnchor(widgetId, widgetType)
const tutorialTarget = surveyQuestionTarget(widgetId)

function onInput(event: Event): void {
	const raw = (event.target as HTMLInputElement).value
	const parsed = raw === '' ? Number.NaN : Number(raw)
	answer.value = Number.isFinite(parsed) ? parsed : null
}
</script>

<template>
	<QuestionFrame
		v-if="visible === true"
		:label="text?.label ?? widgetId"
		:help="text?.help ?? null"
		:required="required === true"
		:errors="errors ?? []"
		:anchor="anchor"
		:tutorialTarget="tutorialTarget"
	>
		<template #default="{ inputId, describedBy, invalid, required: isRequired }">
			<input
				:id="inputId"
				type="number"
				inputmode="decimal"
				:value="answer ?? ''"
				:aria-describedby="describedBy"
				:aria-invalid="invalid ? 'true' : undefined"
				:aria-required="isRequired ? 'true' : undefined"
				:class="pika({ boxSizing: 'border-box', width: '100%', maxWidth: '240px', minHeight: '40px', padding: '6px 10px', fontSize: '17px', border: '1px solid var(--lab-color-border)', borderRadius: 'var(--lab-radius)', background: 'var(--lab-color-surface-alt)', color: 'var(--lab-color-text)' })"
				@input="onInput"
			>
		</template>
	</QuestionFrame>
</template>
