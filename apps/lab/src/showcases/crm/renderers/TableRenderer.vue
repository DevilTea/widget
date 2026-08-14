<script setup lang="ts">
/**
 * `Table#deal-table` is the preset's single instance, so hardcoding its column list here (matching
 * `../presets.ts`'s configured `columns` verbatim) rather than reading `config.columns` (which
 * `@deviltea/widget-vue` has no path to expose) carries no per-instance ambiguity. Row click always
 * calls `Table.selectRow(id)` — never local selection state (checkpoint §5 "renderer selection
 * callbacks invoke `Table.selectRow`, not direct local selection state").
 */
import { useWidget } from '@deviltea/widget-vue'
import { TablePlugin } from '../plugins/read-models'

interface DealColumn { readonly key: 'company' | 'contact' | 'owner' | 'stage' | 'amount', readonly label: string }

const columns: readonly DealColumn[] = [
	{ key: 'company', label: 'Company' },
	{ key: 'contact', label: 'Contact' },
	{ key: 'owner', label: 'Owner' },
	{ key: 'stage', label: 'Stage' },
	{ key: 'amount', label: 'Amount' },
]

const { useState, useProperties, useMethods, useMethodIssues } = useWidget(TablePlugin)
const { selectedRowId } = useState()
const { rows, empty } = useProperties()
const { selectRow } = useMethods()
const { selectRow: selectRowIssues } = useMethodIssues()

function cellText(row: Record<string, unknown>, key: DealColumn['key']): string {
	const raw = row[key]
	if (key === 'amount' && typeof raw === 'number')
		return `$${raw.toLocaleString('en-US', { maximumFractionDigits: 0 })}`
	return String(raw ?? '')
}

function stageBadgeColor(row: Record<string, unknown>): string {
	switch (row.stage) {
		case 'won': return 'var(--lab-color-success)'
		case 'lost': return 'var(--lab-color-danger)'
		case 'negotiation': return 'var(--lab-color-warning)'
		default: return 'var(--lab-color-accent)'
	}
}

function onRowClick(row: Record<string, unknown>): void {
	const id = row.id
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
					:key="String(row.id)"
					:class="pika({ cursor: 'pointer', borderBottom: '1px solid var(--lab-color-border)' })"
					:style="{ background: row.id === selectedRowId ? 'var(--lab-color-surface-alt)' : 'transparent' }"
					@click="onRowClick(row)"
				>
					<td
						v-for="column in columns"
						:key="column.key"
						:class="pika({ padding: '6px 8px' })"
					>
						<span
							v-if="column.key === 'stage'"
							:class="pika({ display: 'inline-block', padding: '1px 8px', borderRadius: '999px', fontSize: '11px', color: 'var(--lab-color-bg)' })"
							:style="{ background: stageBadgeColor(row) }"
						>{{ cellText(row, column.key) }}</span>
						<template v-else>
							{{ cellText(row, column.key) }}
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
