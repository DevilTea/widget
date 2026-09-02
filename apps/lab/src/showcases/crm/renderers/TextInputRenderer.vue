<script setup lang="ts">
/**
 * Thin presentation only: this showcase's generic search box. CRM search semantics live in `DealQuery`.
 *
 * Diagnostic #28 accessibility fix: `useId()` gives this instance a stable id so the visible `label` is
 * programmatically associated with its `input` via `for`/`id` (Vue's `useId()` is per-component-instance
 * and SSR-stable, matching the resolved-config-projection style already used elsewhere in this showcase
 * — no renderer-local generated-id state to keep in sync with anything semantic).
 *
 * `data-tutorial-target` (diagnostic #25 P4): `deal-search` is this preset's only `TextInput` instance, so a
 * plain widget-id equality check (rather than a label-keyed lookup table like Survey's renderers needed
 * pre-P2) is enough — see `crm-target-map.ts`'s header for why widget id, not label, is available here.
 */
import { useWidget } from '@deviltea/widget-vue'
import { computed, useId } from 'vue'
import { useInspectAnchor } from '../../../composables/use-inspect-anchor'
import { TextInputPlugin } from '../plugins/inputs'

const { useState, useProperties, useStateDiagnostics, widgetId, widgetType } = useWidget(TextInputPlugin)
const { value } = useState()
const { label, placeholder } = useProperties()
const { value: valueDiagnostics } = useStateDiagnostics()

const inputId = useId()
const inspectAnchor = useInspectAnchor(widgetId, widgetType)
const tutorialTarget = computed(() => (widgetId === 'deal-search' ? 'crm-search' : undefined))

function onInput(event: Event): void {
	value.value = (event.target as HTMLInputElement).value
}
</script>

<template>
	<div
		v-bind="inspectAnchor"
		:data-tutorial-target="tutorialTarget"
		:class="pika({ display: 'flex', flexDirection: 'column', gap: '4px' })"
	>
		<label
			:for="inputId"
			:class="pika({ fontSize: '11px', fontWeight: '600', color: 'var(--lab-color-text-muted)' })"
		>{{ label }}</label>
		<input
			:id="inputId"
			type="text"
			:value="value ?? ''"
			:placeholder="placeholder ?? ''"
			:class="pika({ padding: '5px 8px', fontSize: '12px', minWidth: '220px', border: '1px solid var(--lab-color-border)', borderRadius: 'var(--lab-radius)', background: 'var(--lab-color-surface-alt)', color: 'var(--lab-color-text)' })"
			@input="onInput"
		>
		<p
			v-for="diagnostic in valueDiagnostics"
			:key="diagnostic.message"
			:class="pika({ margin: '0', fontSize: '11px', color: 'var(--lab-color-danger)' })"
		>
			{{ diagnostic.message }}
		</p>
	</div>
</template>
