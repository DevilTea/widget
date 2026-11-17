<script setup lang="ts">
/**
 * Presentation only: a number input. It shows Properties (`visible`, `text`, `required`, `errors`) and
 * writes State `answer`: an empty box is `null`, anything else goes through `Number` and a non-finite
 * result is `null`. It sets no `min`, `max` or `step` on the input and never rejects a number: a number
 * that breaks the config is stored and the plugin reports it in `errors`. The wheel blurs the input, so
 * scrolling over it never changes the value.
 */
import { useWidget } from '@deviltea/widget-vue'
import { useInspectAnchor } from '../../../composables/use-inspect-anchor'
import { surveyQuestionTarget } from '../../../tutorial/survey-target-map'
import { NumericPlugin } from '../plugins/numeric'
import { FIELD_STYLE } from './control-style'
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

/** A focused number input changes its value on the mouse wheel; scrolling the page must not edit the answer. */
function onWheel(event: Event): void {
	(event.target as HTMLInputElement).blur()
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
				class="field"
				:style="FIELD_STYLE"
				@input="onInput"
				@wheel="onWheel"
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
	max-width: 240px;
	min-height: 40px;
	padding: 6px 10px;
	background: var(--lab-color-surface-alt);
}
</style>
