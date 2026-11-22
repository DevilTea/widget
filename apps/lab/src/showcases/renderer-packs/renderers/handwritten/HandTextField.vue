<script setup lang="ts">
/**
 * Hand-written pack. Presentation only: a native text box bound to State `value` and the validation message of Property
 * `message`. Writing State is always accepted; the plugin says whether the value is acceptable. The density is Property
 * `density`, which the widget read from the Appearance it names.
 */
import { useWidget } from '@deviltea/widget-vue'
import { computed, useId } from 'vue'
import { useInspectAnchor } from '../../../../showcase-host'
import { textLength } from '../../domain'
import { TextFieldPlugin } from '../../plugins/text-field'
import { usePacksText } from '../use-packs-text'

const { useState, useProperties, widgetId, widgetType } = useWidget(TextFieldPlugin)
const { value } = useState()
const { label, placeholder, maxLength, message, density } = useProperties()
const { tf, text } = usePacksText()
const anchor = useInspectAnchor(widgetId, widgetType)
const inputId = useId()
const messageId = useId()
const problem = computed(() => message.value === null || message.value === undefined ? null : text(message.value))
</script>

<template>
	<div
		v-bind="anchor"
		:data-tutorial-target="`packs-${widgetId}`"
		class="field"
		:data-packs-density="density ?? 'comfortable'"
	>
		<label
			:for="inputId"
			class="field-label"
		>{{ label === null ? widgetId : text(label) }}</label>
		<input
			:id="inputId"
			type="text"
			class="field-input"
			:value="value ?? ''"
			:placeholder="placeholder === null || placeholder === undefined ? undefined : text(placeholder)"
			:aria-invalid="problem === null ? undefined : 'true'"
			:aria-describedby="messageId"
			:data-testid="`hand-input-${widgetId}`"
			@input="value = ($event.target as HTMLInputElement).value"
		>
		<p
			:id="messageId"
			class="field-hint"
			:class="{ 'field-hint--error': problem !== null }"
			:data-testid="`hand-message-${widgetId}`"
		>
			{{ problem ?? tf('characters', { count: textLength(value ?? ''), max: maxLength ?? 0 }) }}
		</p>
	</div>
</template>

<style scoped>
.field {
	display: flex;
	flex-direction: column;
	gap: 4px;
	max-width: 420px;
}

.field[data-packs-density='compact'] {
	gap: 2px;
}

.field-label {
	font-size: 14px;
	font-weight: 600;
}

.field-input {
	box-sizing: border-box;
	min-height: var(--packs-control-height);
	padding: 4px 10px;
	border: 1px solid var(--packs-control-border);
	border-radius: var(--packs-radius);
	background: var(--packs-surface-alt);
	color: var(--packs-text);
	font: inherit;
	font-size: 15px;
}

.field-input[aria-invalid='true'] {
	border-color: var(--packs-danger);
}

.field-input:focus-visible {
	outline: 2px solid var(--packs-accent);
	outline-offset: 2px;
}

.field-hint {
	min-height: 18px;
	margin: 0;
	font-size: 13px;
	color: var(--packs-text-muted);
}

.field-hint--error {
	color: var(--packs-danger);
}
</style>
