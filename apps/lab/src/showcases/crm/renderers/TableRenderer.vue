<script setup lang="ts">
/**
 * `rowIdKey`/`columns` come entirely from `useProperties()` — Lab-private semantic projections of
 * `Table`'s own resolved config (`../plugins/read-models.ts`) — never hardcoded here, so a valid edited
 * Source that changes `rowIdKey`/`columns` reaches this renderer (PR #22 review 4941241562 finding 1: a
 * still-valid edited Source setting `rowIdKey` to another string-valued field must key rows and call
 * `selectRow()` with that configured key, not a hardcoded `row.id`). Row click always calls
 * `Table.selectRow(id)` — never local selection state (checkpoint §5 "renderer selection callbacks
 * invoke `Table.selectRow`, not direct local selection state"). Keyboard activation (Enter/Space) below
 * calls the exact same `onRowClick` → `selectRow(id)` path as a pointer click, for the same reason.
 *
 * Issue #28 accessibility fix — ARIA pattern chosen for this table: `role="grid"` +
 * `role="row"`/`role="columnheader"`/`role="gridcell"` on every row/header-cell/data-cell, with
 * `tabindex="0"` and `aria-selected` on each data row. This is deliberately the *grid-as-selectable-
 * row-list* variant of the WAI-ARIA APG "Grid" pattern, not a full 2D-navigation grid: `aria-selected`
 * is only a valid state on `row` when the containing table's role is `grid`/`treegrid` (a plain
 * `role="table"`/native `<table>` row does not support it) — hence the role upgrade — but this renderer
 * does not add roving tabindex or arrow-key cell/row navigation, because selection here is row-level,
 * not cell-level, and rows are already reachable one at a time via Tab (each row is its own Tab stop).
 * Do not extend this into arrow-key navigation without first reconsidering the ARIA pattern — that
 * belongs to the real-browser contract suite (issue #28), not this renderer.
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

function onRowKeydown(event: KeyboardEvent, row: Record<string, unknown>): void {
	// Enter and Space both activate a focused row, matching the native button-activation contract.
	// Space's default browser action (page scroll) must be suppressed — Enter has no such default.
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
	<div :class="pika({ display: 'flex', flexDirection: 'column', gap: '6px' })">
		<table
			v-if="!empty"
			role="grid"
			:class="pika({ width: '100%', borderCollapse: 'collapse', fontSize: '12px' })"
		>
			<thead>
				<tr role="row">
					<th
						v-for="column in columns"
						:key="column.key"
						role="columnheader"
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
					role="row"
					tabindex="0"
					:aria-selected="rowId(row) === selectedRowId"
					:class="pika({ 'cursor': 'pointer', 'borderBottom': '1px solid var(--lab-color-border)', '$:focus-visible': { outline: '2px solid var(--lab-color-accent)', outlineOffset: '-2px' } })"
					:style="{ background: rowId(row) === selectedRowId ? 'var(--lab-color-surface-alt)' : 'transparent' }"
					@click="onRowClick(row)"
					@keydown="onRowKeydown($event, row)"
				>
					<td
						v-for="column in columns"
						:key="column.key"
						role="gridcell"
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
