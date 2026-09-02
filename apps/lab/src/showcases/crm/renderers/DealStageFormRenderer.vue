<script setup lang="ts">
/**
 * Renders whatever `save()` reports through `useMethodDiagnostics()` even though this component never calls
 * `save`/`cancel` itself — those are triggered by the sibling `Button#save-stage`/`Button#cancel-stage`
 * widgets in the `actions` slot, each invoking `deal-stage-form.save`/`cancel` through their own
 * configured `action` dependency (checkpoint §6). `canSave` only ever gates the actions container's
 * opacity as a visual status indicator here — it does not disable the Save button (`Button` exposes no
 * `disabled` state), and `save()` itself does not consume/depend on it. #43 translates only the fixed
 * connector/empty-state prose; deal company/stage and core method diagnostics stay verbatim semantic data.
 */
import { useWidget } from '@deviltea/widget-vue'
import { useInspectAnchor } from '../../../composables/use-inspect-anchor'
import { useLabI18n } from '../../../composables/use-lab-i18n'
import { DealStageFormPlugin } from '../plugins/deal-stage-form'

const { useProperties, useMethodDiagnostics, WidgetSlot, widgetId, widgetType } = useWidget(DealStageFormPlugin)
const { selectedDeal, canSave } = useProperties()
const { save: saveDiagnostics, open: openDiagnostics } = useMethodDiagnostics()
const i18n = useLabI18n()
const inspectAnchor = useInspectAnchor(widgetId, widgetType)
</script>

<template>
	<div
		v-bind="inspectAnchor"
		:class="pika({ display: 'flex', flexDirection: 'column', gap: '10px' })"
	>
		<p
			v-if="selectedDeal"
			:class="pika({ margin: '0', fontSize: '12px' })"
		>
			{{ selectedDeal.company }} — {{ i18n.t('currently') }} <strong>{{ selectedDeal.stage }}</strong>
		</p>
		<p
			v-else
			:class="pika({ margin: '0', fontSize: '12px', color: 'var(--lab-color-text-muted)', fontStyle: 'italic' })"
		>
			{{ i18n.t('No deal selected.') }}
		</p>
		<WidgetSlot name="fields" />
		<ul
			v-if="saveDiagnostics.length > 0 || openDiagnostics.length > 0"
			:class="pika({ margin: '0', paddingLeft: '16px' })"
		>
			<li
				v-for="diagnostic in [...openDiagnostics, ...saveDiagnostics]"
				:key="diagnostic.message"
				:class="pika({ fontSize: '11px', color: 'var(--lab-color-danger)' })"
			>
				{{ diagnostic.message }}
			</li>
		</ul>
		<div
			data-can-save-hint
			:class="pika({ display: 'flex', justifyContent: 'flex-end', gap: '8px' })"
			:style="{ opacity: canSave ? '1' : '0.6' }"
		>
			<WidgetSlot name="actions" />
		</div>
	</div>
</template>
