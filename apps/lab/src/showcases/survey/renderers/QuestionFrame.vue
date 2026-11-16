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
		:class="pika({ display: 'flex', flexDirection: 'column', gap: '8px', margin: '0', minWidth: '0', padding: '14px 16px', border: '0', boxShadow: 'inset 0 0 0 1px var(--lab-color-border)', borderRadius: 'var(--lab-radius)', background: 'var(--lab-color-surface)', color: 'var(--lab-color-text)', fontSize: '16px' })"
	>
		<component
			:is="group ? 'legend' : 'label'"
			:for="group ? undefined : inputId"
			:class="[pika({ padding: '0', fontSize: '18px', fontWeight: '600', lineHeight: '1.35' }), group ? pika({ float: 'left', width: '100%', marginBottom: '8px' }) : undefined]"
		>
			{{ label }}<span
				v-if="required"
				aria-hidden="true"
				:class="pika({ marginLeft: '4px', color: 'var(--lab-color-danger)' })"
			>*</span>
		</component>
		<p
			v-if="help"
			:id="helpId"
			:class="pika({ margin: '0', fontSize: '15px', color: 'var(--lab-color-text-muted)' })"
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
			:class="pika({ display: 'flex', flexDirection: 'column', gap: '4px' })"
		>
			<p
				v-for="(error, index) in errors"
				:key="`${index}:${error.code}`"
				data-testid="survey-question-error"
				:data-error-code="error.code"
				:class="pika({ margin: '0', padding: '2px 0 2px 10px', borderLeft: '4px solid var(--lab-color-danger)', fontSize: '16px', fontWeight: '600', lineHeight: '1.35', color: 'var(--lab-color-danger)' })"
			>
				<span aria-hidden="true">&#9888; </span>{{ error.message }}
			</p>
		</div>
	</component>
</template>
