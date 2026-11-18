<script setup lang="ts">
/**
 * Presentation only: a text input. It shows Properties (`visible`, `text`, `required`, `errors`) and
 * writes State `answer`: an empty box is `null`, anything else is stored as typed (the plugin trims and
 * counts it). It sets no `maxlength`: a text that is too long is stored and reported in `errors`.
 */
import { useWidget } from '@deviltea/widget-vue'
import { useInspectAnchor } from '../../../showcase-host'
import { ShortAnswerPlugin } from '../plugins/short-answer'
import { surveyQuestionTarget } from '../tutorial-targets'
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
				class="field"
				:style="FIELD_STYLE"
				@input="onInput"
			>
		</template>
	</QuestionFrame>
</template>

<style scoped>
/*
 * The text colour, size, weight and border of a native control are set inline (`control-style.ts`). The corners
 * stay square: `styles/preview-frame.css` gives `input` a zero radius, so the survey's text inputs have always
 * been square (the language select, which that rule does not touch, is rounded).
 */
.field {
	box-sizing: border-box;
	width: 100%;
	max-width: 420px;
	min-height: 40px;
	padding: 6px 10px;
	background: var(--survey-color-surface-alt);
}
</style>
