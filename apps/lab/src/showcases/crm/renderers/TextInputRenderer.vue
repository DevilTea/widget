<script setup lang="ts">
/** Thin presentation only: this showcase's generic search box. CRM search semantics live in `DealQuery`. */
import { useWidget } from '@deviltea/widget-vue'
import { TextInputPlugin } from '../plugins/inputs'

const { useState, useProperties, useStateIssues } = useWidget(TextInputPlugin)
const { value } = useState()
const { label, placeholder } = useProperties()
const { value: valueIssues } = useStateIssues()

function onInput(event: Event): void {
	value.value = (event.target as HTMLInputElement).value
}
</script>

<template>
	<div :class="pika({ display: 'flex', flexDirection: 'column', gap: '4px' })">
		<label :class="pika({ fontSize: '11px', fontWeight: '600', color: 'var(--lab-color-text-muted)' })">{{ label }}</label>
		<input
			type="text"
			:value="value ?? ''"
			:placeholder="placeholder ?? ''"
			:class="pika({ padding: '5px 8px', fontSize: '12px', minWidth: '220px', border: '1px solid var(--lab-color-border)', borderRadius: 'var(--lab-radius)', background: 'var(--lab-color-surface-alt)', color: 'var(--lab-color-text)' })"
			@input="onInput"
		>
		<p
			v-for="issue in valueIssues"
			:key="issue.message"
			:class="pika({ margin: '0', fontSize: '11px', color: 'var(--lab-color-danger)' })"
		>
			{{ issue.message }}
		</p>
	</div>
</template>
