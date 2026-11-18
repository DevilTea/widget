<script setup lang="ts">
/**
 * The frame every survey question renderer shares: the anchored root element, the visible question
 * text, the optional help text and the answer errors. Props only; it reads no widget.
 *
 * Accessibility: a group (radio buttons, checkboxes) is a `fieldset` whose `legend` names it; any other
 * question is a `div` whose `label` is tied to its control through the `inputId` slot prop (`useId()`).
 * Help and errors are linked to the control (or the group) through `aria-describedby`; the errors sit in
 * a polite live region. Required is shown with an `aria-hidden` marker and exposed to assistive
 * technology as `aria-required` on the control (or on a `radiogroup`).
 *
 * The card outline is an inset shadow, not a border, and a group's `legend` is floated: a browser places a
 * `legend` on the top edge of its `fieldset`, which would cut the outline at the question text.
 *
 * Errors are always shown (owner decision): they are part of the question's current state from load, in
 * the danger colour, bold and with a bar and a glyph, so the signal never rests on colour alone.
 */
import type { InspectAnchorAttributes } from '@deviltea/widget-inspector/anchor'
import type { AnswerError } from '../domain'
import { computed, useId } from 'vue'

const props = defineProps<{
	label: string
	help: string | null
	required: boolean
	errors: readonly AnswerError[]
	/** Render a `fieldset`/`legend` instead of a `div`/`label` (radio buttons and checkboxes). */
	group?: boolean
	/** The ARIA role of a group; `radiogroup` also carries `aria-required` and `aria-invalid`. */
	groupRole?: 'radiogroup'
	anchor: InspectAnchorAttributes
	tutorialTarget?: string
}>()

defineSlots<{
	default: (slotProps: { inputId: string, describedBy: string | undefined, invalid: boolean, required: boolean }) => unknown
}>()

const inputId = useId()
const helpId = useId()
const errorsId = useId()

const invalid = computed(() => props.errors.length > 0)
const describedBy = computed(() => {
	const ids = [...(props.help ? [helpId] : []), ...(invalid.value ? [errorsId] : [])]
	return ids.length === 0 ? undefined : ids.join(' ')
})
const isRadioGroup = computed(() => props.groupRole === 'radiogroup')
</script>

<template>
	<component
		:is="group ? 'fieldset' : 'div'"
		v-bind="anchor"
		:data-tutorial-target="tutorialTarget"
		:role="groupRole"
		:aria-required="isRadioGroup && required ? 'true' : undefined"
		:aria-invalid="isRadioGroup && invalid ? 'true' : undefined"
		:aria-describedby="group ? describedBy : undefined"
		class="question"
	>
		<component
			:is="group ? 'legend' : 'label'"
			:for="group ? undefined : inputId"
			class="question-label"
			:class="[group && 'question-label-group']"
		>
			{{ label }}<span
				v-if="required"
				aria-hidden="true"
				class="question-required"
			>*</span>
		</component>
		<p
			v-if="help"
			:id="helpId"
			class="question-help"
		>
			{{ help }}
		</p>
		<slot
			:inputId="inputId"
			:describedBy="describedBy"
			:invalid="invalid"
			:required="required"
		/>
		<div
			:id="errorsId"
			aria-live="polite"
			class="question-errors"
		>
			<p
				v-for="(error, index) in errors"
				:key="`${index}:${error.code}`"
				data-testid="survey-question-error"
				:data-error-code="error.code"
				class="question-error"
			>
				<span aria-hidden="true">&#9888; </span>{{ error.message }}
			</p>
		</div>
	</component>
</template>

<style scoped>
.question {
	display: flex;
	flex-direction: column;
	gap: 8px;
	margin: 0;
	min-width: 0;
	padding: 14px 16px;
	border: 0;
	box-shadow: inset 0 0 0 1px var(--survey-color-border);
	border-radius: var(--survey-radius);
	background: var(--survey-color-surface);
	color: var(--survey-color-text);
	font-size: 16px;
}

.question-label {
	padding: 0;
	font-size: 18px;
	font-weight: 600;
	line-height: 1.35;
}

/* A group's legend: floated, see the file comment. */
.question-label-group {
	float: left;
	width: 100%;
	margin-bottom: 8px;
}

.question-required {
	margin-left: 4px;
	color: var(--survey-color-danger);
}

.question-help {
	margin: 0;
	font-size: 15px;
	color: var(--survey-color-text-muted);
}

.question-errors {
	display: flex;
	flex-direction: column;
	gap: 4px;
}

.question-error {
	margin: 0;
	padding: 2px 0 2px 10px;
	border-left: 4px solid var(--survey-color-danger);
	font-size: 16px;
	font-weight: 600;
	line-height: 1.35;
	color: var(--survey-color-danger);
}
</style>
