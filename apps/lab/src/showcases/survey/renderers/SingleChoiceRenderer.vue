<script setup lang="ts">
/**
 * Presentation only: a radio group in a `fieldset`. Everything it shows is a Property of the widget:
 * `visible` (nothing renders unless it is `true`), `text` (label, help and option labels in the survey
 * language), `required`, `options` (which options are visible and enabled) and `errors`. Choosing an
 * option writes State `answer`; the plugin owns what the answer means.
 *
 * Only `visible` is read while the question is hidden; the other Properties are read once it shows.
 */
import { useWidget } from '@deviltea/widget-vue'
import { computed, useId } from 'vue'
import { useInspectAnchor } from '../../../showcase-host'
import { SingleChoicePlugin } from '../plugins/single-choice'
import { surveyQuestionTarget } from '../tutorial-targets'
import { choiceRows } from './choice-rows'
import QuestionFrame from './QuestionFrame.vue'

const { useState, useProperties, widgetId, widgetType } = useWidget(SingleChoicePlugin)
const { answer } = useState()
const { text, visible, required, options, errors } = useProperties()

const groupName = useId()
const anchor = useInspectAnchor(widgetId, widgetType)
const tutorialTarget = surveyQuestionTarget(widgetId)
const rows = computed(() => choiceRows(text.value, options.value))

function select(value: string): void {
	answer.value = value
}
</script>

<template>
	<QuestionFrame
		v-if="visible === true"
		group
		groupRole="radiogroup"
		:label="text?.label ?? widgetId"
		:help="text?.help ?? null"
		:required="required === true"
		:errors="errors ?? []"
		:anchor="anchor"
		:tutorialTarget="tutorialTarget"
	>
		<div class="options">
			<label
				v-for="row in rows"
				:key="row.value"
				:data-option-value="row.value"
				class="option"
				:style="row.enabled ? undefined : { color: 'var(--survey-color-text-muted)', cursor: 'not-allowed' }"
			>
				<input
					type="radio"
					:name="groupName"
					:value="row.value"
					:checked="answer === row.value"
					:disabled="!row.enabled"
					class="option-control"
					@change="select(row.value)"
				>
				<span>{{ row.label }}</span>
			</label>
		</div>
	</QuestionFrame>
</template>

<style scoped>
.options {
	display: flex;
	flex-direction: column;
	gap: 2px;
}

.option {
	display: flex;
	align-items: center;
	gap: 12px;
	min-height: 32px;
	padding: 4px 0;
	font-size: 17px;
	cursor: pointer;
}

.option-control {
	flex: none;
	width: 24px;
	height: 24px;
	margin: 0;
	accent-color: var(--survey-color-accent);
}
</style>
