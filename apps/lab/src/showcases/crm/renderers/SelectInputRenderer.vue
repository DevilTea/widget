<script setup lang="ts">
/**
 * Thin presentation only. Reused as both `stage-filter` and `stage-editor` (including inside the modal
 * as "New stage") — options come entirely from `useProperties().options`.
 *
 * Diagnostic #28 accessibility fix: `useId()` gives this instance a stable id so the visible `label` is
 * programmatically associated with its `select` via `for`/`id` — same rationale as `TextInputRenderer.vue`.
 */
import { useWidget } from '@deviltea/widget-vue'
import { useId } from 'vue'
import { useInspectAnchor } from '../../../composables/use-inspect-anchor'
import { SelectInputPlugin } from '../plugins/inputs'

const { useState, useProperties, useStateDiagnostics, widgetId, widgetType } = useWidget(SelectInputPlugin)
const { value } = useState()
const { label, options } = useProperties()
const { value: valueDiagnostics } = useStateDiagnostics()

const selectId = useId()
const inspectAnchor = useInspectAnchor(widgetId, widgetType)

function onChange(event: Event): void {
	value.value = (event.target as HTMLSelectElement).value
}
</script>

<template>
	<div
		v-bind="inspectAnchor"
		:class="pika({ display: 'flex', flexDirection: 'column', gap: '4px' })"
	>
		<label
			:for="selectId"
			:class="pika({ fontSize: '11px', fontWeight: '600', color: 'var(--lab-color-text-muted)' })"
		>{{ label }}</label>
		<select
			:id="selectId"
			:value="value ?? ''"
			:class="pika({ padding: '5px 8px', fontSize: '12px', border: '1px solid var(--lab-color-border)', borderRadius: 'var(--lab-radius)', background: 'var(--lab-color-surface-alt)', color: 'var(--lab-color-text)' })"
			@change="onChange"
		>
			<option
				v-for="option in options"
				:key="option.value"
				:value="option.value"
			>
				{{ option.label }}
			</option>
		</select>
		<p
			v-for="diagnostic in valueDiagnostics"
			:key="diagnostic.message"
			:class="pika({ margin: '0', fontSize: '11px', color: 'var(--lab-color-danger)' })"
		>
			{{ diagnostic.message }}
		</p>
	</div>
</template>
