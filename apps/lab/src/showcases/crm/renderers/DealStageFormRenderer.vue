<script setup lang="ts">
/**
 * Renders whatever `save()` reports through `useMethodIssues()` even though this component never calls
 * `save`/`cancel` itself — those are triggered by the sibling `Button#save-stage`/`Button#cancel-stage`
 * widgets in the `actions` slot, each invoking `deal-stage-form.save`/`cancel` through their own
 * configured `action` dependency (checkpoint §6). `canSave` only ever gates the actions container's
 * opacity as a visual status indicator here — it does not disable the Save button (`Button` exposes no
 * `disabled` state), and `save()` itself does not consume/depend on it (checkpoint §2; PR #22 review
 * 4941241562 non-blocking note: corrected from an earlier comment that claimed this gated `disabled`).
 */
import { useWidget } from '@deviltea/widget-vue'
import { DealStageFormPlugin } from '../plugins/deal-stage-form'

const { useProperties, useMethodIssues, WidgetSlot } = useWidget(DealStageFormPlugin)
const { selectedDeal, canSave } = useProperties()
const { save: saveIssues, open: openIssues } = useMethodIssues()
</script>

<template>
	<div :class="pika({ display: 'flex', flexDirection: 'column', gap: '10px' })">
		<p
			v-if="selectedDeal"
			:class="pika({ margin: '0', fontSize: '12px' })"
		>
			{{ selectedDeal.company }} — currently <strong>{{ selectedDeal.stage }}</strong>
		</p>
		<p
			v-else
			:class="pika({ margin: '0', fontSize: '12px', color: 'var(--lab-color-text-muted)', fontStyle: 'italic' })"
		>
			No deal selected.
		</p>
		<WidgetSlot name="fields" />
		<ul
			v-if="saveIssues.length > 0 || openIssues.length > 0"
			:class="pika({ margin: '0', paddingLeft: '16px' })"
		>
			<li
				v-for="issue in [...openIssues, ...saveIssues]"
				:key="issue.message"
				:class="pika({ fontSize: '11px', color: 'var(--lab-color-danger)' })"
			>
				{{ issue.message }}
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
