<script setup lang="ts">
/**
 * `rowIdKey`/`columns` come entirely from `useProperties()` — Lab-private semantic projections of
 * `Table`'s own resolved config (`../plugins/read-models.ts`) — never hardcoded here, so a valid edited
 * Source that changes `rowIdKey`/`columns` reaches this renderer (PR #22 review 4941241562 finding 1: a
 * still-valid edited Source setting `rowIdKey` to another string-valued field must key rows and call
 * `selectRow()` with that configured key, not a hardcoded `row.id`). Row click always calls
 * `Table.selectRow(id)` — never local selection state (checkpoint §5 "renderer selection callbacks
 * invoke `Table.selectRow`, not direct local selection state").
 */
import { useWidget } from '@deviltea/widget-vue'
import { TablePlugin } from '../plugins/read-models'

const { useState, useProperties, useMethods, useMethodIssues } = useWidget(TablePlugin)
const { selectedRowId } = useState()
const { rows, empty, rowIdKey, columns } = useProperties()
const { selectRow } = useMethods()
const { selectRow: selectRowIssues } = useMethodIssues()

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
		case 'won': return 'var(--lab-color-success)'
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
</script>

<template>
	<div :class="pika({ display: 'flex', flexDirection: 'column', gap: '6px' })">
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
					:class="pika({ cursor: 'pointer', borderBottom: '1px solid var(--lab-color-border)' })"
					:style="{ background: rowId(row) === selectedRowId ? 'var(--lab-color-surface-alt)' : 'transparent' }"
					@click="onRowClick(row)"
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
			No deals match the current search/filter.
		</p>
		<p
			v-for="issue in selectRowIssues"
			:key="issue.message"
			:class="pika({ margin: '0', fontSize: '11px', color: 'var(--lab-color-danger)' })"
		>
			{{ issue.message }}
		</p>
	</div>
</template>
