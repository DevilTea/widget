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
 * Issue #28 accessibility fix — ARIA pattern chosen for this table: native table semantics
 * (no `role` overrides anywhere in the markup below) plus keyboard-operable, focusable data rows and an
 * `aria-current="true"` selection indication. PR #32 adversarial review round 1 rejected an earlier
 * `role="grid"` + `role="row"`/`columnheader`/`gridcell` + `aria-selected` version of this renderer:
 * `grid` is a *composite widget* role with its own mandatory keyboard contract (a single Tab stop into
 * the widget, author-managed internal focus, Arrow/Home/End cell navigation) — adding the role without
 * that contract is an invalid, not merely incomplete, use of it, and this table deliberately has no
 * cell-level navigation to offer (selection here is row-level, reached by giving every row its own Tab
 * stop). Since `aria-selected` requires exactly that `grid`/`treegrid`/`listbox`-family context to be
 * valid, dropping the role also means dropping `aria-selected`. `aria-current` is the replacement: per
 * WAI-ARIA 1.2 it is a global state valid on any element, is announced by screen readers, and expresses
 * precisely "the current item within a set" — which is what a selected row is here. It is set to
 * `"true"` only on the selected row; every other row omits the attribute entirely rather than carrying
 * `aria-current="false"` (there is no "non-current" value in the `aria-current` enumeration — omission
 * is the correct not-current representation). Do not reintroduce `role="grid"` without also implementing
 * its full keyboard contract — that trade-off was deliberately rejected here.
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
