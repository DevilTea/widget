<script setup lang="ts">
/**
 * `rowIdKey`/`columns` come entirely from `useProperties()` — Lab-private semantic projections of
 * `Table`'s own resolved config (`../plugins/read-models.ts`) — never hardcoded here, so a valid edited
 * Source that changes `rowIdKey`/`columns` reaches this renderer. Row click always calls
 * `Table.selectRow(id)` — never local selection state. Keyboard activation (Enter/Space) calls the same
 * semantic path. #43 translates only the hardcoded empty-state sentence; configured column labels,
 * row values, selection identity, and method diagnostics remain verbatim semantic/source-owned data.
 */
import { useWidget } from '@deviltea/widget-vue'
import { computed } from 'vue'
import { useInspectAnchor } from '../../../composables/use-inspect-anchor'
import { useLabI18n } from '../../../composables/use-lab-i18n'
import { TablePlugin } from '../plugins/read-models'

const { useState, useProperties, useMethods, useMethodDiagnostics, widgetId, widgetType } = useWidget(TablePlugin)
const { selectedRowId } = useState()
const { rows, empty, rowIdKey, columns } = useProperties()
const { selectRow } = useMethods()
const { selectRow: selectRowDiagnostics } = useMethodDiagnostics()
const i18n = useLabI18n()
const inspectAnchor = useInspectAnchor(widgetId, widgetType)
const tutorialTarget = computed(() => (widgetId === 'deal-table' ? 'crm-table' : undefined))

function rowId(row: Record<string, unknown>): unknown {
	const key = rowIdKey.value
	return key === null ? undefined : row[key]
}

function cellText(row: Record<string, unknown>, key: string, format: 'text' | 'currency' | 'badge' | undefined): string {
	const raw = row[key]
	if (format === 'currency' && typeof raw === 'number')
		return `$${raw.toLocaleString('en-US', { maximumFractionDigits: 0 })}`
	return String(raw ?? '')
}

function badgeColor(row: Record<string, unknown>, key: string): string {
	switch (row[key]) {
		case 'won': return 'var(--lab-color-ok)'
		case 'lost': return 'var(--lab-color-danger)'
		case 'negotiation': return 'var(--lab-color-warning)'
		default: return 'var(--lab-color-accent)'
	}
}

function onRowClick(row: Record<string, unknown>): void {
	const id = rowId(row)
	if (typeof id === 'string')
		selectRow(id)
}

function onRowKeydown(event: KeyboardEvent, row: Record<string, unknown>): void {
	if (event.key === 'Enter') {
		onRowClick(row)
	}
	else if (event.key === ' ' || event.key === 'Spacebar') {
		event.preventDefault()
		onRowClick(row)
	}
}
</script>

<template>
	<div
		v-bind="inspectAnchor"
		:data-tutorial-target="tutorialTarget"
		:class="pika({ display: 'flex', flexDirection: 'column', gap: '6px' })"
	>
		<table
			v-if="!empty"
			:class="pika({ width: '100%', borderCollapse: 'collapse', fontSize: '12px' })"
		>
			<thead>
				<tr>
					<th
						v-for="column in columns"
						:key="column.key"
						:class="pika({ textAlign: 'left', padding: '6px 8px', borderBottom: '1px solid var(--lab-color-border)', color: 'var(--lab-color-text-muted)', fontWeight: '600' })"
					>
						{{ column.label }}
					</th>
				</tr>
			</thead>
			<tbody>
				<tr
					v-for="row in rows"
					:key="String(rowId(row))"
					tabindex="0"
					:aria-current="rowId(row) === selectedRowId ? 'true' : undefined"
					:class="pika({ 'cursor': 'pointer', 'borderBottom': '1px solid var(--lab-color-border)', '$:focus-visible': { outline: '2px solid var(--lab-color-accent)', outlineOffset: '-2px' } })"
					:style="{ background: rowId(row) === selectedRowId ? 'var(--lab-color-surface-alt)' : 'transparent' }"
					@click="onRowClick(row)"
					@keydown="onRowKeydown($event, row)"
				>
					<td
						v-for="column in columns"
						:key="column.key"
						:class="pika({ padding: '6px 8px' })"
					>
						<span
							v-if="column.format === 'badge'"
							:class="pika({ display: 'inline-block', padding: '1px 8px', borderRadius: '999px', fontSize: '11px', color: 'var(--lab-color-bg)' })"
							:style="{ background: badgeColor(row, column.key) }"
						>{{ cellText(row, column.key, column.format) }}</span>
						<template v-else>
							{{ cellText(row, column.key, column.format) }}
						</template>
					</td>
				</tr>
			</tbody>
		</table>
		<p
			v-else
			:class="pika({ margin: '0', fontSize: '12px', color: 'var(--lab-color-text-muted)', fontStyle: 'italic' })"
		>
			{{ i18n.t('No deals match the current search/filter.') }}
		</p>
		<p
			v-for="diagnostic in selectRowDiagnostics"
			:key="diagnostic.message"
			:class="pika({ margin: '0', fontSize: '11px', color: 'var(--lab-color-danger)' })"
		>
			{{ diagnostic.message }}
		</p>
	</div>
</template>
