<script setup lang="ts">
/**
 * Presentation only: checkboxes in a `fieldset`. Everything it shows is a Property of the widget:
 * `visible` (nothing renders unless it is `true`), `text`, `required`, `options` and `errors`. Toggling
 * a box writes State `answer` (the raw selection, `null` when nothing is left); the plugin decides
 * which of those values count and what is an error.
 */
import { useWidget } from '@deviltea/widget-vue'
import { computed } from 'vue'
import { useInspectAnchor } from '../../../composables/use-inspect-anchor'
import { surveyQuestionTarget } from '../../../tutorial/survey-target-map'
import { MultipleChoicePlugin } from '../plugins/multiple-choice'
import { choiceRows } from './choice-rows'
import QuestionFrame from './QuestionFrame.vue'

const { useState, useProperties, widgetId, widgetType } = useWidget(MultipleChoicePlugin)
const { answer } = useState()
const { text, visible, required, options, errors } = useProperties()

const anchor = useInspectAnchor(widgetId, widgetType)
const tutorialTarget = surveyQuestionTarget(widgetId)
const rows = computed(() => choiceRows(text.value, options.value))

function toggle(value: string, checked: boolean): void {
	const kept = (answer.value ?? []).filter(item => item !== value)
	const next = checked ? [...kept, value] : kept
	answer.value = next.length === 0 ? null : next
}
</script>

<template>
	<QuestionFrame
		v-if="visible === true"
		group
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
				:style="row.enabled ? undefined : { color: 'var(--lab-color-text-muted)', cursor: 'not-allowed' }"
			>
				<input
					type="checkbox"
					:value="row.value"
					:checked="answer?.includes(row.value) === true"
					:disabled="!row.enabled"
					class="option-control"
					@change="toggle(row.value, ($event.target as HTMLInputElement).checked)"
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
	accent-color: var(--lab-color-accent);
}
</style>
