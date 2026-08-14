<script setup lang="ts">
/**
 * `press()` invokes the configured no-argument Method dependency directly — this component never
 * re-validates or duplicates that decision (mirroring Showcase A's `TripSurveyRenderer` "Vue must call
 * semantic Methods directly" rule). `label`/`kind` are exposed via `properties` as a deliberate, narrow
 * deviation from the checkpoint's literal capability list — see `../plugins/actions.ts`'s file header.
 */
import { useWidget } from '@deviltea/widget-vue'
import { computed } from 'vue'
import { ButtonPlugin } from '../plugins/actions'

const { useProperties, useMethods, useMethodIssues } = useWidget(ButtonPlugin)
const { label, kind } = useProperties()
const { press } = useMethods()
const { press: pressIssues } = useMethodIssues()

const accentColor = computed(() => {
	switch (kind.value) {
		case 'primary': return 'var(--lab-color-accent)'
		case 'danger': return 'var(--lab-color-danger)'
		default: return 'var(--lab-color-border)'
	}
})

function onClick(): void {
	press()
}
</script>

<template>
	<div :class="pika({ display: 'flex', flexDirection: 'column', gap: '4px' })">
		<button
			type="button"
			:class="pika({ padding: '6px 12px', fontSize: '12px', borderRadius: 'var(--lab-radius)', background: 'var(--lab-color-surface-alt)', color: 'var(--lab-color-text)', cursor: 'pointer' })"
			:style="{ border: `1px solid ${accentColor}` }"
			@click="onClick"
		>
			{{ label }}
		</button>
		<p
			v-for="issue in pressIssues"
			:key="issue.message"
			:class="pika({ margin: '0', fontSize: '11px', color: 'var(--lab-color-danger)' })"
		>
			{{ issue.message }}
		</p>
	</div>
</template>
