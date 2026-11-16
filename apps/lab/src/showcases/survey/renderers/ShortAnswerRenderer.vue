<script setup lang="ts">
/**
 * Presentation only: a text input. It shows Properties (`visible`, `text`, `required`, `errors`) and
 * writes State `answer`: an empty box is `null`, anything else is stored as typed (the plugin trims and
 * counts it). It sets no `maxlength`: a text that is too long is stored and reported in `errors`.
 */
import { useWidget } from '@deviltea/widget-vue'
import { useInspectAnchor } from '../../../composables/use-inspect-anchor'
import { surveyQuestionTarget } from '../../../tutorial/survey-target-map'
import { ShortAnswerPlugin } from '../plugins/short-answer'
import { FIELD_STYLE } from './control-style'
import QuestionFrame from './QuestionFrame.vue'

const { useState, useProperties, widgetId, widgetType } = useWidget(ShortAnswerPlugin)
const { answer } = useState()
const { text, visible, required, errors } = useProperties()

const anchor = useInspectAnchor(widgetId, widgetType)
const tutorialTarget = surveyQuestionTarget(widgetId)

function onInput(event: Event): void {
	const raw = (event.target as HTMLInputElement).value
	answer.value = raw === '' ? null : raw
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
				type="text"
				autocomplete="off"
				:value="answer ?? ''"
				:aria-describedby="describedBy"
				:aria-invalid="invalid ? 'true' : undefined"
				:aria-required="isRequired ? 'true' : undefined"
				:class="pika({ boxSizing: 'border-box', width: '100%', maxWidth: '420px', minHeight: '40px', padding: '6px 10px', borderRadius: 'var(--lab-radius)', background: 'var(--lab-color-surface-alt)' })"
				:style="FIELD_STYLE"
				@input="onInput"
			>
		</template>
	</QuestionFrame>
</template>
