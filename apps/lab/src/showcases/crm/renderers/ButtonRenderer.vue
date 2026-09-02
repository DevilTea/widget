<script setup lang="ts">
/**
 * `press()` invokes the configured no-argument Method dependency directly — this component never
 * re-validates or duplicates that decision (mirroring Showcase A's `TripSurveyRenderer` "Vue must call
 * semantic Methods directly" rule). `label`/`kind` are exposed via `properties` as a deliberate, narrow
 * deviation from the checkpoint's literal capability list — see `../plugins/actions.ts`'s file header.
 *
 * `data-tutorial-target` (diagnostic #25 P4): `Button` is reused four times in this preset ("Reset data",
 * "Change stage", "Save", "Cancel"), so this needs the widget-id-keyed lookup table
 * (`crm-target-map.ts`) rather than an unconditional attribute — only "Change stage" (the CRM tour's own
 * target) has an entry; the other three render no `data-tutorial-target` at all.
 */
import { useWidget } from '@deviltea/widget-vue'
import { computed } from 'vue'
import { useInspectAnchor } from '../../../composables/use-inspect-anchor'
import { CRM_BUTTON_TARGETS } from '../../../tutorial/crm-target-map'
import { ButtonPlugin } from '../plugins/actions'

const { useProperties, useMethods, useMethodDiagnostics, widgetId, widgetType } = useWidget(ButtonPlugin)
const { label, kind } = useProperties()
const { press } = useMethods()
const { press: pressDiagnostics } = useMethodDiagnostics()

const accentColor = computed(() => {
	switch (kind.value) {
		case 'primary': return 'var(--lab-color-accent)'
		case 'danger': return 'var(--lab-color-danger)'
		default: return 'var(--lab-color-border)'
	}
})
const inspectAnchor = useInspectAnchor(widgetId, widgetType)
const tutorialTarget = computed(() => CRM_BUTTON_TARGETS[widgetId])

function onClick(): void {
	press()
}
</script>

<template>
	<div
		v-bind="inspectAnchor"
		:data-tutorial-target="tutorialTarget"
		:class="pika({ display: 'flex', flexDirection: 'column', gap: '4px' })"
	>
		<button
			type="button"
			:class="pika({ padding: '6px 12px', fontSize: '12px', borderRadius: 'var(--lab-radius)', background: 'var(--lab-color-surface-alt)', color: 'var(--lab-color-text)', cursor: 'pointer' })"
			:style="{ border: `1px solid ${accentColor}` }"
			@click="onClick"
		>
			{{ label }}
		</button>
		<p
			v-for="diagnostic in pressDiagnostics"
			:key="diagnostic.message"
			:class="pika({ margin: '0', fontSize: '11px', color: 'var(--lab-color-danger)' })"
		>
			{{ diagnostic.message }}
		</p>
	</div>
</template>
